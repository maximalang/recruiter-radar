# Commercial Signal Quality Engine v2

## Status and boundary

Quality Engine v2 is an additive, tenant-scoped shadow layer over the existing
Company Events → Company State → Signal Episodes → Commercial Thesis →
External Agency Propensity → Agency DNA Match → Opportunity Scoring v3 chain.
It does not replace v3, change Today readers, tune production weights, generate
facts with an LLM, or represent a probability of winning a deal.

The runtime flag is `COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED`. It accepts only the
exact string `true` and defaults to dark. The repository persists append-only
shadow snapshots; no cron route or UI reader is enabled by this change.

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

## Evidence provenance

Each evidence row stores:

`source_family`, `source_domain`, `upstream_origin`, `canonical_url`,
`vacancy_fingerprint`, `publication_fingerprint`, `organization_domain`,
`content_fingerprint`, and `observed_at`.

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
unless `COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED` is exactly `true`. Their metrics
use exact plan/candidate lineage, an exact Quality v2 identity and generation,
and effective outcome projections rather than raw events that may be reverted.

## Persistence schema

- `commercial_signal_quality_snapshots`: append-only aggregate, components,
  reason codes, feature versions, model/calibration status and candidate scope.
- `commercial_signal_quality_evidence`: exact evidence provenance,
  independence group, and correlation reason.
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

Temporal evaluation uses ordered train/validation/holdout periods. A scored row
containing evidence observed after its decision timestamp is rejected; the
evaluator never keeps its precomputed score after merely filtering timestamps.
Outcome learning similarly excludes corrected events, candidates not yet shown,
and outcomes after the fixed clock. Automatic production weight
updates and production ML rollout are explicitly disabled.

## Verification commands

```powershell
npm.cmd run web:check
npm.cmd run db:validate
npm.cmd run test:commercial-signal-quality-v2:db
npm.cmd run test:commercial-signal:evaluation-v2
npm.cmd run commercial-signal:evaluate-v2
```

The PostgreSQL command requires an isolated disposable database and must not be
run against user or production data.
