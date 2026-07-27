# Opportunity Outcome Ledger

Outcome Ledger — append-only источник фактических коммерческих результатов
Opportunity Engine. Он нужен для проверки качества opportunities и последующей
калибровки scoring. Это не CRM: здесь нет контактной базы, переписки,
автоматического outreach, прогноза выручки, Agency DNA или LLM.

## Feature flags

```dotenv
OPPORTUNITY_OUTCOMES_ENABLED=false
OPPORTUNITY_OUTCOMES_UI_ENABLED=false
OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED=false
OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET=
```

Все flags по умолчанию выключены. `OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET`
обязателен для записи переданного пользователем contact reference и должен
содержать не менее 32 байт секрета. Он используется только для tenant-scoped
HMAC и не попадает в browser bundle.

External ingestion намеренно недоступен даже при legacy-флаге: один глобальный
webhook secret не является tenant identity. Для включения нужен отдельный
контракт интеграций с owner-bound credential, rotation, disable/replay policy,
rate limit и lookup по `owner_id + public_reference`.

## Commercial stage и workflow state

Проекция хранит две независимые оси:

```text
commercial_stage:
new/review → accepted → contacted → replied → meeting → proposal → won
                 ↘ dismissed             ↘ lost

workflow_state:
active → snoozed → active (resumed)
```

`won`, `lost` и `dismissed` terminal. `shown`, `opened`, `exported`,
`meeting_cancelled` и `meeting_no_show` — observational events и не двигают
commercial stage. `meeting` означает только «встреча назначена»; cancelled и
no-show не могут продвинуть opportunity. Cancelled/no-show допустимы только
после последней действующей `meeting` с `meetingStatus=scheduled`, не раньше
её `occurredAt` и только один раз для этого lifecycle.

`snoozed` сохраняет текущую commercial stage, записывает deadline и блокирует
следующий коммерческий переход. Контракт продолжения явный: сначала атомарный
`resumed`, затем отдельное коммерческое событие. Expire/build jobs создают
system `resumed`, когда deadline истёк. UI поддерживает 1/3/7/14/30 дней и
ручную дату в разрешённом диапазоне 1–90 дней.

Compatibility-поле `current_stage` пока сохраняется, но authoritative state —
`commercial_stage + workflow_state + snoozed_until`.

## Chronology и история

Для любого stage-changing события действует:

```text
occurredAt >= last_stage_event_at
```

Нарушение возвращает `409 outcome_chronology_conflict`. Равные timestamp
разрешены; стабильный tie-breaker — append-only `id`. Observational events
можно backfill раньше последней коммерческой стадии: они не меняют
`last_stage_event_at`.

History API возвращает безопасные `occurredAt`, `recordedAt` и `appendOrder`.
Порядок timeline детерминирован как `occurredAt, id`; append order при этом
остаётся доступен для аудита.

## Corrections

История не редактируется и не удаляется. `reverted` — компенсирующее событие,
которое может отменить только последний действующий stage-changing event этой
же opportunity и tenant. Оно восстанавливает предыдущую проекцию, сохраняет
оба события и само идемпотентно.

Произвольная коррекция середины цепочки запрещена. UI называет операцию
«Отменить последнее изменение».

## Idempotency и транзакции

Idempotency key tenant-scoped. Fingerprint строится deterministic canonical
serialization всего семантического payload: action/event, normalized note,
snooze deadline/duration, reason, channel, contact path type, tenant HMAC
contact reference и остальные фактические поля. Автоматически созданный
сервером timestamp legacy `/action` не входит в его fingerprint; явно переданный
`occurredAt` в `/outcomes` является semantic payload и входит в ledger hash.

Одинаковые key и payload возвращают replay. Повтор key с другим payload
возвращает `409 idempotency_key_conflict`.

Writer в одной PostgreSQL transaction:

