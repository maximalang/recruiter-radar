# Opportunity Intelligence v2: current-state contract

Статус: current-state contract через Phase 10; production rollout flags выключены
Дата среза: 2026-08-02
Implementation baseline: `046dc4f` (Phase 10 integration merge)

Этот документ описывает текущее согласованное поведение Phase 0–10. Исторические
phase-документы сохраняют решения отдельных срезов, но при расхождении
authoritative является этот current-state contract вместе с актуальной schema и
runtime-кодом. Production deploy и включение flags не являются частью merge.

## Архитектурные решения

Следующие границы обязательны для Opportunity Intelligence v2:

```text
Outcome Ledger:
authoritative commercial event history

Outcome State:
rebuildable projection

client_profiles:
base of Agency DNA

Auth v2 workspace:
logical tenant and authorization boundary

owner_id:
temporary compatibility data partition key

actor_user_id:
actual user who performed the action
```

Следствия:

- новый коммерческий ledger, параллельная воронка или отдельная модель lead
  feedback не создаются;
- `opportunity_outcome_events` не обновляется и не удаляется;
- `opportunity_outcome_state` может быть полностью перестроен из ledger;
- `opportunities.status`, `client_episode_state` и `opportunity_actions`
  сохраняются только как compatibility paths до контролируемого удаления;
- `workspace_id` должен стать tenant key для авторизации, но не заменяет
  реального `actor_user_id`;
- историческая атрибуция не восстанавливается догадками.

## Current-state map

### Evidence и Hiring Episode

| Authority | Current source | Назначение |
| --- | --- | --- |
| Публичные hiring facts | `signals`, `evidence_items`, source adapters | Нормализованные сигналы и supporting evidence |
| Каноническая вакансия | `apps/web/lib/opportunities/hiring-episode-detection.ts` | Дедупликация публикаций перед episode detection |
| Hiring Episode | `hiring_episodes`, `hiring_episode_evidence` | Детерминированная группировка evidence по компании и эпизоду |
| Detection checkpoint | `hiring_episode_detection_state` | Идемпотентный progress и retry state |

`hiring_episodes` не tenant-scoped: это company/evidence layer. Tenant-specific
решение начинается на `client_profiles`, `digest_candidates`,
`client_episode_state` и `opportunities`.

### Agency profile, FIUR и Opportunity

`client_profiles` — текущая база профиля агентства. В ней уже существуют:

- agency name;
- specialization;
- roles;
- industries;
- target city и excluded locations;
- company sizes;
- include/exclude keywords и excluded industries;
- remote-friendly;
- hiring mode;
- FIUR thresholds;
- contact policy;
- delivery preferences.

`apps/web/lib/clientProfiles.ts` преобразует persisted profile в
`AgencyProfile`. `apps/web/lib/scoring/fiur.ts` остаётся объяснимым feature
layer. Он учитывает fit, intent, urgency и reachability, но не является
вероятностью сделки.

`apps/web/lib/opportunities/opportunity-scoring.ts` формирует компоненты
`agencyFit`, `hiringIntent`, `externalSupportNeed`, `timing`, `reachability` и
`confidence`. Текущая версия — `opportunity-v1`. Hard gates сохраняют
profile exclusions, minimum fit, minimum external-support need и confidence
review.

`apps/web/lib/opportunities/opportunity-brief-builder.ts` строит
детерминированный brief без LLM. Он использует episode facts и ограниченный
agency context. В opportunity сохраняются:

- score components и `confidence_gate`;
- `scoring_version`, `fiur_version`, `brief_builder_version`;
- `episode_evidence_hash`, `profile_snapshot_hash`,
  `scoring_config_hash`, `input_hash`;
- детерминированные title, why-now, hypothesis, angle, persona и action;
- safe limitations и evidence timeline через API projection.

`profile_snapshot_hash` фиксирует hash выбранных profile dimensions, но
immutable snapshot самого профиля и монотонная Agency DNA version сейчас не
хранятся.

