# Commercial Signal Quality Engine v2

## Status and boundary

Quality Engine v2 is an additive, tenant-scoped shadow layer over the existing
Company Events → Company State → Signal Episodes → Commercial Thesis →
External Agency Propensity → Agency DNA Match → Opportunity Scoring v3 chain.
It does not replace v3, change Today readers, tune production weights, generate
facts with an LLM, or represent a probability of winning a deal.

The runtime flag is `COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED`. It accepts only the
exact string `true` and defaults to dark. The repository persists append-only
shadow snapshots. A protected operator endpoint exists at
`/api/cron/opportunities/build-commercial-signal-quality-v2`; it is dry-run by
default, requires exact workspace and profile scope, and requires
`apply=true` plus exact workspace, profile, and organization scope before it
can append. Dry-runs return a non-mutating lineage cursor accepted as the
`after` query parameter, so an operator can inspect later bounded batches. No
UI reader or automatic reader switch is enabled by this change.

Planner feedback is isolated behind its own exact-`true`, default-dark flag,
`COMMERCIAL_SIGNAL_QUALITY_V2_PLANNER_FEEDBACK_ENABLED`. Enabling shadow quality
collection alone cannot alter query budgets or diagnostics.

## Quality contract

Every quality component has three independent fields:

- `value`: `0..1` or `null` when unknown;
- `confidence`: `0..1`, and `0` for an unknown value;
- `coverage`: `0..1`, describing observed feature coverage rather than quality.

The aggregate exposes `qualityScore`, `qualityCoverage`, `qualityConfidence`,
and `criticalCoverage`. A score cannot become actionable unless critical and
overall coverage gates pass. A missing non-critical component is reported but
does not automatically destroy a strong, well-covered opportunity.
Unknown component values contribute zero effective coverage. Actionability also
requires at least two known, independent provenance groups; unknown-origin
groups never satisfy this gate.

Quality and actionability remain separate. A strong opportunity without a
corporate contact path becomes `qualified_needs_enrichment`; DNC or conflict
always blocks action. A context event without current hiring evidence remains
`review`.

## Deterministic layers

| Layer | Output | Main fail-closed rule |
| --- | --- | --- |
| Signal Independence v2 | provenance groups, coverage, confidence | Republishing one upstream vacancy does not create independent evidence |
| Hiring Friction v1 | level, score, coverage, positive/negative reasons | One normal HH lifecycle repost is insufficient |
| Problem Archetypes v1 | typed archetypes with supporting and contradicting lineage | Acceleration alone does not imply expansion |
| Signal Convergence v1 | co-occurrence, sequence, velocity, recency, contradiction | Future events are excluded and stale events decay |
| Negative Evidence v1 | reduce, review, block, or close | Confirmed negatives require direct or official evidence; LLM assertions are rejected |
| External Agency Propensity v2 | high/medium/low/unknown/blocked | `high` requires complementary need, plausibility, timing, friction and independent convergence |
| Economics Fit v2 | match/partial/mismatch/unknown | Unknown scope is `null`, never inferred revenue |
| Case Similarity | deterministic similarity and missing dimensions | Historical similarity cannot replace current hiring evidence |
| Market Difficulty | approved reproducible observation or unknown | LLM and non-reproducible sources are rejected |
| Outcome Learning v1 | tenant-scoped analytics and shadow recommendations | No-reply is not negative before maturity; small samples cannot update weights |

## Exact Company State and feature semantics

The input builder loads only `candidate.company_state_snapshot_id`. It rejects
a snapshot, state change, event, or evidence item later than `decisionAt`; it
never substitutes latest, nearest, or freshest organization state. The exact
lineage includes the snapshot feature version, classification/confidence,
event/evidence ids, and every attached state change with its own provenance.

Persisted state now supplies growth versus baseline, confirmed slowdown,
observed vacancy lifetime, supported repost rate, normalized role mix,
seniority complexity, regional expansion, and the narrow recruiter-pressure
signal. Minimum sample and known-share gates keep sparse role/seniority data
unknown. A recruiter vacancy alone remains context; actual internal TA
headcount/capacity remains unknown without an explicit source.

