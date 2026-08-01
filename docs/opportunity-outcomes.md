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
OPPORTUNITY_CANARY_OWNER_IDS=
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

`OPPORTUNITY_CANARY_OWNER_IDS` — временный серверный allowlist ровно одного
точного положительного `owner_id`. Для этого owner он включает API, UI и ledger
при глобальных Opportunity-флагах `false`; для остальных owners поведение
остаётся fail-closed. Любое второе, duplicate или malformed значение выключает
canary целиком. Allowlist не включает cron или другие глобальные фоновые jobs и
не открывает external ingestion. Пустое значение тоже отключает canary.

## Commercial stage и workflow state

Проекция хранит две независимые оси:

```text
commercial_stage:
new/review → accepted → contacted → replied → meeting → proposal → won
                 ↘ dismissed             ↘ lost

workflow_state:
active → snoozed → active (resumed)
```

`won`, `lost` и `dismissed` terminal. `shown`, `opened` и `exported` —
observational events. Встречи имеют отдельную lifecycle-проекцию:

```text
none → scheduled → completed
                 ↘ cancelled → scheduled
                 ↘ no_show   → scheduled
```

`meeting` означает «встреча назначена» и переводит commercial stage в
`meeting` только при первой попытке. Повторный `meeting` после
`cancelled/no_show` является reschedule, увеличивает `meetingAttemptCount`, но
не повторно продвигает commercial stage. `meeting_completed`,
`meeting_cancelled` и `meeting_no_show` допустимы только для активной
`scheduled` встречи и не меняют commercial stage. `proposal` разрешён только
после `meetingStatus=completed`.

`snoozed` сохраняет текущую commercial stage, записывает deadline и блокирует
следующий коммерческий переход. Контракт продолжения явный: сначала атомарный
`resumed`, затем отдельное коммерческое событие. Expire/build jobs создают
system `resumed`, когда deadline истёк. UI поддерживает 1/3/7/14/30 дней и
ручную дату в разрешённом диапазоне 1–90 дней.

Compatibility-поле `current_stage` пока сохраняется, но authoritative state —
`commercial_stage + workflow_state + snoozed_until`.

## Queue semantics

Пользовательские очереди читают `opportunity_outcome_state`, а не
compatibility-поле `opportunities.status`. Если projection ещё не создана,
используется fail-safe legacy fallback в tenant-scoped `LEFT JOIN`.

| `view` | Условие |
| --- | --- |
| `morning` | `workflow_state=active`, `commercial_stage IN (new, review)` |
| `accepted` | `workflow_state=active`, `commercial_stage=accepted` |
| `pipeline` | `workflow_state=active`, `commercial_stage IN (contacted, replied, meeting, proposal)` |
| `snoozed` | `workflow_state=snoozed` |
| `completed` | `commercial_stage IN (won, lost, dismissed)` |
| `all` | все tenant-owned current opportunities |

Morning Brief не смешивается с commercial pipeline. Operational summary
tenant-scoped и возвращает только lifecycle counts: `newCount`,
`acceptedCount`, `pipelineCount`, `snoozedCount`, `wonCount`, `lostCount`,
`dismissedCount`, `overdueSnoozeCount`. Revenue forecast не рассчитывается.

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
Authority порядка timeline — append-only `id`: это сохраняет стабильность
cursor pagination даже для разрешённого observational backfill. `occurredAt`
показывается как бизнес-время события, но не используется как cursor.

## History pagination

`GET /api/opportunities/:id/outcomes?pageSize=50&beforeEventId=<id>` возвращает
последние события первыми (`sortOrder=append_desc`). `beforeEventId` — opaque
append cursor: следующая страница содержит только события с меньшим event ID.
Ответ содержит `hasMore` и `nextBeforeEventId`; одинаковый `occurredAt` не
нарушает порядок, а событие, добавленное между запросами, не создаёт gaps или
duplicates. UI разворачивает загруженный диапазон для timeline и предлагает
«Показать более ранние события».