### Opportunity identity и supersession

Tenant-specific opportunity сохраняется в `opportunities` и имеет
`owner_id`, `client_profile_id`, `organization_id`, `hiring_episode_id` и
nullable `workspace_id`.

Current opportunity определяется комбинацией profile + episode и
`superseded_at IS NULL`. Смена scoring version supersede-ит прежнюю строку;
исторические строки и их audit history не должны удаляться.

### Outcome Ledger

`opportunity_outcome_events` — единственная authoritative история
коммерческих событий. Граница контекста события:

```text
owner_id
+ client_profile_id
+ opportunity_id
+ hiring_episode_id
+ organization_id
```

Composite foreign key не позволяет смешивать сущности разных owner contexts.
Таблица append-only: UPDATE и DELETE отклоняются trigger-ом. Идемпотентность
использует tenant-scoped key и canonical payload hash.

Raw contact reference не сохраняется. Writer перед записью создаёт
tenant-scoped hash и безопасный label. Публичный API не возвращает внутренний
hash.

`opportunity_outcome_state` — синхронная rebuildable projection. Её
authoritative поля:

```text
commercial_stage
workflow_state
snoozed_until
meeting_status
```

`current_stage` остаётся compatibility alias для `commercial_stage`.
Projection также хранит first/last timestamps, correction pointers, meeting
lifecycle, terminal reasons и confirmed won value.

`packages/db/scripts/rebuild-opportunity-outcomes.mjs` работает owner-scoped,
по умолчанию в dry-run и требует `--apply` для изменения projection.
`packages/db/scripts/preflight-opportunity-outcomes.mjs` выполняет read-only
проверку ledger/projection invariants.

## Tenant и actor identifiers

| Identifier | Current meaning | Authority | Ограничение |
| --- | --- | --- | --- |
| `workspace_id` | Логический tenant Auth v2 и active workspace сессии | `workspaces`, `workspace_members`, `auth_sessions.workspace_id` | Nullable на compatibility product rows; outcome events получают actor workspace attribution в Phase 1 |
| `dataOwnerId` | Runtime compatibility partition owner | `CustomerAuthorization` | Для `auth_v2` равен `workspace.bootstrap_user_id`; для compat/legacy равен session/legacy user |
| `owner_id` | Persisted compatibility partition key | Product tables и текущие Opportunity queries | Не является фактическим actor team action |
| `user_id` | Реальный account/session user и workspace member | `users`, `auth_sessions`, `workspace_members` | Auth v2 Opportunity routes передают его writer-у при включённом workspace context |
| `actor_user_id` | Идентификатор пользователя, записавшего outcome | `opportunity_outcome_events` | Auth v2 writer сохраняет реального actor; legacy сохраняет compatibility owner |

### Auth modes

`apps/web/lib/auth-v2/authorization.ts` возвращает:

```ts
type CustomerAuthorization = {
  mode: 'auth_v2' | 'auth_v2_compat' | 'legacy'
  userId: string
  dataOwnerId: string
  workspaceId: string | null
  role: WorkspaceRole | null
  session: AuthSession | null
}
```

- `auth_v2`: проверяет active membership, active workspace и запрошенные
  workspace permissions; `dataOwnerId` берётся из `bootstrapUserId`;
- `auth_v2_compat`: использует v2 session user как data owner, role не
  определяется;
- `legacy`: использует legacy owner session, workspace отсутствует.

Phase 1 Opportunity routes вызывают
`getOpportunityAuthorizationContext(permission)` и затем строят
`OpportunityDataAccessContext`. При выключенном workspace context сохраняется
owner-mode compatibility path; при включённом Auth v2 передаются actor,
workspace и role snapshot.

### Current role policy

| Role | Opportunity read | Opportunity write |
| --- | --- | --- |
| owner | да | да |
| admin | да | да |
| recruiter | да | да |
| viewer | да | нет |
| billing | нет | нет |

Permission checks являются workspace-aware только в `auth_v2`. Compat и legacy
остаются временными owner-mode paths.

