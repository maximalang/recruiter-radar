# Commercial Signal Engine — production readiness (2026-08-07)

This document is the operational source of truth for PR #163. It describes what is implemented and testable in code. It does **not** claim that a production canary has been executed or that Commercial Signal scores are calibrated probabilities.

## Core invariant

The authoritative Commercial Signal path is:

`Source Record → Company Event → Company State Change → Signal Episode → Commercial Thesis → Agency DNA Match → Qualified Opportunity → Actionability → Actionable Lead`

A raw vacancy, parser row, digest candidate, legacy FIUR score, or model-generated narrative cannot enter authoritative Today directly.

Authoritative Today fails closed and accepts only a persisted `commercial-signal-card-v1` with `scoreVersion=opportunity-v3` and `status=qualified_actionable`. `qualified_needs_enrichment`, raw/legacy opportunities, stale episodes, and records without the exact card stay out of the action queue. Research Mode may remain broader for operator investigation.

## Migration / provenance hardening

The migration chain now has reversible down migrations for `20260807173500` and `20260807173600`.

`company_event_publications` uses immutable publication fingerprints as replay identity. The original v1 `BEFORE UPDATE OR DELETE` rejection trigger is replaced in `173600` by:

- UPDATE → no-op, allowing persistence to append a new fingerprinted source snapshot;
- DELETE → hard reject;
- exact replay → existing `publication_fingerprint` uniqueness remains idempotent.

The down migration restores the original combined mutation guard exactly. The preceding `173500` down migration restores the earlier signal replay guard so the complete migration chain can round-trip in reverse order.

## Bypass audit

| Surface/path | Classification | Guard |
| --- | --- | --- |
| Commercial Signal canary writer | authoritative | exact query execution → signal → Company Event → Signal Episode → candidate/opportunity lineage required |
| `/opportunities` default Today for authoritative workspace | authoritative | exact v3 Commercial Signal card + `qualified_actionable`; fail closed |
| `/opportunities` Research Mode | investigation only | broader records intentionally visible, never reclassified as actionable by the reader |
| Legacy opportunity engine / FIUR jobs | isolated fallback | retained for non-canary workspaces and rollback; cannot become authoritative Today for the configured Commercial Signal workspace |
| Legacy daily radar/digest | isolated fallback | canary workspace is excluded from legacy delivery |
| Query Planner source ingestion | supply only | cannot create a lead without downstream event/state/episode/thesis/DNA/scoring lineage |
| LLM-generated text | explanation only | not accepted as event, evidence, score input, status, or actionability fact |

The legacy opportunity engine remains in the repository because instant rollback and non-canary workspaces still depend on it. That is an isolated fallback, not a second authoritative Commercial Signal path.

## Event Support Registry

The executable registry is `apps/web/lib/opportunities/company-event-support-registry.ts`. Presence in the database enum is not equivalent to production support.

### Production-supported event normalization

| Event | Real source / derivation | Role |
| --- | --- | --- |
| `job_posting` | approved evidenced vacancy observation | atomic evidence; never a lead alone |
| `vacancy_repost` | deterministic comparison of evidenced vacancy observations | context/corroboration |
| `vacancy_salary_change` | deterministic evidenced before/after salary snapshots | context/corroboration |
| `vacancy_cluster` | deterministic cluster of evidenced vacancies | hiring-pattern evidence |
| `recruiter_vacancy` | evidenced recruiting/TA vacancy | external-agency propensity context only |
| `new_region` | evidenced recent vacancies plus older hiring history | state-change evidence with baseline guard |
| `hiring_restart` | evidenced historical hiring + quiet gap + recent vacancies | state-change evidence |

### Context-only: schema supported, no active production ingestor

These cannot originate a Commercial Signal episode and must never be inferred by an LLM:

- `leadership_change`
- `new_business_unit`
- `office_opening`
- `product_launch`
- `funding_or_investment`
- `major_contract`

They may become contextual evidence only after a future permitted direct/official source is implemented and the normal hiring-state trigger exists independently.

### Unsupported production Company Events

- `career_page_change` — schema placeholder; no production normalizer emits it.
- `hiring_slowdown` — represented through Company State baseline/deceleration semantics rather than a production Company Event.

## Evidence and episode rules

Evidence is required for normalized Company Events. Cross-source corroboration is useful only after source identity/dedup rules; reposts/mirrors from one physical origin must not be counted as independent corroboration.

Signal Episodes are triggered from meaningful Company State change, not from a context event alone. Vacancy repost/recruiter/business context can strengthen classification but cannot bypass the state-change gate.

## Opportunity Quality vs Actionability

The persisted states are intentionally distinct:

- `qualified_actionable` — strong enough and operable now; eligible for authoritative Today while current.
- `qualified_needs_enrichment` — quality can be strong, but a safe operational contact/surface is not yet present; queued for enrichment and excluded from Today.
- rejected/weak/stale — not actionable.

Corporate-surface enrichment is supporting/contact evidence only and is attached to exact Commercial Signal lineage. It cannot originate a hiring episode or opportunity.

