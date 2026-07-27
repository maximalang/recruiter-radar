# Opportunity Engine v1

Opportunity Engine преобразует уже собранные сигналы найма в три отдельные сущности:

1. `HiringEpisode` — подтверждённое company-level изменение найма.
2. `Opportunity` — tenant-scoped оценка эпизода для конкретного профиля агентства.
3. `Morning Brief` — пользовательское представление приоритетных актуальных opportunities.

Реализация аддитивна и не меняет существующие `signals`, FIUR, confidence gates,
digest generation, billing/entitlement и delivery pipeline. Opportunity строится
только для пары «активный клиентский профиль + организация», для которой есть
кандидат из завершённого digest run.

## Feature flag

```dotenv
OPPORTUNITY_ENGINE_V1_ENABLED=false
```

По умолчанию flag выключен. Только точная строка `true` включает:

- `/opportunities`;
- `/api/opportunities`;
- opportunity cron jobs.

При выключенном flag пользовательские routes отвечают `404`, а jobs не делают
даже read-запросов.

## Миграции и модель данных

Миграции применяются по порядку:

- `20260726130000_add_opportunity_engine_v1.sql` — исходная v1-схема;
- `20260727120000_add_opportunity_engine_hardening.sql` — стабильная идентичность
  эпизода и поколения;
- `20260727121000_add_opportunity_episode_state.sql` — клиентское состояние эпизода;
- `20260727122000_add_opportunity_supersession.sql` — provenance и supersession
  пересчитанных opportunities;
- `20260727130000_fix_opportunity_hardening_edge_cases.sql` — восстановление
  snooze deadline и constraint, запрещающий `snoozed` без `snoozed_until`.

Для каждой migration рядом находится `.down.sql`.

Основные сущности:

- `hiring_episodes` — глобальные company-level факты;
- `hiring_episode_evidence` — точная трассировка до всех исходных публикаций и
  evidence items;
- `hiring_episode_detection_state` — checkpoint последнего успешного detect;
- `opportunities` — owner/profile-scoped score и детерминированный brief;
- `client_episode_state` — `accepted`, `dismissed`, `snoozed` или `contacted`
  для конкретной пары profile/episode;
- `opportunity_actions` — идемпотентный audit trail с предыдущим и новым статусом;
- `opportunity_build_failures` — retry backoff для отдельной profile/episode пары.

Composite foreign keys не позволяют связать opportunity с чужим профилем,
эпизодом другой организации или записать действие от другого owner.

### Идентичность HiringEpisode

`episode_identity` — стабильная семантическая идентичность вида
`organization:type:normalized-dimension`. Календарная дата в идентичность не
входит. Читаемый формат позволяет безопасно продолжить legacy date-key эпизоды
после upgrade без недоступной в базовом PostgreSQL функции SHA-256.

`episode_generation` начинается с `1`. Для одной комбинации
`organization_id + episode_identity + engine_version` может существовать только
один активный эпизод. Повторное обнаружение в течение `continuationGapDays`
обновляет этот эпизод. После периода неактивности старый эпизод закрывается и
создаётся следующее поколение. В v1 `continuationGapDays` и
`inactivityCloseDays` равны 30 дням, чтобы правила продолжения и закрытия не
образовывали неопределённое окно.

Поддерживаемые типы:

- `vacancy_spike`;
- `repeated_vacancies`;
- `role_cluster`;
- `new_region`;
- `hiring_restart`;
- `sustained_hiring`.

Старое значение `new_role_cluster` мигрируется в `role_cluster`.

### Каноническая вакансия и evidence

Vacancy dedupe использует, по убыванию надёжности:

1. внешний vacancy id;
2. канонический URL без tracking-параметров;
3. fallback `organization + normalized title + normalized region`.

Разные external id одного provider не склеиваются, в том числе через транзитивную
цепочку публикаций без id. Между разными providers
публикации могут объединиться по canonical URL или fallback fingerprint.
Несколько публикаций одной
канонической вакансии увеличивают `publicationCount`, но не `vacancy_count`.
При этом каждая исходная публикация остаётся отдельной evidence-связью.

Reconciliation эпизода, его exact evidence set, `evidence_hash` и detection
checkpoint выполняется одной транзакцией под per-organization advisory
transaction lock. Checkpoint хранит fingerprint содержимого signal/evidence,
поэтому evidence-only изменения и удаления также запускают reconciliation.
Активные identity, исчезнувшие из полного результата детектора, закрываются в
той же транзакции только после `inactivityCloseDays`; движение короткого окна
само по себе не создаёт новую generation. Повторный detect:

- добавляет появившиеся связи;
- удаляет устаревшие связи;
- пересчитывает SHA-256 по канонически отсортированному набору;
- не оставляет частично обновлённый эпизод при ошибке.

## Opportunity scoring и provenance

Scoring version: `opportunity-v1`.

Компоненты:

- `agencyFit`;
- `hiringIntent`;
- `externalSupportNeed`;
- `timing`;
- `reachability`;
- `confidence`.