### Current DB workspace guard

Auth workspace migrations добавили nullable `workspace_id` в
`client_profiles`, `opportunities` и другие product tables. Composite foreign
keys и triggers связывают его с `(workspace_id, owner_id)` membership и
profile context. Application Opportunity queries всё ещё фильтруют по
`owner_id`; `workspace_id` не передаётся в repository contracts.

Outcome events сохраняют `actor_workspace_id` и `actor_role_snapshot` с
nullable legacy compatibility. Их tenant isolation остаётся транзитивно
связанной с composite opportunity context и дополнительно проверяется
`opportunities.workspace_id` в workspace-enabled repository queries.

## Current state machine

### Commercial stage

Основная последовательность:

```text
new | review
→ accepted
→ contacted
→ replied
→ meeting
→ proposal
→ won | lost
```

Допустимые terminal/negative переходы:

```text
new | review → dismissed
accepted → dismissed
contacted | replied | meeting | proposal → lost
```

Meeting lifecycle:

```text
replied
→ meeting(scheduled)
→ meeting_completed
→ proposal
```

После `meeting_cancelled` или `meeting_no_show` commercial stage остаётся
`meeting`; новая `meeting(scheduled)` разрешена. `proposal` разрешён только
после completed meeting.

### Workflow state

`snoozed` и `resumed` не меняют commercial stage:

```text
active → snoozed → active
```

Во время snooze commercial transitions и correction запрещены; observational
events остаются допустимыми. Системный resume выполняется jobs после deadline.

### Observations и corrections

`shown`, `opened`, `exported` не меняют commercial stage. `reverted` добавляет
новое событие и перестраивает projection; исходное событие остаётся в ledger.
Correction capability вычисляется сервером по полной effective history, а не
по загруженной странице UI.

## Queue semantics

При наличии projection очереди используют:

| View | Current filter |
| --- | --- |
| Today | Действия со сроком сегодня, просроченные follow-up, новые high-priority, истёкшие snooze и неназначенные активные возможности |
| Morning | `workflow_state=active`, `commercial_stage IN (new, review)` и существующие evidence/score gates |
| Accepted | `workflow_state=active`, `commercial_stage=accepted` |
| Pipeline | `workflow_state=active`, `commercial_stage IN (contacted, replied, meeting, proposal)` |
| Snoozed | `workflow_state=snoozed` |
| Completed | `commercial_stage IN (won, lost, dismissed)` |

Только при отсутствии projection используется legacy fallback из
`opportunities.status`.

## Feature flags

Все существующие Opportunity flags fail-closed:

