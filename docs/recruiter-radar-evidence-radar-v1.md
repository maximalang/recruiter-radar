# Recruiter Radar — Evidence Radar v1

Evidence Radar v1 — additive evidence-first контур поверх Commercial Signal Engine. Он не заменяет Opportunity v3 и не превращает любой факт о компании в лид.

## Product invariant

Лид существует только как проверяемая цепочка:

`Source Registry → canonical organization → evidence event → normalized signal → correlation → explainable score → staffing forecast → evidence lead card`.

Отсутствующее значение остаётся `unavailable/review`, а не генерируется синтетически.

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
- Commercial Demand → Team Growth → optional Department/Urgent Hiring;
- First-party interest + external hiring context.

First-party interest не создаёт лид без внешнего hiring evidence.

## Explainable score

Основной contract:

`Lead Score = Hiring Intent × Confidence × Freshness × Urgency × Commercial Fit × Contactability − Risk Penalty`.

Каждый компонент ограничен `[0,1]`. UI отдельно показывает Opportunity, Confidence, Urgency, Contactability и Risk. `evidence_lead_score_snapshots_v1` хранит component object, event contribution ledger, input hash, source events, independent source families, version and validity.

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

Personal contacts are outside this model. DB rejects `is_personal = true` and non-generic `mailto:` local parts.

## Regional radar

`/opportunities/radar` is protected by existing `opportunities:read`, Opportunity Engine and Commercial Signal feature gates. The read model always filters by `workspace_id` and only returns cards with non-null verified coordinates.

Visual contract:

- circles = independent sources;
- diamonds = organizations;
- brightness = freshness;
- marker size = hiring intent;
- opacity = geo confidence;
- risk influences color;
- region summary = organizations, source count, intent, freshness, specialization.

Marker orbit is deterministic. `Math.random` is forbidden. Missing verified geometry does not produce invented subject borders.

`/opportunities/sources` exposes the Source Registry and current legal/automation state.

## PostgreSQL safety

Four migrations are deliberately separated:

1. source governance;
2. identity/geography/relationships;
3. evidence/signals/correlations;
4. scores/contacts/cards.

Safety properties:

- composite workspace/organization foreign keys;
- evidence IDs validated against the same organization;
- source-policy DB trigger;
- append-only event/signal/correlation/score/card history;
- identity update audit log;
- company-level contact constraint;
- unique fingerprints;
- every down migration takes `ACCESS EXCLUSIVE` locks before checking for data and refuses destructive rollback when non-empty.

## Validation

Dedicated `Evidence Radar Contracts` workflow runs:

- `npm ci`;
- `web:check`;
- test typecheck;
- full migration chain;
- DB schema validation;
- targeted unit/migration/surface Jest contracts;
- isolated PostgreSQL runtime contract;
- production web build.

The isolated runtime specifically verifies pending-source rejection, legal review transition, cross-organization evidence rejection, cross-tenant lineage, append-only history, personal-contact rejection and non-empty rollback refusal.

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
8. explicit rollout flag/canary;
9. monitoring for source failures, dedupe rate, zero-result rate, lead acceptance/contact/reply/meeting outcomes.

This PR is additive/dark by design: it creates the trustworthy substrate first and does not silently switch existing production readers.
