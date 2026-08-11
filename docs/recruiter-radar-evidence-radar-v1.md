# Recruiter Radar — Evidence Radar v1

Evidence Radar v1 — additive evidence-first контур поверх Commercial Signal Engine. Он не заменяет Opportunity v3 и не превращает любой факт о компании в лид.

## Product invariant

Лид существует только как проверяемая цепочка:

`Source Registry → canonical organization → evidence event → normalized signal → correlation → explainable score → staffing forecast → evidence lead card`.

Отсутствующее значение остаётся `unavailable/review`, а не генерируется синтетически.

`review` и `qualified` — разные операционные состояния. `review` означает очередь проверки и не должен отображаться на Radar как готовый повод для outreach. Actionable read model публикует только `qualified` карточки с живым verified provenance.

## Data model

### Canonical organization

`organization_identity_profiles_v1` хранит workspace-scoped identity:

- legal name / brand;
- INN / OGRN;
- primary/additional domains;
- industry / employee band;
- evidence ids;
- resolution status/confidence/basis;
- verified head-office object.

INN/OGRN уникальны внутри workspace. Изменения canonical identity пишутся в append-only `organization_identity_changes_v1`.

`organization_locations_v1` хранит head office / office / branch / warehouse / production / service center, субъект, город, адрес, coordinates, geo confidence и evidence ids. Координаты не обязательны: объект без подтверждённых координат не появляется на карте.

`organization_relationships_v1` связывает parent/subsidiary/branch operator/brand owner/affiliate/successor.

### Administrative geometry

`federal_subject_geometries_v1` принимает только verified `Polygon/MultiPolygon` GeoJSON, source registry id, primary URL, center coordinates, confidence и fingerprint. Вставка проходит через тот же source legal gate. Synthetic boundaries не допускаются.

### Evidence events

`evidence_events_v1` — immutable факт с:

- organization/workspace/location scope;
- event type;
- source registry/source family;
- canonical URL or document id;
- event time and detection time;
- structured facts;
- staffing-need payload when justified;
- confidence and independent confirmations;
- validity, polarity, verification status;
- primary-source flag;
- content/event fingerprints;
- optional superseded event relation.

Pending/blocked source не может записать event: это запрещает DB trigger.

## 20 normalized signals

`normalized_signals_v1` использует фиксированную taxonomy:

1. Hiring Growth
2. Mass Hiring
3. New Region
4. New Office
5. New Department
6. Leadership Change
7. Recruiter Hiring
8. Funding Received
9. Major Contract
10. Product Launch
11. Technology Expansion
12. Production Expansion
13. International Expansion
14. Team Growth
15. Talent Shortage
16. Urgent Hiring
17. Hiring Freeze
18. Downsizing
19. Financial Risk
20. Legal Risk

Typed taxonomy в `evidence-radar.ts` задаёт polarity, base weight, half-life, minimum confirmations, affected functions и dedupe window. Signal history append-only; stale strength decays by half-life.

## Dedupe и republication

Event dedupe priority:

1. content fingerprint;
2. source-family + document id;
3. canonicalized URL;
4. event id only as last identity.

Таким образом, копии одной публикации не считаются независимыми подтверждениями. Correlation layer дополнительно требует минимум две независимые source families для коммерческой цепочки.

## Correlation rules

v1 содержит детерминированные цепочки с window и independent-source requirement:

- Funding → Hiring Growth → optional Recruiter Hiring;
- Major Contract → Hiring Growth → optional Urgent/Talent Shortage;
- New Region → Hiring Growth → optional New Office/Leadership;
- Product Launch → Technology Expansion → optional Hiring/Team Growth;
- Production Expansion → Hiring Growth → optional Mass/Urgent Hiring;
- Commercial Demand → Team Growth → optional Department/Urgent Hiring.

First-party intent пока не имеет отдельного normalized signal type, поэтому v1 **не даёт ему отдельный correlation boost**. CRM/first-party evidence можно хранить только в governed source layer; коммерческий boost допустим после появления явного typed first-party signal и теста, который требует одновременно first-party и external evidence. Это исключает ложный boost от двух обычных hiring-source families.

## Explainable score

Основной contract:

`Lead Score = Hiring Intent × Confidence × Freshness × Urgency × Commercial Fit × Contactability − Risk Penalty`.

Каждый компонент ограничен `[0,1]`. UI отдельно показывает Opportunity, Confidence, Urgency, Contactability и Risk. `evidence_lead_score_snapshots_v1` хранит component object, event contribution ledger, input hash, source events, source signals, source correlations, independent source families, version and validity. PostgreSQL повторно вычисляет score из сохранённых компонентов и отклоняет несогласованный snapshot.

Score snapshot дополнительно требует, чтобы все referenced events были `verified` и live, сигналы имели положительную confidence/strength и не были просрочены, а correlations существовали и были live к моменту snapshot. `valid_until` score не может материально переживать самый ранний event/signal/correlation horizon; допускается только bounded 5-second write skew между отдельными SQL statements.

Это отдельный Evidence Radar score и не меняет additive FIUR contract существующего Opportunity Engine.

## Staffing forecast

Rule-based forecast выдаётся только для поддержанных подтверждённых patterns. Он содержит:

- functions;
- professions;
- seniority;
- bounded min/max headcount;
- targeted/project/mass mode;
- expected start;
- city / federal subject;
- external-agency probability;
- likely decision-maker roles;
- basis signal ids;
- confidence.

Forecast работает только на signals одной организации. Mixed-organization input считается нарушением scope и должен fail closed, а не молча отбрасывать часть входа.