| Flag | Current behavior |
| --- | --- |
| `COMPANY_EVENTS_V1_ENABLED` | Включает аддитивную Phase 1 нормализацию Company Events только при точном `true`; по умолчанию `false`, downstream readers не переключает |
| `COMPANY_STATE_V1_ENABLED` | Включает аддитивный Phase 2 Company State build только при точном `true`; по умолчанию `false`, требует отдельного `apply=true&organization=<id>` и не переключает downstream readers |
| `OPPORTUNITY_ENGINE_V1_ENABLED` | Включает engine/API/jobs только при точном `true` |
| `OPPORTUNITY_OUTCOMES_ENABLED` | Включает ledger API только при точном `true` |
| `OPPORTUNITY_OUTCOMES_UI_ENABLED` | Включает Outcome UI только вместе с ledger и при точном `true` |
| `OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED` | Включает workspace-scoped repository reads и реального Auth v2 actor только при точном `true` |
| `OPPORTUNITY_CANARY_OWNER_IDS` | Временный allowlist ровно одного положительного owner ID |
| `OPPORTUNITY_CANARY_WORKSPACE_IDS` | Временный allowlist ровно одного положительного workspace ID; одновременно с owner allowlist запрещён |
| `OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED` | Не может включить endpoint: runtime helper всегда возвращает `false` |
| `OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET` | Server-only secret для tenant-scoped contact hashing |
| `AGENCY_DNA_V1_ENABLED` | Включает Phase 4 только при точном `true`; по умолчанию `false` |
| `AGENCY_DNA_V1_CANARY_WORKSPACE_IDS` | Временный allowlist ровно одного положительного workspace ID только для Agency DNA |
| `OPPORTUNITY_SCORING_V2_ENABLED` | Включает Phase 5 глобально только при точном `true` и включённом Agency DNA v1 |
| `OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS` | Временный allowlist ровно одного положительного workspace ID только для Scoring v2 |
| `OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS` | Временный allowlist ровно одного workspace для append-only v2 comparison snapshots; активные rank и action queue остаются на v1 |
| `OPPORTUNITY_STRATEGIST_V1_ENABLED` | Включает Phase 6 глобально только при точном `true` и включённом Agency DNA v1; read и write paths используют один контекст |
| `OPPORTUNITY_STRATEGIST_V1_CANARY_WORKSPACE_IDS` | Временный allowlist ровно одного положительного workspace ID для Strategist; при очистке сохранённая карточка сразу скрывается |
| `OPPORTUNITY_WORKFLOW_V1_ENABLED` | Включает Phase 7 глобально только вместе с engine, Outcome Ledger и workspace context; UI дополнительно требует Outcome UI |
| `OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS` | Временный allowlist ровно одного положительного workspace ID для Phase 7; общий workspace canary должен включать prerequisite boundaries |
| `OPPORTUNITY_CRM_BRIDGE_ENABLED` | Включает Phase 8 только вместе с engine, Outcome Ledger и workspace context; по умолчанию `false` |
| `OPPORTUNITY_ANALYTICS_V2_ENABLED` | Включает Phase 9 только вместе с engine, Outcome Ledger и точным Auth v2 workspace context; по умолчанию `false` |

Owner canary включает engine, ledger и UI для одного owner, но не включает
external ingest.

Связанные Auth v2 flags:

- `AUTH_PLATFORM_V2_ENABLED`;
- `AUTH_WORKSPACES_V2_ENABLED`;
- `AUTH_ONBOARDING_V2_ENABLED`;
- `AUTH_V2_CANARY_USER_IDS`;
- `AUTH_LEGACY_SESSION_MIGRATION_ENABLED` и deadline;
- `AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED` и deadline.

## API и writers

### Read paths

| Surface | Permission | Current tenant input |
| --- | --- | --- |
| `GET /api/opportunities` | `opportunities:read` | `dataOwnerId`; при Phase 7 также точный `workspaceId` |
| `GET /api/opportunities/:id` | `opportunities:read` | `dataOwnerId` |
| `GET /api/opportunities/:id/outcomes` | `opportunities:read` | `dataOwnerId` |
| `GET /api/opportunities/outcomes/summary` | `opportunities:read` | `dataOwnerId` |
| `GET /api/opportunities/outcomes/analytics` | `opportunities:read` | Точные `dataOwnerId` и Auth v2 `workspaceId`; Phase 9 flag обязателен |
| `GET /api/opportunities/outcomes/calibration-export` | `exports:create` | Точные `dataOwnerId` и Auth v2 `workspaceId`; Phase 9 flag обязателен |
| `/opportunities` page | `opportunities:read` | `dataOwnerId`; при Phase 7 также точный `workspaceId` |

### Command paths

| Writer | Current behavior | Authoritative status |
| --- | --- | --- |
| `POST /api/opportunities/:id/action` | Валидирует legacy payload, преобразует его в canonical outcome command и делегирует тому же writer; добавляет `Deprecation: true`, successor `Link` и usage telemetry | Thin deprecated compatibility adapter; не имеет state machine или отдельной записи |
| `POST /api/opportunities/:id/outcomes` | Выполняет auth/workspace authorization, validation, idempotency, locking, transition validation, append-only event, projections и safe response | Единственный authoritative command pipeline |
| `PATCH /api/opportunities/:id/workflow` | Принимает только пять workflow-полей, обязательный `Idempotency-Key` header и реального Auth v2 workspace actor; foreign/superseded rows скрываются | Отдельный append-only activity writer, не коммерческий ledger и не CRM |
| Schedules в `jobs.ts` | Пишут system `resumed` через transaction outcome writer | Internal writer |
| `POST /api/opportunities/outcomes/external` | Код содержит signed legacy design, но endpoint всегда возвращает 404 | Disabled, не tenant-authenticated |