1. берёт shared advisory lock `opportunity-outcome-owner:<owner_id>`;
2. сериализует idempotency key;
3. блокирует tenant-scoped opportunity/state;
4. проверяет transition, chronology и correction;
5. вставляет append-only event;
6. обновляет projection и совместимые legacy state.

`BEFORE INSERT` trigger повторяет owner shared-lock и критические transition,
chronology, correction и meeting lifecycle invariants для direct SQL/import
writers. Поэтому такие writers не обходят tenant boundary и не теряют запись
при конкурентном projection rebuild.

Ошибка любого шага откатывает event и projection вместе. Новые события для
superseded opportunity запрещены, существующая история сохраняется.

## Data model и DB invariants

`opportunity_outcome_events` содержит полный tenant context:
`owner_id + client_profile_id + opportunity_id + hiring_episode_id +
organization_id`. Composite foreign keys не позволяют подменить owner,
opportunity или связанный контекст.

Hardening migration добавляет:

- event: `contact_reference_hash`, `contact_reference_label`,
  `snoozed_until`, `reverts_event_id`;
- state: `commercial_stage`, `workflow_state`, `snoozed_until`,
  `last_stage_event_id`, `last_stage_event_at`;
- composite event identity `(id, owner_id, opportunity_id)` для last-event и
  correction references;
- actor invariant: user/admin требуют `actor_user_id`, system/external
  запрещают его;
- constraints для stage relation, workflow, meeting status, contact privacy,
  correction uniqueness и confirmed deal value;
- insert trigger для projection-aligned previous stage, terminal exclusivity,
  latest-effective correction, chronology и active scheduled meeting lifecycle;
- owner/event/time и owner/opportunity/time indexes для funnel/rebuild.

Upgrade backfills meeting rows, допустимые в predecessor schema без
`meetingStatus`, как `scheduled`. Если legacy commercial timestamps идут назад
в append order, migration останавливается до создания небезопасного chronology
anchor; автоматическая перестановка audit history не выполняется.

`last_event_id` и `last_stage_event_id` могут ссылаться только на event той же
opportunity и tenant. UPDATE/DELETE ledger rows запрещены append-only trigger.

## Contact privacy

Raw contact reference не хранится в ledger, не возвращается API и не
логируется. При наличии значения сохраняются только channel, contact path type,
tenant-scoped HMAC и безопасная redacted label. Hash не публикуется.

Старые raw значения очищаются additive migration. Если секрет для HMAC не
настроен, запись с raw reference fail-closed с `503`; значение не оказывается
в БД или логах. Если другому продукту нужен raw contact, ему требуется
отдельное защищённое storage с retention, encryption, audit и access policy.

## Funnel semantics

Summary принимает один явный cohort:

```text
cohort=shown     (default)
cohort=accepted
```

Когорта — opportunities, у которых первое выбранное событие произошло в
`[from, to)`. Downstream должен принадлежать той же opportunity, иметь
`occurredAt >= upstream occurredAt` и произойти до `to`. Analytics filters
применяются к immutable snapshot cohort event.

API разделяет:

- `activityCounts` — distinct opportunities с событиями в периоде;
- `cohortCounts` — достигнутые стадии одной выбранной когорты;
- `conversions` — same-opportunity intersections с явными `sampleSize` и
  `converted`;
- `terminalOutcomes` — mutually exclusive won/lost и win rate только среди
  завершённых циклов.

Lost не является линейной обязательной ступенью. Отдельно считаются ветви
contacted/replied/meeting/proposal → lost и proposal → won. При sample меньше
10 UI показывает «Недостаточно данных», но абсолютные numerator/denominator
остаётся видны.

Расчёт выполняется tenant-scoped SQL CTE, ledger целиком в Node.js не
загружается. Локальный benchmark:

```powershell
npm.cmd run opportunity-outcomes:benchmark
```

Он создаёт только TEMP fixture на 10 owners, 100 profiles, 10 000
opportunities и 100 000 events, запускает `EXPLAIN (ANALYZE, BUFFERS)` и
откатывает transaction. Его результат — локальное измерение, не обещание
production latency.

