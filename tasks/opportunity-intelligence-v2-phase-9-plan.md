# Opportunity Intelligence v2 — Phase 9 plan

**Source:** approved Phase 9 roadmap and the current Outcome Ledger contract.
**Branch:** `codex/opportunity-intelligence-v2-phase-9`.
**Base:** `codex/opportunity-intelligence-v2` at merge `8cbe22e`.
**Default state:** disabled; no production rollout or scoring-weight changes.

## Contract

Phase 9 extends the existing effective-event funnel into statistically honest,
tenant-scoped outcome analytics and a PII-free calibration dataset. It does not
create another ledger, projection or forecast model. Corrections continue to
remove reverted events from effective results while the append-only ledger
remains the source of truth.

The analytics API supports these dimensions:

1. Agency DNA version and client profile.
2. Hiring mode, role family, industry, region and organization-size bucket.
3. Episode type and source family.
4. Confidence gate, score bucket, external-support-need bucket and scoring
   version.
5. Contact channel, contact-path type and assigned user.

It reports cohort size, converted count, conversion rate, maturity/sample
status, median elapsed time, won/lost totals, controlled reason codes and only
confirmed RUB deal values. Revenue forecast is explicitly absent.

## Statistical honesty rules

- Cohorts use the first effective event ever, selected in a closed `[from, to)`
  window; downstream events are capped at `to`.
- Conversion rates remain `null` below the documented minimum sample.
- Rates and terminal win rate remain `null` while the entire selected cohort is
  immature, preventing right-censoring from being presented as performance.
- Medians require at least three observed transitions.
- Channel and contact-path filters are valid only for a `contacted` cohort, so
  an outcome-dependent filter cannot silently inflate an accepted-to-contacted
  rate.
- Assigned-user attribution is captured on the immutable outcome event at
  write time. Historical rows are `unknown`; current workflow state is never
  retroactively joined into old cohorts.
- Revenue is a factual sum of effective `won` events with both `value_minor`
  and `currency='RUB'`. Missing values are counted and never imputed.
- Lost/dismissed reasons use controlled reason codes only. Free-text notes are
  neither aggregated nor exported.

## Trust boundaries and abuse cases

| Boundary | Abuse case | Required control |
| --- | --- | --- |
| Analytics route | Cross-workspace cohort disclosure | exact Auth v2 workspace, `opportunities:read`, owner/workspace SQL scope, disabled flag |
| Export route | Internal IDs, personal fields or free-text notes leak | `exports:create`, strict output allowlist, public opportunity UUID only, no user/contact/reason-note/metadata fields |
| Assignment filter | Mutable workflow state rewrites history | append-only event-time `assigned_user_id`; legacy rows remain unknown |
| Channel/path filter | Survivorship bias makes conversion look perfect | allow only with the contacted cohort and disclose the cohort policy |
| Reverted events | Corrected outcomes still count | effective-event anti-join shared by summary and export |
| Revenue | Forecast or imputed values appear as fact | confirmed values only; expose won-with-value and won-without-value counts |
| Small/young cohorts | False statistical confidence | independent sample and maturity states; rates hidden until both are ready |
| Query volume | Unbounded scans or exports | maximum 366-day period, bounded export rows, one aggregate query, measured PostgreSQL plan |
| Telemetry | PII or high-cardinality payload leakage | stable event names and bounded counts/durations only; never log filters, bodies or exported rows |

## API and storage slices

1. Add `OPPORTUNITY_ANALYTICS_V2_ENABLED=false` and fail-closed context helpers.
2. Add nullable `assigned_user_id` to `opportunity_outcome_events`, capture the
   current workflow assignee on new events and leave historical rows unknown.
3. Add `GET /api/opportunities/outcomes/analytics` with strict filters and the
   statistically honest summary contract.
4. Add `GET /api/opportunities/outcomes/calibration-export` for deterministic
   UTF-8 CSV rows capped at 5,000 records.
5. Add isolated PostgreSQL tenant/correction/maturity/revenue proof, a measured
   100k-event query benchmark, docs, rollout notes and rollback refusal once
   assignment attribution exists.

## PII-free calibration row

The export may contain the public opportunity reference, cohort timestamps,
immutable cohort dimensions, controlled channel/contact-path/reason codes,
first effective stage timestamps, maturity/sample markers, terminal status and
confirmed RUB value. It must not contain owner/workspace/internal opportunity
IDs, assigned-user identity, organization/person names, emails, phones,
contact-reference hashes/labels, reason notes, arbitrary metadata or evidence
URLs.

## Operability questions

1. Are requests succeeding, how long do the aggregate/export queries take and
   how many rows/cohort members do they return?
2. Which requests are rejected because of invalid periods, filters or export
   limits without logging the filter values themselves?
3. How many won outcomes have confirmed values versus missing values, so an
   operator can tell whether calibration is ready without inventing revenue?

## Verification

- Focused RED/GREEN tests for maturity/sample suppression, filter semantics,
  corrected-event exclusion, confirmed revenue and PII-free export.
- Isolated PostgreSQL migration, tenant-isolation and runtime aggregation proof.
- Before/after `EXPLAIN (ANALYZE, BUFFERS)` evidence on the 100k-event fixture;
  add an index only if the measured plan requires it.
- `npm.cmd run db:validate`, `npm.cmd run web:check`, test types, full Jest and
  `npm.cmd run web:build`.
- Five-axis review, staged secret scan and CodeGraph signature/impact gate.
- Feature flag remains false and no production scoring calibration is applied.