First-party UI actions теперь используют `/outcomes`:

- `OpportunityActions` отправляет `accepted` и `snoozed` в canonical endpoint;
- `OpportunityOutcomePanel` отправляет все detail-required actions (`dismissed`,
  `contacted` и lifecycle outcomes) в тот же endpoint;
- `shown` и `opened` также записываются через canonical endpoint.

Legacy `/action` остаётся только для внешних/старых клиентов на время миграции.
План удаления зафиксирован в
`docs/opportunity-action-api-deprecation.md`: после двух стабильных релизов и
30 дней без успешных legacy вызовов endpoint можно удалить. До этого telemetry
использования и deprecated headers позволяют завершить миграцию без второй
семантики.

## Immutable analytics snapshot

Каждая новая opportunity сохраняет в `metadata.analyticsCohort` immutable
cohort contract, который копируется в snapshot каждого outcome event:

```text
clientProfileId
clientProfileVersion
agencyDnaVersion
hiringMode
specialization
matchedRoleFamilies
matchedIndustries
matchedRegions
organizationSizeBucket
episodeType
confidenceGate
scoreBucket
externalSupportNeedBucket
sourceFamilies
scoringVersion
```

`GET /api/opportunities/outcomes/summary` принимает immutable cohort filters:
`clientProfileId`, `clientProfileVersion`, `agencyDnaVersion`, `hiringMode`,
`specialization`, `matchedRoleFamily`, `matchedIndustry`, `matchedRegion`,
`organizationSizeBucket`, `episodeType`, `confidenceGate`, `scoreBucket`,
`externalSupportNeedBucket`, `sourceFamily` и `scoringVersion`. Фильтры
применяются к snapshot первого effective cohort event, а не к mutable current
profile. Для старых opportunities без сохранённого cohort используются только
явные значения `legacy-unversioned`/`unknown`; текущий `client_profiles` не
подмешивается задним числом.

## Resolved drift and intentional compatibility

1. **Actor attribution.** Resolved in Phase 1 for enabled Auth v2 context;
   legacy/compatibility rows remain explicitly unattributed.
2. **Workspace audit.** Resolved in Phase 1 with immutable
   `actor_workspace_id` and `actor_role_snapshot`; historical rows are not
   guessed or backfilled.
3. **Repository tenant contract.** Resolved in Phase 1 for list/detail/action,
   history, funnel, and operational-summary queries when workspace context is
   enabled.
4. **Dual writers.** Resolved in Phase 2: `/outcomes` is the sole authoritative
   writer; `/action` only adapts and delegates, with no own state machine or
   separate write.
5. **UI split.** Resolved in Phase 2: first-party UI actions use `/outcomes`;
   `/action` remains only as a deprecated compatibility surface.
6. **User actor invariant.** Resolved in Phase 1: enabled Auth v2 writes persist
   the real workspace member as `actor_user_id`; PostgreSQL verifies recruiter,
   admin, workspace switching and removed-membership history. Legacy mode keeps
   compatibility owner attribution and cannot be silently downgraded while the
   workspace boundary is enabled.
7. **Canary identity.** Phase 1 supports exactly one owner or workspace
   allowlist; production activation remains disabled pending a real owner and
   opportunity.
8. **Agency DNA versioning.** Resolved in Phase 4: `client_profiles` owns a
   monotonic `agency_dna_version` and deterministic snapshot hash; immutable
   opportunity DNA snapshots preserve the version used for scoring.