Correction capability рассчитывается отдельно от страницы history.

## Corrections

История не редактируется и не удаляется. `reverted` — компенсирующее событие,
которое может отменить только последний действующий stage-changing event или
последнее действующее meeting lifecycle event этой же opportunity и tenant.
Оно полностью перестраивает commercial/workflow/meeting projection,
восстанавливает предыдущую проекцию, сохраняет оба события и само
идемпотентно.

Произвольная коррекция середины цепочки запрещена. UI называет операцию
«Отменить последнее изменение».

### Correction capability

Backend возвращает `correction: { canRevert, targetEventId,
targetEventType, targetOccurredAt }`, вычисленный по полному effective ledger.
Target — последний effective non-observational commercial/meeting event,
который появился после последней correction и ещё не был reverted. Superseded
или snoozed opportunity correction не разрешает. UI не ищет target в
`history.events`.

Каждая history row содержит `isEffective`, `isReverted` и
`revertedByEventId`. После `reverted` исходный event остаётся в timeline как
отменённый, correction остаётся отдельной строкой, а capability становится
`canRevert=false` до нового commercial event. API и additive DB trigger
отклоняют stale, cross-opportunity, cross-tenant и повторный target.

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

Единственный поддерживаемый writer — `recordOpportunityOutcome`: он атомарно
записывает ledger и projection. `BEFORE INSERT` trigger повторяет owner
shared-lock и критические transition, chronology, correction и meeting
lifecycle invariants. Отложенный constraint trigger перед commit дополнительно
требует, чтобы projection ссылалась на вставленный event. Поэтому raw
`INSERT`/import без атомарного обновления projection является неподдерживаемым
и fail-closed; отдельная DB role для приложения не требуется.

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
  `last_stage_event_id`, `last_stage_event_at`, `meeting_status`,
  `active_meeting_event_id`, `last_meeting_event_at`,
  `meeting_attempt_count`;
- composite event identity `(id, owner_id, opportunity_id)` для last-event и
  correction references;
- actor invariant: user/admin требуют `actor_user_id`, system/external
  запрещают его;
- constraints для stage relation, workflow, meeting lifecycle, contact privacy,
  correction uniqueness и confirmed deal value;
- insert trigger для projection-aligned previous stage, terminal exclusivity,
  latest-effective correction, chronology и active scheduled meeting lifecycle;
- deferred write-boundary trigger для обязательной атомарной ledger/projection
  записи;
- owner/event/time и owner/opportunity/time indexes для funnel/rebuild.

Upgrade backfills meeting rows, допустимые в predecessor schema без
`meetingStatus`, как `scheduled`. Legacy `proposal` без отдельного
`meeting_completed` fail-closed: такое состояние требует явной очистки до
migration, потому что migration не выдумывает факт состоявшейся встречи. Если
legacy commercial timestamps идут назад в append order, migration
останавливается до создания небезопасного chronology anchor; автоматическая
перестановка audit history не выполняется.

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

Когорта — opportunities, у которых самое первое действующее выбранное событие
за всю историю произошло в `[from, to)`. Повторный `shown/accepted` внутри
периода не возвращает opportunity в когорту, если первое действующее событие
было раньше `from`. Если самое первое событие компенсировано `reverted`,
identity определяется следующим действующим событием; равные timestamps
разрешаются append-only `id`. Downstream должен принадлежать той же
opportunity, иметь `occurredAt >= cohort occurredAt` и произойти до `to`.
Immutable cohort filters применяются к snapshot первого действующего cohort
event, а не к текущей mutable opportunity. API использует следующие query
параметры: `clientProfileId`, `clientProfileVersion`, `agencyDnaVersion`,
`hiringMode`, `specialization`, `matchedRoleFamily`, `matchedIndustry`,
`matchedRegion`, `organizationSizeBucket`, `episodeType`, `confidenceGate`,
`scoreBucket`, `externalSupportNeedBucket`, `sourceFamily` и
`scoringVersion`. `organizationSizeBucket=unknown` означает, что размер
работодателя не был доказан в сохранённом snapshot; профиль не перечитывается
для исторической когорты.

