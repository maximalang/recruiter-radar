# Opportunity Engine v1

Opportunity Engine превращает уже собранные сигналы найма в три отдельные сущности:

1. `HiringEpisode` — подтверждённое изменение найма компании.
2. `Opportunity` — tenant-scoped оценка эпизода для конкретного профиля агентства.
3. `Morning Brief` — пользовательское представление приоритетных opportunities.

Реализация аддитивна. Она не меняет существующие `signals`, FIUR, confidence gates, digest generation, billing/entitlement и delivery pipeline. Opportunity строится только для пары «активный клиентский профиль + организация», для которой уже существует `digest_candidate` текущего pipeline.

## Feature flag

```dotenv
OPPORTUNITY_ENGINE_V1_ENABLED=false
```

Значение по умолчанию — `false`. Только точная строка `true` без пробелов и
изменения регистра включает:

- `/opportunities`;
- `/api/opportunities`;
- opportunity cron jobs.

При выключенном flag пользовательские routes возвращают `404`, jobs не выполняют даже read-запросы, а существующий pipeline продолжает работать без изменений.

## Схема данных

Миграция:

- `packages/db/migrations/20260726130000_add_opportunity_engine_v1.sql`;
- rollback: `packages/db/migrations/20260726130000_add_opportunity_engine_v1.down.sql`.

Новые таблицы:

- `hiring_episodes` — глобальные company-level факты с versioned dedupe key;
- `hiring_episode_evidence` — traceability до `signals` и `evidence_items`;
- `hiring_episode_detection_state` — checkpoint последнего успешно
  обработанного signal id/update по organization и engine version, включая
  поздно пришедшие сигналы с более старым `occurred_at`;
- `opportunities` — owner/profile-scoped score и детерминированный brief;
- `opportunity_actions` — idempotent audit trail пользовательских действий;
- `opportunity_build_failures` — retry-backoff для неуспешных
  episode/profile pairs без блокировки следующих batch-строк.

Composite foreign keys не позволяют связать opportunity с чужим профилем или записать действие от другого owner. Score columns ограничены диапазоном `0..1`, lifecycle и confidence gates — allowlist constraints.

Миграция не содержит backfill. На первом rollout она применяется с выключенным flag.

## Детекция HiringEpisode

Engine version: `hiring-episode-v1`.

Поддерживаемые типы:

- `vacancy_spike`;
- `repeated_vacancies`;
- `new_role_cluster`;
- `new_region`;
- `hiring_restart`;
- `sustained_hiring`.

Пороговые значения находятся в `DEFAULT_HIRING_EPISODE_CONFIG`, а runtime limits и feature flag — в `apps/web/lib/opportunities/config.ts`.

Детекция:

- читает только `job_posting` за history window;
- нормализует и дедуплицирует сигналы;
- создаёт стабильный `episode_key` и SHA-256 `evidence_hash`;
- связывает эпизод с исходными signal/evidence IDs;
- повторный запуск обновляет существующий versioned episode.
- успешный apply-run сохраняет checkpoint даже при отсутствии episode, поэтому
  следующий batch не застревает на первых организациях; dry-run checkpoint не
  меняет.

## Opportunity scoring

Scoring version: `opportunity-v1`.

Компоненты:

- agency fit;
- hiring intent;
- external agency propensity;
- timing;
- reachability;
- confidence.

Финальный score — геометрическое среднее шести нормализованных компонентов. Это не замена FIUR: FIUR fit/reachability и его структурированные reasons являются входом нового scorer. Confidence gate D не попадает в Morning Brief; explicit profile exclusions и низкий fit переводят запись в `dismissed`; закрытый episode — в `expired`.

Brief builder использует только переданные факты и осторожные формулировки. Он не утверждает наличие бюджета, агентского мандата, конкретного ЛПР или персонального контакта.

## Jobs

Все endpoints требуют `x-api-key: $CRON_API_KEY`.

```text
POST /api/cron/opportunities/detect-hiring-episodes
POST /api/cron/opportunities/build-opportunities
POST /api/cron/opportunities/expire-opportunities
POST /api/cron/opportunities/backfill-opportunities
```

Общие query parameters:

- `organization=<positive bigint>` — ограничить одной организацией;
- `batchSize=1..500`;
- `dryRun=true` — не выполнять writes для detect/build/expire.

Backfill безопасен по умолчанию:

```text
POST /api/cron/opportunities/backfill-opportunities
```

выполняет полный detect → build внутри одной транзакции и завершает её
`ROLLBACK`, поэтому preview совпадает с apply-путём даже на первой загрузке.
Запись разрешается только явным:

```text
POST /api/cron/opportunities/backfill-opportunities?apply=true
```

Рекомендуемый график:

1. `detect-hiring-episodes` после source ingest;
2. `build-opportunities` после успешной генерации digest candidates;
3. `expire-opportunities` ежедневно после build.