## Query Planner v2 adaptive supply loop

The planner remains tenant scoped by `workspace_id` and `client_profile_id`. Latest yield is keyed by source + role family + resolved/requested geography for the same profile.

Materialized downstream metrics now include:

- `execution_count`
- `zero_result_executions`
- `fetched_records`
- `unique_events`
- `unique_companies`
- `new_company_events`
- `episodes`
- `qualified_episodes`
- `qualified_opportunities`
- `actionable_opportunities`
- `stale_opportunities`
- `accepted`
- `contacted`
- `replied`
- `meetings`
- `won_opportunities`
- `duplicate_rate`
- `stale_rate`
- `zero_result_rate`
- qualification/conversion rates

Expired Signal Episodes do not count as actionable yield. The latest `qualified_episodes` and `stale_opportunities` values are fed back into the same Query Planner v2. High duplicate/zero-result/zero-qualified yield reduces budget; repeated qualified-but-non-actionable or stale-heavy yield also reduces budget; expansion requires downstream commercial evidence such as actionable conversions, replies, meetings, or wins. Raw fetched volume alone never increases budget.

## Evaluation, labels, and maturity

Required ranking baselines:

1. vacancy count;
2. freshness/recency;
3. legacy FIUR;
4. Opportunity Scoring v2;
5. Commercial Signal / Opportunity Scoring v3.

The evaluation stack reports Precision@5, Precision@10, NDCG@10, qualification/conversion rates, profile/episode coverage, source yield and query-plan yield where the dataset provides those dimensions. Missing persisted scores remain unavailable/null rather than fabricated zero scores.

Canonical false-positive taxonomy:

- `ordinary_hiring`
- `weak_agency_fit`
- `weak_external_need`
- `bad_economics`
- `stale_signal`
- `duplicate_event`
- `unverified_company`
- `wrong_role`
- `wrong_region`
- `internal_recruiting_sufficient`
- `no_actual_change`

Older operator aliases remain accepted at the annotation boundary for backward compatibility and normalize into the canonical evaluation taxonomy when applicable.

### Outcome maturity

A contacted opportunity without a reply is **not** immediately a negative label. The default no-reply maturity window is 168 hours (7 days):

`contacted → waiting → replied OR mature no-reply`

Before maturity, `replied` is `null` and is excluded from reply-rate denominators. Explicit terminal loss/dismissal in the export path may mature the outcome earlier.

### Calibration status

No numeric Commercial Signal score is a calibrated probability of buying recruiting agency services.

Calibration target is at least:

- 300 real reviewed opportunities;
- at least 60 holdout reviews (20% of the target);
- explicit diversity review across multiple agency types, Signal Episode types, role families, and industries.

If the real reviewed sample is below the target, `calibrationStatus = insufficient_data`. Passing sample-size gates still yields `review_required` until diversity/holdout integrity is reviewed. Synthetic fixtures are contract tests only and never constitute production quality evidence.

## Contract verification

The existing CSE matrix remains exactly 20 numbered contracts (`CSE-01` … `CSE-20`). CI additionally executes fail-closed surface contracts for:

- raw/legacy opportunity cannot enter authoritative Today;
- `qualified_needs_enrichment` cannot enter authoritative Today;
- every Company Event enum value has an explicit support classification;
- context/unsupported business events are not advertised as production sources;
- stale-heavy Query Planner supply reduces budget;
- evaluation maturity and calibration-target semantics;
- migration down/round-trip safety.

## Canary checklist

Before calling the production canary complete:

1. Keep global Commercial Signal rollout dark.
2. Configure exactly one internal workspace as the canary.
3. Confirm the canary workspace is excluded from legacy digest delivery.
4. Allow only explicitly approved live source adapters; keep Habr scrape blocked unless separately approved.
5. Run the full migration chain and rollback contract on a clean database.
6. Run the 20 CSE contracts plus authoritative Today/event-support/adaptive-supply surface contracts.
7. Run one real raw-source path end to end and preserve exact source/query/event/episode/evidence/opportunity lineage.
8. Verify rerun idempotency: no duplicate publication, episode, opportunity, or delivery.
9. Verify `qualified_needs_enrichment` routes to enrichment, not Today.
10. Verify stale opportunity disappears from actionable Today/yield.
11. Review top-20 candidates manually and record annotations with the canonical reason taxonomy.
12. Verify one explicit rollback to legacy mode succeeds without schema rollback.
13. Verify full CI is green on the final SHA.
14. Do not claim calibration or production precision until real reviewed/holdout targets are met.

## Current limitations

- A production canary is not proven by CI alone and must not be reported as executed without production credentials/source access and operator review.
- Real labeled/holdout data may be insufficient; the evaluator must report that explicitly rather than substituting synthetic quality claims.
- Leadership/funding/product/contract/office/business-unit events have no active production ingestor in this PR and remain context-only.
- `career_page_change` has no production Company Event normalizer.
- The legacy opportunity engine remains as a deliberate non-authoritative fallback for rollback/non-canary workspaces.