API разделяет:

- `effectiveActivityCounts` — раздельные `eventCount` и `opportunityCount` по типам
  действующих событий в периоде;
- `ledgerActivityCounts` — raw append-only counts только для диагностики;
- `correctionsCount` — количество `reverted`, не commercial stage activity;
- `cohortCounts` — достигнутые стадии одной выбранной когорты;
- `conversions` — same-opportunity intersections с явными `sampleSize` и
  `converted`;
- `terminalOutcomes` — mutually exclusive won/lost и win rate только среди
  завершённых циклов.

Lost не является линейной обязательной ступенью. Отдельно считаются ветви
contacted/replied/meeting/proposal → lost и proposal → won. При sample меньше
10 UI показывает «Недостаточно данных», но абсолютные numerator/denominator
остаются видны. Отдельный maturity gate сравнивает
`observationWindowDays` самой молодой opportunity в когорте с `maturityDays`
(по умолчанию 30). Conversion получает независимые `sampleStatus` и
`maturityStatus`; UI различает `insufficient_data`, `immature` и `ready`.

Расчёт выполняется tenant-scoped SQL CTE, ledger целиком в Node.js не
загружается. Локальный benchmark:

```powershell
npm.cmd run opportunity-outcomes:benchmark
```

Он создаёт только TEMP fixture на 10 owners, 1000 profiles, 20 000
opportunities и 200 000 events. Проверяемый workspace содержит ровно 100 000
events и 1000 corrections; отдельно запускаются production-подобные summary и
calibration-export `EXPLAIN (ANALYZE, BUFFERS)`. Transaction откатывается. Его
результат — локальное измерение, не обещание production latency.

## Outcome Analytics v2

Phase 9 добавляет отдельные read-only surfaces, не меняя authoritative ledger
и его projection:

- `GET /api/opportunities/outcomes/analytics` требует
  `opportunities:read`;
- `GET /api/opportunities/outcomes/calibration-export` требует
  `exports:create`;
- оба endpoint требуют точные Auth v2 `dataOwnerId` и `workspaceId`, все
  prerequisite Opportunity flags и `OPPORTUNITY_ANALYTICS_V2_ENABLED=true`;
  по умолчанию flag выключен.

Общие фильтры: `clientProfileId`, `clientProfileVersion`,
`agencyDnaVersion`, `hiringMode`, `specialization`, `matchedRoleFamily`,
`matchedIndustry`, `matchedRegion`, `organizationSizeBucket`, `episodeType`,
`confidenceGate`, `scoreBucket`, `externalSupportNeedBucket`, `sourceFamily`,
`scoringVersion`, `channel`, `contactPathType` и `assignedUserId`. Значение
`assignedUserId=unknown` выбирает исторические события без атрибуции. Assignment
фиксируется writer-ом на outcome event в момент события; текущий assignee не
подмешивается задним числом. `channel` и `contactPathType` допустимы только для
когорты `contacted`, чтобы не создавать survivorship bias.

Когорты `shown`, `accepted` и `contacted` определяются первым действующим
событием за всю историю в `[from, to)`. Downstream ограничен тем же `to`, а
`reverted` и компенсированные события исключаются. Ответ показывает cohort
size, converted и sample size, maturity/sample status, median time, effective
won/lost, controlled dismissed/lost reasons и подтверждённую RUB-выручку.
Conversion rate и terminal win rate равны `null`, пока sample меньше 10 или
когорта не прошла полное maturity window; median равна `null` при менее чем
трёх наблюдениях. Сумма возвращается decimal string. Revenue forecast в Phase 9
не рассчитывается.

