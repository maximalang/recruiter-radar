# Opportunity Analytics v2 rollout runbook

## Scope and authority

This runbook covers Phase 9 read-only analytics and calibration export. It does
not authorize a production deploy, flag activation, tenant canary, schema
rollback, data repair, or revenue forecasting. Those actions require a separate
explicit approval after every gate below is green.

`OPPORTUNITY_ANALYTICS_V2_ENABLED` is fail-closed and remains `false` by
default. The analytics surfaces also require the engine, Outcome Ledger and
workspace-context prerequisites. Only exact Auth v2 owner/workspace context is
accepted; legacy and compatibility sessions receive no Phase 9 surface.

## Pre-deploy gates

1. Keep all Opportunity flags `false` while applying the additive migration.
2. Back up the database and record the candidate image/SHA.
3. Run the repository gates:

   ```powershell
   npm.cmd run web:check
   npm.cmd run web:build
   npm.cmd run db:validate

   $env:DATABASE_URL='<isolated PostgreSQL admin URL>'
   npm.cmd run test:opportunity-engine:db
   npm.cmd run test:opportunity-engine:down
   npm.cmd run opportunity-outcomes:benchmark
   ```

4. Require PostgreSQL proof for exact workspace isolation, effective-event
   corrections, mature/immature rate gating, confirmed RUB revenue and the
   calibration allowlist.
5. Require the 100k-event benchmark to stay below its 1000 ms regression guard
   and to use an owner-scoped outcome-event index. Treat it as local evidence,
   not a production latency promise.
6. Verify that the down migration succeeds on a clean schema and refuses when
   any event-time assignment attribution exists.

## Pre-activation data review

Before selecting a canary workspace, use read-only queries to confirm that it
already has real Outcome Ledger data. Do not create production data to satisfy
the gate. Record, without personal data:

- workspace and owner IDs in the restricted operator record, not application
  logs or repository evidence;
- cohort counts for `shown`, `accepted` and `contacted`;
- mature cohort counts for the selected observation window;
- confirmed/missing-value won counts, without logging amounts;
- export row count, which must be at most 5000.

Stop if there is no real internal workspace with suitable data. Health,
migration success and an empty response are not canary acceptance.

## Canary activation

After separate activation approval:

1. Enable all existing prerequisite gates for exactly one internal workspace.
2. Enable `OPPORTUNITY_ANALYTICS_V2_ENABLED=true` for that same serving runtime.
3. Verify a reader can open analytics and cannot export without
   `exports:create`; verify an authorized exporter can download the CSV.
4. Compare absolute counts with tenant-scoped SQL for all three cohort types.
5. Verify a compensated win/loss is absent, an effective replacement is
   present, and the confirmed RUB total matches.
6. Verify an immature or sub-10 cohort returns `rate=null` and `winRate=null`;
   verify median time remains `null` below three observations.
7. Inspect the CSV for the explicit column allowlist, deterministic ordering,
   spreadsheet-formula neutralization, and absence of PII/internal IDs.
8. Monitor only privacy-safe events:
   `opportunity_analytics_v2.summary_completed`, `.summary_failed`,
   `.request_rejected`, `.export_completed`, `.export_failed` and
   `.export_rejected`.

## Immediate stop conditions

Disable the Phase 9 flag immediately if any of the following occurs:

- cross-owner or cross-workspace data is returned;
- a reverted/compensated event contributes to a metric or export;
- a rate is non-null for an immature or sub-10 cohort;
- free-text reasons, organization/contact data, assigned identity, internal
  owner/workspace/opportunity IDs, metadata or evidence URLs appear in CSV or
  logs;
- an export over 5000 rows is silently truncated instead of rejected;
- analytics exceeds 1000 ms in the controlled benchmark or shows an unbounded
  production query regression;
- error rate or database load rises materially from the recorded baseline.

Do not expand the canary while any stop condition is open.

## Rollback

1. Set `OPPORTUNITY_ANALYTICS_V2_ENABLED=false` and restart the serving runtime.
2. Confirm both endpoints return `404` for every role and workspace.
3. Preserve outcome events and their assignment attribution for auditability.
4. Do not delete, backfill or rewrite ledger rows.
5. Schema rollback is optional and separate. Run it only after backup and an
   explicit approval. The down migration must refuse while any
   `assigned_user_id` attribution exists; leave the nullable column in place
   rather than erasing audit data.

## Acceptance record

Store a dated privacy-safe record under `docs/evidence/` with commit/image,
commands and results, benchmark plan metrics, canary scope category, stop-gate
status and rollback result. Never include company names, user identity, contact
data, deal amounts, exported rows, tokens or secrets.