## Projection rebuild

Dry-run — режим по умолчанию:

```powershell
npm.cmd run opportunity-outcomes:rebuild
npm.cmd run opportunity-outcomes:rebuild -- --owner-id 123
npm.cmd run opportunity-outcomes:rebuild -- --apply --owner-id 123
```

`--apply` и `--dry-run` взаимоисключающие; неоднозначный запуск завершается до
подключения к БД.

Rebuild обрабатывает owners отдельно и перед чтением берёт exclusive
transaction advisory lock того же owner namespace. Writers используют shared
lock, поэтому rebuild и запись одного owner сериализуются без lost update;
разные owners не блокируют друг друга.

Reducer воспроизводит append order, commercial/workflow state, snooze/resume,
corrections, first/last timestamps, last stage event, won/lost и deal value.
Apply делает upsert и удаляет только stale projection rows выбранного owner.
Повторный dry-run после apply обязан вернуть `rebuildChanged=0`.

Counters: `ownersScanned`, `opportunitiesScanned`, `eventsScanned`,
`workflowStatesRebuilt`, `correctionsApplied`, `rebuildChanged`,
`rebuildFailed`. Notes, contacts и deal amounts не логируются.

## Verification

```powershell
npm.cmd run web:check
npm.cmd run web:build
npm.cmd run db:validate
npm.cmd run test --workspace @recruiter-radar/web -- --runInBand --testPathPattern=opportunit

$env:DATABASE_URL='<isolated PostgreSQL admin URL>'
npm.cmd run db:migrate
npm.cmd run test:opportunity-engine:db
npm.cmd run test:opportunity-engine:down
npm.cmd run opportunity-outcomes:rebuild
npm.cmd run opportunity-outcomes:rebuild -- --apply --owner-id <fixture-owner>
npm.cmd run opportunity-outcomes:rebuild -- --owner-id <fixture-owner>
npm.cmd run opportunity-outcomes:benchmark
```

## Rollout

1. Применить migrations при всех flags `false`.
2. Выполнить PostgreSQL runtime/down verifiers и rebuild dry-run.
3. Включить ledger backend для одного internal owner.
4. Проверить snooze/resume, chronology rejection и projection parity.
5. Включить UI canary для того же owner.
6. Вручную пройти основную funnel и ветви won/lost.
7. Сверить cohort denominators и immutable snapshot filters.
8. Контролировать latency, lock contention и duplicate/replay counters.
9. Расширять canary только после стабильного полного цикла.
10. External ingestion оставить выключенным.

Rollback начинается с выключения UI и ledger flags. После завершения активных
transactions сохранить ledger/counters и оценить owner-scoped rebuild. Down
migration имеет fail-safe guard: она не удаляет semantics новых событий
молча, а также отказывается удалять active snooze state или единственное
защищённое contact representation. Schema rollback допустим только после
backup и отдельного одобрения.

## Ограничения текущей аналитики

Funnel описательная, а не причинная; small sample не статистически значим.
Downstream закрыт границей `to`, поэтому молодые cohorts имеют меньше времени
на конверсию. Поддерживается RUB и подтверждённая сумма без revenue forecast.
External ingestion остаётся недоступным до tenant credential design.

## Outcome Ledger Definition of Done

- весь semantic payload участвует в idempotency;
- snooze не меняет commercial stage, resume является отдельным event;
- stage chronology enforced, observational backfill задокументирован;
- funnel использует same-opportunity intersection и явную cohort;
- concurrent rebuild/writer защищены общим owner-lock protocol;
- meeting cancellation/no-show не продвигают stage;
- actor, tenant, projection reference и deal invariants enforced в БД;
- corrections append-only и ограничены последним stage event;
- raw contact отсутствует в ledger/API/logs;
- external ingestion выключен до owner-bound credentials;
- clean/upgrade/down migrations, runtime DB tests, rebuild parity, Jest,
  typecheck, production build и CI проходят при flags `false`.