9. **Cohort dimensions.** Resolved in Phase 2 for new opportunities: the full
   immutable cohort contract is persisted and all documented dimensions are
   parameterized funnel filters. Legacy rows use explicit unknown fallbacks.
10. **External ingest.** Resolved for supported integrations in Phase 8 through
    workspace-scoped credentials, rotation/revocation, signed callbacks and a
    replay ledger. The old global-secret route remains intentionally
    fail-closed and is not a rollout path.
11. **Auth compatibility.** `auth_v2_compat` и `legacy` не имеют role/
    permission snapshot; они допустимы только на ограниченный rollout period.
12. **Historical actor deletion.** Membership removal не удаляет event;
    Phase 1 public history показывает workspace actor role and user id without
    storing personal contact data.

## Legacy compatibility paths и removal plan

| Path | Почему существует | Условие удаления |
| --- | --- | --- |
| `owner_id` как tenant selector | Большинство product tables и jobs построены вокруг owner partition | Все Opportunity reads/writes проверяют workspace и DB invariants доказаны canary |
| `auth_v2_compat` | Переход с legacy session на workspace tenancy | Закрыто migration/rollback window и нет compat sessions |
| legacy owner session | Rollback/migration safety | Auth v2 rollout завершён, legacy exchange отключён и telemetry равна нулю |
| `opportunities.status` | Compatibility UI/jobs и fallback без projection | Все supported opportunities имеют rebuildable projection; fallback telemetry равна нулю |
| `client_episode_state` | Episode suppression и legacy lifecycle | Outcome projection/workflow полностью покрывает suppression и rebuild |
| `opportunity_actions` | Legacy action audit/idempotency | `/action` стал thin adapter, UI usage равно нулю, retention/ledger parity подтверждены |
| `POST .../:id/action` | Старый client contract | Все UI/clients используют `/outcomes`, deprecation telemetry равно нулю |
| owner-only canary | Существующий безопасный rollout boundary | Workspace canary fail-closed и проверен на одном tenant |
| global external ingest route | Ранее подготовленный webhook contract | Не включать; заменить tenant integration credentials в Phase 8 |

Удаление выполняется отдельными additive/deprecation фазами. Immutable
migrations и audit rows не переписываются и не удаляются.

## Phased rollout

### Phase 0 — current-state contract

- только этот документ;
- без runtime, schema и flag changes;
- phase branch и PR в `codex/opportunity-intelligence-v2`.

### Phase 1 — workspace и actor correctness

- единый `OpportunityAuthorizationContext`;
- additive actor workspace/role fields;
- workspace-aware reads/writes и canary compatibility;
- real PostgreSQL tenant/actor tests;
- новый flag остаётся off.

Gate: реальный session actor и active workspace записываются без ослабления
legacy compatibility.

### Phase 2 — единый Outcome Writer

- `/outcomes` становится единственным authoritative command pipeline;
- `/action` превращается в thin deprecated adapter;
- UI переходит на `/outcomes`;
- immutable cohort snapshot расширяется до документированного контракта.

Gate: одинаковая transition, replay и conflict semantics для обоих endpoints.

### Phase 3 — production canary evidence

- read-only preflight;
- workspace-scoped allowlist;
- основной и correction/snooze/meeting сценарии;
- rebuild apply, затем dry-run с `rebuildChanged=0`;
- evidence document без PII/secrets.

Gate: фактический canary либо явный external blocker. Health/preflight без
реального owner opportunity не считаются canary.

### Phase 4 — Agency DNA v1

- additive extension существующего `client_profiles`;
- отдельные tenant-scoped account restrictions;
- immutable version и snapshot;
- backward-compatible profile UX.

### Phase 5 — Opportunity Intelligence Scoring v2

- versioned gated component scoring;
- reproducible inputs;
- offline evaluation на anonymized outcomes;
- без автоматического weight tuning.

### Phase 6 — Evidence-bound Sales Strategist v1