`externalSupportNeed` означает осторожную эвристику потребности во внешней
поддержке. Это не утверждение, что компания уже решила привлечь агентство.
Модель помечена как `heuristic` и `uncalibrated`; score предназначен для
приоритизации, а не для вероятностной интерпретации.

Итоговый score — геометрическое среднее шести нормализованных компонентов.
Confidence gate D не входит в Morning Brief. Явное исключение профиля или
`agencyFit < 0.35` переводит opportunity в `dismissed`; gate C/D или низкая
confidence — в `review`.

Каждая запись сохраняет:

- `episode_evidence_hash`;
- `profile_snapshot_hash`;
- `digest_candidate_id`;
- `fiur_version`;
- `scoring_config_hash`;
- `brief_builder_version`;
- `input_hash`;
- `scoring_version`.

`input_hash` включает семантическое содержимое episode/signals/evidence, организацию,
digest payload и профиль, но не `digest_candidate_id` и другие database row ids.
Из digest payload исключаются внутренние `corroborated_org_ids` и fallback-ключи
`org:<database-id>`; доменные и провайдерские corroboration keys остаются семантическими.
Detector-only `canonicalVacancyFingerprints` также не входят в hash: fallback этих
идентификаторов содержит database organization id, а сами вакансии уже представлены
семантическим содержимым signals.
Ключи объектов канонически сортируются; только set-like массивы (source families,
поля профиля и наборы signals/evidence) сортируются и dedupe-ятся в build job.
Порядок семантических массивов, включая digest reasons, сохраняется. Одинаковый `input_hash` не
вызывает запись. Повторная сборка той же scoring version обновляет текущую
строку. Новая scoring version атомарно помечает предыдущую строку
`superseded_at` и создаёт новую. Возврат canary на ранее использованную scoring
version восстанавливает её superseded-строку вместо конфликтующей повторной
вставки. Частичный unique index
гарантирует ровно одну current-запись для profile/episode. List и detail queries
возвращают только `superseded_at IS NULL`.

## Персонализированный brief и evidence metrics

Brief builder использует только переданные факты и профиль агентства:
специализацию, географию, роли, отрасли, keywords, hiring mode и contact policy.
Он возвращает:

- `whyNow`;
- `problemHypothesis`;
- `recommendedAngle`;
- `recommendedPersona`;
- `recommendedAction`;
- `agencyFitExplanation`;
- `limitations`.

Формулировки не утверждают наличие бюджета, агентского мандата, конкретного ЛПР
или персонального контакта. Outreach остаётся draft/assist.

API и UI показывают отдельно:

- число фактов;
- число исходных публикаций;
- число семейств источников;
- число прямых подтверждений.

API не возвращает `owner_id`, raw metadata, внутренние hashes или
`digest_candidate_id`.

## Lifecycle и suppression

Разрешённые переходы:

| Текущий статус | Разрешённые действия |
| --- | --- |
| `new`, `review` | `accepted`, `dismissed`, `snoozed` |
| `snoozed` | `accepted`, `dismissed` |
| `accepted` | `contacted`, `dismissed`, `snoozed` |
| `contacted`, `dismissed`, `expired` | нет |

Запрещённый переход возвращает `409` и не создаёт `opportunity_actions`.
Идемпотентный replay с тем же key и payload не меняет данные и возвращает фактическую
current opportunity, даже если исходная строка уже superseded или её статус изменился.
Повторное использование key с другим payload возвращает `409`.

`accepted` означает «клиент принял opportunity в работу» и записывается только в
`client_episode_state`. `contacted` также остаётся episode-scoped и не обновляет legacy
`client_digest_org_state`. Поэтому завершение одного эпизода не скрывает будущий
эпизод той же компании. При supersession или rollback scoring version статус `snoozed`
и точный `client_episode_state.suppressed_until` переносятся в current opportunity.
Если deadline уже истёк, build job атомарно удаляет episode state и возвращает current
opportunity к рассчитанному статусу даже при неизменном `input_hash`.

## Jobs и конкурентность

Endpoints требуют `x-api-key: $CRON_API_KEY`:

```text
POST /api/cron/opportunities/detect-hiring-episodes
POST /api/cron/opportunities/build-opportunities
POST /api/cron/opportunities/expire-opportunities
POST /api/cron/opportunities/backfill-opportunities
```

Каждый top-level job получает отдельный PostgreSQL client и session advisory
lock. Параллельный запуск того же job завершается безопасным skip с метриками
`locked` и `skippedBecauseLocked`. Detect дополнительно сериализует запись
каждой организации через transaction advisory lock.

Основные счётчики: `scanned`, `created`, `continued`, `reconciled`,
`skippedUnchanged`, `superseded`, `updated`, `skipped`, `failed`, `expired`,
`locked`, `skippedBecauseLocked`.

Build начинается с последних кандидатов из завершённых digest runs, затем
соединяет их с соответствующими профилями и эпизодами. Декартова матрица
profile × episode не создаётся. Candidate должен быть не старше episode и
profile snapshot, а его source families должны покрывать источники episode.

Backfill без `apply=true` выполняет detect → build в транзакции и завершает её
`ROLLBACK`. Запись разрешена только явно:

