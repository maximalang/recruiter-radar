# Company State v1

## Назначение

Company State v1 — аддитивный Phase 2 слой между `company_events` и будущими
Signal Episode / Commercial Thesis. Он отвечает на вопрос «что изменилось у
этой конкретной компании относительно её собственного обычного состояния», а
не сравнивает абсолютное число вакансий с глобальным порогом.

Существующие Hiring Episode, Opportunity, lead и digest readers в этой фазе не
переключаются. Ни миграция, ни cron не включают новый путь автоматически.

## Baseline и snapshot

Snapshot строится as-of `snapshot_at` только из Company Events, которые:

- принадлежат одной `organization_id`;
- имеют evidence;
- произошли и были увидены не позже `snapshot_at`;
- попадают в ограниченное окно истории 180 дней.

Для вакансий сохраняются текущие значения за 7/14/30 дней. Baseline 7/14/30 —
медиана непересекающихся исторических периодов соответствующей длины после
исключения текущих 14 дней. Основной hiring velocity — медиана 7-дневных
периодов. Также сохраняются обычные роли, seniority, регионы, vacancy lifetime,
repost rate, recruiting capacity и подтверждённые business-change events.

История считается достаточной только одновременно при:

- coverage не меньше 60 дней;
- не меньше четырёх исторических job events;
- не меньше трёх завершённых исторических 14-дневных периодов.

При меньшей истории `state_classification=insufficient_history`,
`fallback_reason=insufficient_history`, confidence не выше `0.35`, а state
changes не создаются. Это намеренный cautious fallback, а не отрицательный
сигнал о компании.

## Правила изменения состояния

- `hiring_acceleration`: текущие 14 дней дают минимум две вакансии, минимум на
  две вакансии больше baseline и deviation не меньше `0.75`.
- `hiring_slowdown`: baseline не меньше двух вакансий, текущий объём не выше
  половины baseline.
- `hiring_restart`: минимум две текущие вакансии после паузы не меньше 45 дней.
- `new_region`: минимум две текущие вакансии в регионе, которого нет в
  историческом распределении компании (сравнение case-insensitive).
- `role_mix_shift`: текущая dominant role содержит минимум три вакансии и долю
  не меньше `0.60`, а её историческая доля была меньше `0.30`.

Repost rate остаётся `supported=false` и `rate=null`, пока нет реальных
`vacancy_repost` Company Events. Phase 2 не синтезирует repost, salary change,
business event или другой неподтверждённый факт.

## Детерминизм и provenance

`input_hash` включает версию, UTC-день snapshot и каноническое полное состояние
каждого входного event. Поэтому replay того же input идемпотентен, а новое
evidence, observation или Company Event в тот же день создаёт новый input.

`company_state_snapshots` и `company_state_changes` append-only. Отдельные
таблицы связывают каждую запись с исходными `company_events` и
`evidence_items`. Composite foreign keys проверяют `organization_id`, а DB
triggers разрешают evidence только из event, уже связанного с тем же snapshot
или change. Change provenance обязан быть непустым подмножеством snapshot
provenance и дополнительно проверяется repository до начала транзакции.

Reason codes чистой функции:

- `COMPANY_STATE_EVENT_FUTURE`;
- `COMPANY_STATE_EVENT_ID_CONFLICT`;
- `COMPANY_STATE_EVENT_INVALID`;
- `COMPANY_STATE_EVENT_OUTSIDE_HISTORY`;
- `COMPANY_STATE_EVIDENCE_MISSING`;
- `COMPANY_STATE_ORGANIZATION_MISMATCH`.

## Runtime и безопасный запуск

Флаг `COMPANY_STATE_V1_ENABLED` независим от Company Events и Opportunity
Engine и активен только при точном значении `true`. По умолчанию он выключен.

Защищённый cron-вход:

```text
POST /api/cron/opportunities/build-company-state
POST /api/cron/opportunities/build-company-state?apply=true&organization=10
```

Нужен действующий `x-api-key`. Без `apply=true` вызов всегда dry-run. Запись
требует ровно одну явную положительную `organization`. Batch ограничен 25
организациями, история — 5000 events на организацию, statement timeout — 15
секунд. Если лимит истории превышен, организация отклоняется целиком: snapshot
на усечённом input не создаётся.

Очередь выбирает организацию при отсутствии snapshot, на новом UTC-дне, при
новом event или при observation новее последнего snapshot. Один organization
build и весь его provenance фиксируются одной транзакцией под advisory lock.

## Проверки

```powershell
npm.cmd test --workspace @recruiter-radar/web -- --runInBand --runTestsByPath src/__tests__/lib/opportunities/company-state.test.ts src/__tests__/lib/opportunities/company-state-repository.test.ts src/__tests__/lib/opportunities/company-state-job.test.ts src/__tests__/api/opportunities/cron-route.test.ts
npm.cmd run test:company-state-v1:db
npm.cmd run test:opportunity-engine:down
npm.cmd run db:validate
npm.cmd run web:check
npm.cmd run web:build
```

PostgreSQL gate создаёт отдельную временную базу и проверяет migration up,
реальный job/repository runtime, acceleration относительно baseline, dry-run,
apply scope, replay, same-day refresh, tenant isolation, evidence provenance,
append-only и data-loss-safe down migration.

## Rollout и rollback

1. Применить миграцию при выключенном `COMPANY_STATE_V1_ENABLED`.
2. Убедиться, что Company Events для выбранной внутренней организации полны и
   evidence-backed.
3. Выполнить dry-run с явной организацией и проверить `lowHistory`,
   `changesDetected`, rejections и failures.
4. Только после отдельного решения включить Phase 2 flag и выполнить
   `apply=true` для той же организации.
5. Не переключать Hiring Episode / Opportunity readers в этом rollout.

Операционный rollback — выключить флаг. Down migration берёт exclusive lock и
отказывается удалять схему, если существует хотя бы один snapshot или change.
Сохранённое evidence не удаляется автоматически.

## Граница Phase 2

Phase 2 не строит Signal Episodes, Commercial Thesis, Agency DNA Match,
Opportunity Scoring v3 или Today UI. Он также не включает production cron,
флаги, merge или deploy.