- versioned deterministic `opportunity-strategist-v1` с evidence/heuristic
  lineage для каждого вывода;
- case matching только при совпадении role family, industry, company size,
  region и hiring mode;
- строгий persisted JSON parser, безопасная API-проекция и полная evidence
  timeline в карточке;
- read/write workspace gates и мгновенный rollback при очистке флага;
- LLM не вызывается; будущий optional LLM допускается только как wording editor.

### Phase 7 — daily commercial workflow

- отдельный append-only `opportunity_workflow_events` и rebuildable/current
  `opportunity_workflow_state` для assignment, next action, priority и
  внутренней заметки;
- обязательная tenant/workspace/actor attribution и idempotency, immutable
  events и запрет viewer/billing writes;
- Today/Pipeline/Completed, server-side Moscow day boundary и active-member
  assignee list без email;
- внутренняя заметка видна workspace readers, но удаляется из API analytics
  projection и не попадает в Outcome cohort snapshots;
- переписка, контакты, sequences, CRM entities и automatic outreach не
  добавляются.

Подробный контракт: `docs/opportunity-intelligence-v2-phase-7.md`.

### Phase 8 — export и CRM bridge

- export, signed outbound webhook, templates;
- затем tenant-scoped inbound credentials;
- global external ingest остаётся 404.

### Phase 9 — outcome analytics

- tenant-scoped first-effective-event cohorts `shown`, `accepted` и
  `contacted` с immutable snapshot filters, event-time assignment и closed
  downstream window;
- абсолютные cohort/conversion counts остаются видимыми, а rate/win rate
  публикуются только при sample не меньше 10 и полностью mature cohort;
  median time требует не меньше трёх наблюдений;
- effective won/lost, только controlled reason codes и подтверждённая RUB
  выручка строкой без потери точности;
- deterministic PII-free calibration CSV по явному allowlist, с лимитом 5000
  строк и отказом вместо скрытого truncation;
- revenue forecast отсутствует; глобальный flag остаётся `false`, production
  rollout требует отдельного разрешения и runbook gates.

Полный rollout/rollback контракт:
`docs/runbooks/opportunity-analytics-v2-rollout.md`.

### Phase 10 — product UX completion

- action-first Opportunity surface с `Сегодня`, новыми возможностями,
  необходимостью связаться, ожидаемым follow-up, просроченными действиями и
  активным pipeline;
- Research Mode остаётся вторичным и ищет только по company-level полям и
  заголовку opportunity;
- карточка всегда сохраняет одиннадцать decision sections, не подменяя
  отсутствующие данные декоративным AI-текстом;
- responsive, keyboard, screen-reader и explicit loading/empty/error/no-data/
  insufficient/stale/permission-denied states.

Подробный контракт: `docs/opportunity-intelligence-v2-phase-10.md`.

Для каждой implementation phase порядок rollout:

```text
migration
→ preflight
→ dry-run
→ tenant/workspace canary
→ explicit enablement
→ monitoring
→ rollback
```

Глобальные flags не включаются автоматически.

## Explicitly out of scope

- универсальная база компаний или Контур-подобный продукт;
- полноценная CRM;
- массовый outreach и автоматические cold sequences;
- хранение email-переписки;
- покупка или scraping личных контактов;
- raw personal contact data в ledger или logs;
- LLM как источник фактов, gate или score;
- heuristic score как вероятность сделки;
- автоматическое изменение weights по малой выборке;
- ослабление FIUR/confidence gates ради количества;
- второй outcome ledger или параллельная funnel model;
- изменение immutable migration files;
- автоматическое включение production flags;
- утверждение canary/production evidence без фактического запуска.

## Phase 0 verification scope

Phase 0 не меняет runtime, schema, API или UI. Для него обязательны:

- review документа против указанных source files и migrations;
- `git diff --check`;
- staged secret scan;
- repository documentation checks, если они определены.

Полные runtime/DB/browser gates остаются обязательными для соответствующих
implementation phases и не могут быть засчитаны результатом Phase 0.