`source-feature-capabilities.ts` is the deterministic source-to-feature gate.
Conditional support still requires a real normalized observation. Missing
fields are not negative signals, and an unregistered source cannot turn salary,
repost, or state-derived friction into an observed component.

The shadow report includes per-feature `observed`, `unknown`, `not_supported`,
`not_applicable`, and coverage counts, sliced by source, profile, industry,
region, and role family. The report is aggregate-only and does not expose a
candidate or organization identity.

## Evidence provenance

Each evidence row stores:

`source_family`, `source_domain`, `upstream_origin`, `canonical_url`,
`vacancy_fingerprint`, `publication_fingerprint`, `organization_domain`,
`content_fingerprint`, `observed_at`, `source_kind`, and `decision_role`.
`source_kind` is limited to direct, official, approved context, or deterministic
derivation; LLM provenance is rejected. `decision_role` separates positive
hiring/fit evidence from negative and contact/policy evidence. Only positive
evidence can satisfy the actionability independence gate. Each component
derives an explicit affirmative subset from its typed positive lineage;
negative/context evidence cannot become positive merely because it contributed
to a component. A low-but-known component may have no threshold-qualified
affirmative evidence and remains reviewable without contributing independence.
Positive, negative/context, and contact/policy roles are pairwise
disjoint. Direct and official component declarations must match every linked
evidence row; deterministic derivations remain limited to approved non-LLM
provenance.

Correlation reason codes:

- `EVIDENCE_INDEPENDENT`
- `EVIDENCE_CORRELATED`
- `EVIDENCE_REPUBLICATION`
- `EVIDENCE_SAME_UPSTREAM`
- `EVIDENCE_ORIGIN_UNKNOWN`

The repository refuses persistence if any evidence used by a component is
missing from the exact provenance set, if the set contains unused rows, or if
any row is later than the decision clock. Database foreign keys bind every quality
snapshot to one v3 candidate and every evidence row to that candidate's exact
evidence lineage.

## Important reason codes

Quality and policy:

- `QUALITY_CRITICAL_COVERAGE_LOW`
- `QUALITY_COVERAGE_LOW`
- `QUALITY_NONCRITICAL_DATA_MISSING`
- `QUALITY_INDEPENDENT_ORIGINS_LOW`
- `CURRENT_HIRING_EVIDENCE_MISSING`
- `CORPORATE_CONTACT_PATH_MISSING`
- `DO_NOT_CONTACT`
- `CONFLICT_BLOCK`

Friction and propensity:

- `STANDARD_HH_REPUBLICATION`
- `PERSISTENT_DEMAND_COMBINATION`
- `EVERGREEN_ROLE`
- `MASS_HIRING_SEPARATE_ARCHETYPE`
- `INSUFFICIENT_COMPLEMENTARY_EVIDENCE`
- `HIGH_GATE_NOT_SATISFIED`
- `INTERNAL_TA_CAPACITY_HIGH`
- `EXPLICIT_NO_AGENCIES`
- `PROCUREMENT_BARRIER`

Query Planner feedback:

- `YIELD_BUDGET_REDUCED_WEAK_DOWNSTREAM`
- `YIELD_BUDGET_REDUCED_ORDINARY_HIRING`
- `YIELD_BUDGET_EXPANDED_REVIEWED_COMMERCIAL_YIELD`
- `YIELD_BUDGET_EXPANDED_COMMERCIAL_OUTCOME`

The Quality v2-specific reviewed/ordinary-hiring budget rules remain inactive
unless `COMMERCIAL_SIGNAL_QUALITY_V2_PLANNER_FEEDBACK_ENABLED` is exactly
`true`. Their metrics
use exact plan/candidate lineage, an exact Quality v2 identity and generation,
and effective outcome projections rather than raw events that may be reverted.
Annotations use the latest generation per reviewer and a fail-closed consensus;
historical labels cannot remain active after correction. Only annotations
created inside the exact metric window are eligible for that materialization.

## Persistence schema