Calibration CSV использует тот же tenant scope и effective-event CTE. В него
входят только public opportunity reference, immutable cohort dimensions,
timestamps, terminal status/controlled reason, maturity/sample status и
confirmed RUB value. Owner/workspace/internal IDs, assigned-user identity,
`clientProfileId`, свободный `specialization`, названия компаний, контакты,
notes, metadata и evidence URLs отсутствуют.
Экспорт детерминирован, защищён от spreadsheet formula injection и возвращает
ошибку при размере больше 5000 строк вместо неполного файла.

Privacy-safe telemetry сообщает только outcome (`completed`, `rejected`,
`failed`), duration и counts. Фильтры, строки экспорта, IDs, reasons, amounts и
tenant values не логируются. Локальный 100k-event benchmark обязан укладываться
в 1000 ms и использовать owner-scoped event index; датированное измерение и
rollout gates зафиксированы в
`docs/evidence/opportunity-analytics-v2-phase-9-2026-08-02.md` и
`docs/runbooks/opportunity-analytics-v2-rollout.md`.

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

## Migration preflight

До production migration выполняется read-only проверка:

```powershell
npm.cmd run opportunity-outcomes:preflight
npm.cmd run opportunity-outcomes:preflight -- --owner-id 123
npm.cmd run opportunity-outcomes:preflight -- --json
```

Команда запускает один `REPEATABLE READ, READ ONLY` snapshot, не исправляет ledger и
завершается с non-zero code при blocking violations. Она проверяет chronology,
конфликтующие terminal outcomes, snooze и meeting lifecycle, actor pairing,
raw contact, projection parity/references, orphan context, duplicate correction
target и events после supersession. Вывод содержит только owner/opportunity/event
IDs, violation code и counts — без contact, notes, deal value или secrets.

