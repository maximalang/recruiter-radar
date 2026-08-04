# Signal Episodes v2

## Назначение

Signal Episodes v2 — аддитивный Phase 3 слой между Company State Change и
будущим Commercial Thesis. Он объединяет связанные изменения состояния и
подтверждающие Company Events в одну коммерческую ситуацию компании:

```text
Source Record → Company Event → Company State Change → Signal Episode
```

Phase 3 не пишет legacy `hiring_episodes` или `opportunities`, не переключает
Today, lead, digest и Opportunity readers и не включает production cron.

## Контракт эпизода

Каждое поколение `signal_episodes` сохраняет:

- `episode_type`, `stage`, `started_at`, `last_seen_at`, `valid_until`;
- `intensity`, `direction`, `baseline_deviation`;
- `role_families`, `regions`, `seniority_distribution`;
- детерминированные коды `problem_hypotheses`;
- ссылки на Company State Changes, Company Events и evidence;
- `episode_identity`, `evidence_hash`, `input_hash`, `engine_version`.

Эпизод невозможен без хотя бы одного валидного, осмысленного Company State
Change и непустого связанного event/evidence provenance. Обычное наличие
вакансий без изменения относительно baseline не создаёт эпизод.

Поддерживаются типы:

- `vacancy_acceleration`;
- `persistent_hiring_problem`;
- `role_cluster`;
- `new_region_expansion`;
- `hiring_restart`;
- `sustained_hiring`;
- `leadership_led_expansion`;
- `recruiting_capacity_gap`;
- `new_unit_buildout`;
- `business_expansion`;
- `reactivation_window`.

## Консолидация и классификация

Изменения в continuity window образуют одну ситуацию, а не отдельную карточку
на каждую вакансию или публикацию. При совпадении нескольких паттернов
используется приоритет:

1. leadership + acceleration/role shift → `leadership_led_expansion`;
2. recruiter vacancy + acceleration → `recruiting_capacity_gap`;
3. new unit + acceleration/role shift → `new_unit_buildout`;
4. business event + hiring/role/region change → `business_expansion`;
5. restart + slowdown → `reactivation_window`;
6. повторные публикации + hiring/role change → `persistent_hiring_problem`;
7. длительное ускорение → `sustained_hiring`;
8. restart, new region, role cluster или базовое acceleration.

Назначение CTO само по себе остаётся контекстом и не создаёт lead. Только CTO
рядом с подтверждённым техническим ускорением или role shift меняет
классификацию на `leadership_led_expansion`.

## Жизненный цикл и поколения

`episode_identity` закреплён за первым триггером ситуации. Изменившийся input,
новое evidence, новый контекст или переход жизненного цикла создаёт следующее
immutable generation той же identity. Точный replay того же input возвращает
существующее поколение без новой записи.

`stage` вычисляется as-of времени запуска:

- `active` — основное окно актуальности;
- `cooling` — последние 25% окна;
- `expired` — `now >= valid_until`.

Срок действия составляет 21 день для большинства эпизодов, 30 дней для
restart/reactivation и 45 дней для sustained/persistent problems. Новое
поколение фиксирует переход stage; старые поколения не обновляются.

## Provenance и tenant safety

`signal_episodes` и три таблицы связей append-only. Composite foreign keys
сохраняют `organization_id` на всех переходах. DB trigger разрешает evidence
только если оно уже связано с Company State Change или Company Event данного
эпизода. Repository пишет поколение и весь provenance в одной транзакции под
advisory lock.

Чистая функция отклоняет future, conflicting, invalid, cross-organization,
missing-event и evidence-mismatch inputs. Гипотезы — фиксированные коды правил,
а не LLM-утверждения или выдуманные факты.

## Runtime и безопасный запуск

Независимый флаг `SIGNAL_EPISODES_V2_ENABLED` активен только при точном `true` и
по умолчанию выключен. Защищённый cron:

```text
POST /api/cron/opportunities/build-signal-episodes
POST /api/cron/opportunities/build-signal-episodes?apply=true&organization=10
```

Нужен действующий `x-api-key`. Без `apply=true` запуск всегда dry-run. Apply
требует одну явную положительную `organization`. Batch ограничен 25 компаниями,
input — 1000 State Changes и 5000 Events на компанию, окно загрузки — 120 дней,
окно meaningful trigger — 90 дней, окно contextual events — 30 дней, statement
timeout — 15 секунд. Усечённый
provenance не используется: компания целиком отмечается failed.

Candidate selection реагирует на новый State Change, новый Company Event,
который ещё не входит в последнее поколение, и переход stage. Ошибка одной
компании не останавливает остальные.

## Проверки

```powershell
npm.cmd --workspace apps/web test -- --runInBand --runTestsByPath src/__tests__/lib/opportunities/signal-episode.test.ts src/__tests__/lib/opportunities/signal-episode-repository.test.ts src/__tests__/lib/opportunities/signal-episode-job.test.ts src/__tests__/api/opportunities/cron-route.test.ts
npm.cmd run test:signal-episodes-v2:db
npm.cmd run test:company-state-v1:db
npm.cmd run test:company-events-v1:db
npm.cmd run test:opportunity-engine:down
npm.cmd run db:validate
npm.cmd run web:check
npm.cmd run web:build
```

PostgreSQL gate проверяет real job/repository runtime, replay, generation refresh,
tenant isolation, linked provenance, append-only ограничения и data-loss-safe
rollback.

## Rollout и rollback

1. Применить миграцию при выключенном `SIGNAL_EPISODES_V2_ENABLED`.
2. Проверить полноту Company Events и Company State Changes выбранной внутренней
   компании.
3. Выполнить dry-run с явной `organization` и проверить built/stage/rejections.
4. Только после отдельного решения включить Phase 3 flag и выполнить scoped
   `apply=true` для той же компании.
5. Не переключать legacy Hiring Episode, Opportunity или Today readers в этом
   rollout.

Операционный rollback — выключить флаг. Down migration берёт exclusive locks и
отказывается удалять схему при наличии хотя бы одного эпизода. Merge, deploy,
включение флага и reader switch не входят в Phase 3.