```text
POST /api/cron/opportunities/backfill-opportunities?apply=true
```

## Проверки

Статические и unit/integration-like проверки:

```powershell
npm.cmd run test --workspace @recruiter-radar/web -- --runInBand --testPathPattern=opportunit
npm.cmd run web:check
npm.cmd run web:build
npm.cmd run db:validate
```

Реальная PostgreSQL-проверка принимает URL административной БД и сама создаёт и
удаляет изолированную временную БД:

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/postgres'
npm.cmd run test:opportunity-engine:db
npm.cmd run test:opportunity-engine:down
```

DB runner применяет всю migration chain к свежей схеме, запускает SQL verifier в
rollback-транзакции и production TypeScript runtime test через реальные
`detectHiringEpisodesJob`, `buildOpportunitiesJob`, `applyOpportunityAction` и
`expireOpportunitiesJob`. Down runner применяет пять down migrations в обратном
порядке и проверяет удаление runtime tables.

Проверки покрывают:

- актуальную форму схемы;
- продолжение эпизода и новое поколение после неактивности;
- unique active identity;
- canonical vacancy count при нескольких публикациях;
- expansion/contraction exact evidence set и hash;
- tenant ownership;
- illegal transition без action row;
- идемпотентный replay;
- `accepted → contacted` без преждевременного org-wide suppression;
- стабильную повторную сборку с тем же input;
- supersession новой scoring version и ровно одну current-запись;
- исключение superseded rows из current query;
- атомарное пробуждение snooze и последующий expire lifecycle;
- взаимное исключение cron advisory lock;
- `EXPLAIN` build query и отсутствие `CROSS JOIN`.

Ключевые диагностические события: `canonical_vacancy.merge_rejected`,
`hiring_episode.bounds_preserved`, `opportunity.snooze_preserved`,
`opportunity.build.semantic_unchanged`, `opportunity.snooze_elapsed_during_build`,
`opportunity.replay_served` и
`opportunity.contact_recorded`. Они содержат только ids, версии и reason codes;
raw URL и payload в них не пишутся.

Для ручной оценки плана используйте тот же `EXPLAIN (FORMAT JSON)` из verifier.
В плане не должно быть полного произведения `client_profiles × hiring_episodes`;
стартовый набор — `latest_candidates`.

## Canary rollout

1. Применить migrations при `OPPORTUNITY_ENGINE_V1_ENABLED=false`.
2. Запустить DB verifier в отдельной PostgreSQL БД.
3. Выполнить dry-run backfill и сохранить counters.
4. Запустить `apply=true` только для одной `organization`.
5. Сверить количество active identities, evidence links, current
   opportunities и долю `failed`.
6. Включить flag только на worker/cron.
7. Выполнить detect/build/expire и проверить отсутствие lock contention и
   duplicate current rows.
8. Включить flag на web runtime для одного тестового owner.
9. Проверить Morning Brief, lifecycle и evidence metrics.
10. Расширять canary только после стабильного полного цикла.

Минимальные canary-инварианты:

```sql
-- Не более одного активного поколения identity.
SELECT organization_id, episode_identity, engine_version, COUNT(*)
FROM hiring_episodes
WHERE status = 'active'
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1;

-- Ровно одна current opportunity на profile/episode.
SELECT client_profile_id, hiring_episode_id, COUNT(*)
FROM opportunities
WHERE superseded_at IS NULL
GROUP BY 1, 2
HAVING COUNT(*) > 1;
```

Оба запроса должны вернуть 0 строк.

## Rollback

Аварийный rollback начинается с выключения feature flag и остановки opportunity
jobs. Это мгновенно убирает пользовательскую поверхность и новые writes, не
затрагивая основной digest pipeline.

Далее:

1. сохранить counters и проблемные identity/input hashes;
2. дождаться завершения активных job-транзакций;
3. для rollback только scoring canary вернуть предыдущую scoring version:
   build восстановит её сохранённую superseded-строку как current;
4. для полного schema rollback откатывать migrations в обратном порядке;
5. базовую v1 down migration применять только если данные Opportunity Engine
   больше не нужны.

Hardening migration при upgrade может закрыть лишние активные поколения,
обнаруженные в старых данных. Supersession down migration переносит actions с
исторических scorer-строк на оставшуюся current-строку, сохраняет исходные id и
idempotency key в metadata, затем удаляет несовместимые со старой схемой
исторические версии. Остальные down migrations удаляют новые ограничения и
поля, но намеренно не открывают закрытые поколения обратно: это необратимая
нормализация статуса, которую нужно учитывать при rollback review.

## Ограничения v1

- Detection использует существующие vacancy-level signals и не создаёт новые
  источники.
- Opportunity появляется только после завершённого digest candidate, сохраняя
  существующие eligibility gates.
- Эвристика `externalSupportNeed` пока не откалибрована на outcomes.
- Morning Brief не отправляет outreach и не превращается в CRM.
- Scheduler остаётся частью deployment environment; приложение предоставляет
  защищённые идемпотентные endpoints и блокировки конкурентных запусков.