Если оснований мало, UI явно показывает, что прогноз недоступен.

## Evidence lead card

`evidence_lead_cards_v1` связывает одну организацию, verified location, score snapshot, evidence events и company-level contact paths. Карточка показывает:

- organization and legal entity;
- exact city/subject/address when verified;
- Lead Score and components;
- why now;
- staffing need;
- event timeline/direct evidence links;
- primary/supporting source distinction;
- event contribution explanation;
- risk reasons;
- generic/corporate contact path;
- recommended next action/contact window.

`qualified` card требует verified identity, verified geocoded location, live verified evidence и не может переживать score/evidence horizon. `recommended_contact_at` должен попадать внутрь validity window. Unverified/rejected contact path не может попасть в qualified lead.

Personal contacts are outside this model. DB rejects `is_personal = true` and non-generic `mailto:` local parts.

## Regional radar

`/opportunities/radar` и `/opportunities/sources` защищены `opportunities:read`, базовым Opportunity Engine gate и отдельным Evidence Radar rollout gate. `isEvidenceRadarV1EnabledForContext()` использует собственный минимальный prerequisite contract: валидный `workspaceId` и доступный для этого context базовый Opportunity Engine. Outcome Ledger, workspace reader switch и широкий Commercial Signal UI gate не являются prerequisites этих read-only Evidence Radar surfaces: readers обращаются к собственным workspace-scoped таблицам Evidence Radar и не читают outcome/workflow UI state.

Evidence Radar остаётся dark-by-default. Доступ разрешается только одним из двух способов:

- `EVIDENCE_RADAR_V1_ENABLED=true` — явное глобальное включение после выполнения базового Opportunity prerequisite;
- `EVIDENCE_RADAR_V1_CANARY_WORKSPACE_IDS=<workspace ids>` — ограниченный workspace canary при выключенном global flag.

Malformed, zero и negative workspace IDs игнорируются; контекст без workspace остаётся выключенным. Сам Evidence Radar flag не включает автоматически внешние source adapters и не заменяет source-specific legal/contract review.

Actionable Radar read model всегда фильтрует по `workspace_id` и возвращает только:

- `card.status = qualified`;
- live card и live score;
- verified organization identity;
- verified geocoded location;
- live verified evidence events;
- verified company-level contact paths.

Карточки `review` остаются в PostgreSQL для операционной проверки, но не выглядят в UI как готовый лид «пиши сейчас».

Visual contract:

- circles = independent sources;
- diamonds = organizations;
- brightness = freshness;
- marker size = hiring intent;
- opacity = geo confidence;
- risk influences color;
- region summary = organizations, source count, intent, freshness, specialization.

Marker orbit is deterministic. `Math.random` is forbidden. Missing verified geometry does not produce invented subject borders.

`/opportunities/sources` exposes the Source Registry and current legal/automation state from PostgreSQL review history rather than treating the static TypeScript registry as operational approval.

## PostgreSQL safety

Пять migrations разделяют responsibility:

1. source governance;
2. identity/geography/relationships;
3. evidence/signals/correlations;
4. scores/contacts/cards;
5. temporal/qualification trust hardening.

Safety properties:

- composite workspace/organization foreign keys;
- evidence IDs validated against the same organization;
- source-policy DB trigger;
- append-only event/signal/correlation/score/card history;
- source-policy updates require an audited change ledger; source identity/deletion remain blocked;
- identity update audit log;
- company-level contact constraint;
- unique fingerprints;
- reproducible score formula plus live/verified provenance checks;
- qualified-card identity/location/evidence/contact trust boundary;
- destructive down migrations take `ACCESS EXCLUSIVE` locks before checking for data and refuse rollback when non-empty;
- the additive hardening down migration removes only its triggers/functions and never drops Evidence Radar data.

## Validation

Dedicated `Evidence Radar Contracts` workflow runs:

- `npm ci`;
- `web:check`;
- test typecheck;
- full migration chain;
- DB schema validation;
- Evidence Radar unit, rollout-config, repository, migration and surface Jest contracts;
- isolated PostgreSQL runtime contract;
- production web build.

The isolated runtime specifically verifies pending-source rejection, legal review transition, audited source-policy changes, cross-organization evidence rejection, cross-tenant lineage, append-only history, correlation provenance, reproducible score snapshots, personal-contact rejection and non-empty rollback refusal.

Для stacked-релиза дополнительно обязателен финальный PR merge-ref CI после синхронизации с актуальным `main`; зелёный CI дочерней ветки не заменяет эту проверку интеграции.

## Rollout

### MVP

Target adapters: career pages, HH, Работа России, EGRUL, government procurement, official company news and first-party CRM. **Target does not mean automatically enabled**: each external source remains dark until its review and dry-run are complete.

### Phase 2

Funding/issuer data, technology repositories, leadership changes, branches/locations, physical expansion, broader official risk sources, regional official sources.

### Phase 3

Contracted commercial data/media, profile/social evidence where lawful, advanced forecast calibration, learned/personalized weights after sufficient labelled outcomes.

## Production release gates

Before reader switch or source enablement:

1. green CI on one SHA;
2. isolated PostgreSQL contract green;
3. source-specific terms/licence/contract archived;
4. dry-run quality report;
5. entity-match false-positive review;
6. map coordinate/boundary provenance review;
7. no secret/personal-data regression;
8. explicit Evidence Radar rollout flag/canary;
9. monitoring for source failures, dedupe rate, zero-result rate, lead acceptance/contact/reply/meeting outcomes.

This PR is additive/dark by design: it creates the trustworthy substrate first and does not silently switch existing production readers or enable external source automation.