Jobs изолируют ошибку одной organization/profile pair, ведут счётчики `scanned`, `created`, `updated`, `skipped`, `failed`, `expired` и пишут structured events:

- `opportunity.job.started`;
- `opportunity.job.entity_failed`;
- `opportunity.job.completed`;
- `opportunity.job.disabled`;
- `opportunity.cron.failed`.

Entity-level события:

- `hiring_episode.created`;
- `hiring_episode.updated`;
- `hiring_episode.closed`;
- `opportunity.created`;
- `opportunity.updated`;
- `opportunity.expired`;
- `opportunity.action`.

Build использует только candidate из завершённого digest run, созданный не
раньше последнего сигнала episode и последнего изменения client profile.
Source families candidate должны покрывать источники signal-ов episode. Уже
актуальные opportunities отсекаются до `LIMIT`, поэтому повторные batch-run не
застревают на первых строках. Ошибка конкретной organization/profile pair
ставит её на пятиминутный retry-backoff, освобождая bounded batch для следующих
строк.

## API

Все пользовательские endpoints требуют подписанную owner session и всегда добавляют owner predicate:

```text
GET  /api/opportunities
GET  /api/opportunities/:id
POST /api/opportunities/:id/action
```

List filters:

- `profile`;
- `organizationId`;
- `status` (comma-separated allowlist);
- `confidenceGate=A|B|C|D`;
- `episodeType`;
- `minimumScore=0..1`;
- `limit=1..100`;
- `cursor`.

Для совместимости также принимаются прежние aliases `organization`, `gate`,
`page` и `pageSize`.

List endpoint и `/opportunities` всегда применяют
`morningBriefEligible = true`; поэтому gate D и profile-excluded записи не
попадают в Brief даже при прямой передаче соответствующего фильтра.

Actions:

- `accepted`;
- `dismissed`;
- `snoozed`;
- `contacted`.

Action request принимает `Idempotency-Key` header или `idempotencyKey` в JSON. `snoozed` также принимает `snoozeDays` и ограничивает его диапазоном `1..90`. Feedback синхронизируется через существующий `client_digest_org_state` core в той же транзакции.

Idempotency key хранится вместе с SHA-256 fingerprint нормализованного payload.
Повтор того же request безопасен, а повторное использование ключа с другим
action/note/snooze payload возвращает `409`. UI сохраняет один request key для
сетевого retry, но создаёт новый key для нового пользовательского намерения.
Snoozed-записи не входят в default Brief; после истечения срока expire job
возвращает ещё актуальную запись в `new`.

Opportunity storage и API projection не дублируют contact paths. API также не
возвращает `owner_id`, raw metadata, evidence hash или внутренний digest
candidate ID.

## Проверки

Статические и unit/integration-like проверки:

```powershell
npm.cmd run test --workspace @recruiter-radar/web -- --runInBand --testPathPattern=opportunit
npm.cmd run web:check
npm.cmd run db:validate
```

Проверка реальной PostgreSQL schema выполняется после миграции в изолированной БД:

```powershell
$env:DATABASE_URL='postgresql://...'
npm.cmd run db:migrate
npm.cmd run test:opportunity-engine:db
```

Verifier работает внутри транзакции с `ROLLBACK` и проверяет:

- tenant ownership;
- action idempotency;
- evidence traceability.

## Rollout

1. Применить migration при `OPPORTUNITY_ENGINE_V1_ENABLED=false`.
2. Выполнить DB verifier в изолированной PostgreSQL.
3. Запустить backfill без `apply=true` и проверить structured counters.
4. Запустить canary backfill для одной organization с `apply=true`.
5. Включить flag только на worker/cron и проверить episodes/opportunities.
6. Включить flag на web runtime и проверить `/opportunities` для тестового owner.
7. Наблюдать `failed`, долю gate C/D, объём dismissed/expired и latency jobs.

Экстренный rollback начинается с выключения flag. Down migration применяется только после остановки jobs и подтверждения, что данные v1 больше не нужны. Существующие leads/digests при этом не затрагиваются.

## Известные ограничения v1

- Episode detection использует текущие vacancy-level signals и не создаёт новые источники.
- Opportunity строится только после появления `digest_candidate`; это сознательно сохраняет текущие gates.
- Morning Brief не отправляет outreach и не генерирует массовые сообщения.
- Связь evidence item с signal возможна только при существующей нормализованной ссылке; signal trace остаётся обязательным.
- Scheduler configuration остаётся инфраструктурной задачей deployment environment; приложение предоставляет защищённые idempotent endpoints.

## Следующая версия

После canary v1 рекомендуется:

1. измерить precision по `accepted`, `dismissed` и причинам;
2. откалибровать thresholds только на размеченных outcomes;
3. добавить новые company-level episode types лишь после появления надёжных
   источников и evidence contracts;
4. расширить outcome model без превращения Morning Brief в CRM;
5. при необходимости заменить opaque offset cursor на keyset cursor для
   очень больших tenant-выборок.