- `commercial_signal_quality_snapshots`: append-only aggregate, components,
  reason codes, feature versions, model/calibration status and candidate scope.
- `commercial_signal_quality_evidence`: exact evidence provenance,
  independence group, and correlation reason.
- `commercial_signal_quality_opportunity_lineage`: immutable one-to-one link
  from an opportunity lineage to the exact Quality v2 snapshot used by its
  writer. It must be inserted explicitly in the same transaction; automatic
  candidate/time inference and backfill triggers are forbidden.
- `query_plan_metric_snapshots`: additive independent-event, strong-reviewed,
  ordinary-hiring, and downstream fetch-rate dimensions.

Both quality tables reject updates/deletes. Lossy rollback is refused once
quality history exists. Query-plan quality columns also refuse rollback after
materialized history exists.

## Evaluation boundary

Evaluation v2 preserves P@5 and adds P@10, NDCG@10, quality coverage,
strong/acceptable rate, reply/meeting/won rates, qualified opportunities per
profile/week, a deterministic missed-opportunity sample, and a closed
false-negative taxonomy. Required baselines are freshness, vacancy volume,
FIUR, Opportunity v2, Opportunity v3, and Quality Engine v2.

It also reports feature coverage before/after, unknown feature counts
before/after, promoted/demoted/unchanged status counts, ranking-change reasons
for baseline, repost, lifetime, role mix, seniority, slowdown and recruiter
pressure, plus decisions blocked by exact negative state. Synthetic fixtures
remain contract tests: without a sufficient anonymized real labeled sample the
diagnostics stay `contract_only` and cannot support a precision claim.

Temporal evaluation uses ordered train/validation/holdout periods. A scored row
containing evidence observed after its decision timestamp is rejected; the
evaluator never keeps its precomputed score after merely filtering timestamps.
Each split applies its own closing boundary to effective outcomes; train data
cannot observe validation outcomes and validation cannot observe holdout.
Outcome learning accepts only canonical milestone timestamps from the effective
`opportunity-outcome-state-v1` projection, excludes candidates not yet shown,
and excludes milestones after the fixed clock. Callers cannot submit arbitrary
event arrays as effective outcomes. Projection lineage is globally unique.
Projection candidate, opportunity, lineage, and workspace keys must exactly
match the analyzed candidate. A projection whose last effective event is after
the fixed learning clock is rejected rather than partially rewound.
Evaluation requires the same projection plus a fixed `evaluationAt` cutoff and
rejects both evidence and decision rows later than that cutoff;
untimestamped outcome booleans are not accepted. Automatic production weight
updates and production ML rollout are explicitly disabled.

The input builder starts from one persisted
`commercial_signal_opportunity_lineage` row and verifies the exact candidate,
episode, Agency DNA match, propensity, thesis, company-state, event, and
evidence generations. Missing, stale, or cross-tenant lineage fails closed with
a controlled `QUALITY_LINEAGE_*` code; latest/freshest/nearest fallbacks are not
used. Evaluation separately requires Opportunity v3 and Quality v2 model
lineage to name the same candidate id, candidate generation, and opportunity
lineage id.

The shadow job emits aggregate-only telemetry for v3-to-v2 promotion/demotion,
coverage and confidence bands, missing critical dimensions, friction,
archetype, convergence, negative action, independent-origin coverage, and the
feature-coverage slices described above. It
contains no candidate, organization, evidence text, URL, email, or phone.
Outcome Learning remains tenant-scoped and analytics-only; its slices include
archetype by profile, friction band by profile, convergence pattern, query
plan, case similarity, and quality decile. Reply/meeting/won rates use mature
effective outcome projections only.

## Verification commands

```powershell
npm.cmd run web:check
npm.cmd run db:validate
npm.cmd run test:commercial-signal-quality-v2:db
npm.cmd run test:commercial-signal-quality-v2:down
npm.cmd run test:opportunity-engine:down
npm.cmd run test:commercial-signal:evaluation-v2
npm.cmd run commercial-signal:evaluate-v2
```

The PostgreSQL command requires an isolated disposable database and must not be
run against user or production data.