Manual remediation начинается с остановки rollout, DB backup и выгрузки только
IDs/codes через `--json`. Chronology/terminal/lifecycle конфликт исправляется
только документированным correction или новым компенсирующим событием через
штатный tenant-scoped writer, если state machine это разрешает. Нарушения
privacy, actor/context/FK, duplicate correction и post-supersession нельзя
«исправить» обычным событием: для них требуется отдельная incident-specific
admin migration после privacy/legal review, с dry-run по умолчанию, явным
owner/opportunity scope и вторым approval. Этот preflight такую migration не
создаёт и ничего автоматически не меняет. Исторические commercial timestamps и
event rows автоматически не переставляются и не удаляются. После remediation
обязательны повторные preflight, rebuild dry-run и canary.

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
npm.cmd run opportunity-outcomes:preflight
npm.cmd run opportunity-outcomes:rebuild
npm.cmd run opportunity-outcomes:rebuild -- --apply --owner-id <fixture-owner>
npm.cmd run opportunity-outcomes:rebuild -- --owner-id <fixture-owner>
npm.cmd run opportunity-outcomes:canary -- --owner-id <fixture-owner>
npm.cmd run opportunity-outcomes:benchmark
```

## Canary acceptance criteria

До снятия draft для одного внутреннего owner вручную подтверждаются:

1. `shown → opened → accepted → contacted → replied → meeting → meeting_completed → proposal → won`.
2. `contacted → snoozed → resumed → replied`.
3. `meeting → meeting_cancelled → meeting → meeting_completed`.
4. `won → reverted → proposal`.
5. Morning Brief скрывает snoozed и completed.
6. Pipeline показывает contacted/replied/meeting/proposal.
7. Rebuild apply, затем dry-run возвращает `rebuildChanged=0`.
8. Preflight возвращает `ok=true`.
9. Повтор того же idempotency key возвращает replay.
10. Другой payload с тем же key возвращает `409`.
11. Raw contact отсутствует в DB/API/logs.
12. External ingestion возвращает `404` независимо от legacy secret.
13. Cross-tenant доступ отсутствует.

Полный workspace-scoped Phase 3 runbook и privacy-safe evidence contract:
[`docs/opportunity-canary-runbook.md`](opportunity-canary-runbook.md). Датированный
результат хранится в `docs/evidence/`; без отдельного production approval он
должен оставаться `status: blocked`.

## Legacy owner-scoped rollout reference

1. Применить migrations при всех flags `false`.
2. Выполнить PostgreSQL runtime/down verifiers и rebuild dry-run.
3. Выбрать одного internal owner, но оставить
   `OPPORTUNITY_CANARY_OWNER_IDS` пустым и все глобальные Opportunity-флаги
   `false`.
4. До активации выполнить read-only owner-scoped gate:
   `npm.cmd run opportunity-outcomes:canary -- --owner-id <owner> --pre-activation`.
5. Требовать `phase=pre_activation`, `activationReady=true` и `ready=true`:
   migrations, tenant isolation, rebuild parity,
   non-empty owner scope, chronology, meeting lifecycle, replay keys, privacy и
   cohort projection должны быть чистыми; все глобальные flags и external
   ingestion выключены, allowlist пуст. При
   `ready=false` команда завершается с non-zero code.
6. До изменения serving runtime выполнить active probe в отдельном процессе,
   передав `OPPORTUNITY_CANARY_OWNER_IDS=<owner>` только этой команде. Запустить
   owner-scoped dry-run без `--pre-activation` и требовать `phase=active`,
   `activationReady=true`, `ready=true`. Active gate отклоняет глобальные flags,
   несколько owners, duplicate/malformed entries и включённый external
   ingestion.
7. Только после обоих успешных gates персистить ровно один точный owner ID в
   `OPPORTUNITY_CANARY_OWNER_IDS` serving runtime и перезапустить приложение.
   Сразу повторить active gate уже в runtime. При `ready=false` удалить owner из
   allowlist и снова перезапустить приложение до любого ручного canary traffic.
8. Проверить snooze/resume, reschedule/completed meeting и proposal gate.
9. Вручную пройти основную funnel и ветви won/lost.
10. Сверить first-ever cohort denominators, maturity и immutable filters.
11. После owner-scoped rebuild apply повторить dry-run и требовать
    `rebuildChanged=0`.
12. После завершения canary удалить owner из
    `OPPORTUNITY_CANARY_OWNER_IDS`; расширять rollout только после стабильного
    полного цикла.

Rollback canary начинается с удаления owner из `OPPORTUNITY_CANARY_OWNER_IDS`;
глобальный rollback — с выключения UI и ledger flags. После завершения активных
transactions сохранить ledger/counters и оценить owner-scoped rebuild. Down
migration имеет fail-safe guard: она не удаляет semantics новых событий
молча, а также отказывается удалять active snooze state или единственное
защищённое contact representation. Schema rollback допустим только после
backup и отдельного одобрения.

## Ограничения текущей аналитики

Funnel описательная, а не причинная; small sample не статистически значим.
Downstream закрыт границей `to`; maturity metadata явно показывает, когда
самая молодая opportunity ещё не получила минимальное окно наблюдения.
Порог не делает funnel причинным и не заменяет statistical significance.
Поддерживается RUB и подтверждённая сумма без revenue forecast. External
ingestion остаётся недоступным до tenant credential design.

## Outcome Ledger Definition of Done

- весь semantic payload участвует в idempotency;
- snooze не меняет commercial stage, resume является отдельным event;
- stage chronology enforced, observational backfill задокументирован;
- funnel использует first-ever effective cohort, same-opportunity intersection,
  immutable snapshot filters и отдельные event/opportunity counts;
- concurrent rebuild/writer защищены общим owner-lock protocol;
- meeting lifecycle независим от commercial stage, поддерживает reschedule,
  completion/cancellation/no-show и требует completion перед proposal;
- actor, tenant, projection reference и deal invariants enforced в БД;
- corrections append-only и ограничены последним stage/meeting event;
- raw SQL без атомарной projection записи блокируется перед commit;
- raw contact отсутствует в ledger/API/logs;
- external ingestion выключен до owner-bound credentials;
- clean/upgrade/down migrations, runtime DB tests, rebuild parity, Jest,
  typecheck, production build и CI проходят при flags `false`.
