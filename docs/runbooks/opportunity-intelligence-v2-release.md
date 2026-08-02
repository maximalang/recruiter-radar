# Opportunity Intelligence v2 release and rollback runbook

Status: production-ready procedure; no production activation is implied.

This runbook is the release-level order for Phases 0–10. Detailed Outcome
Ledger, CRM bridge and Analytics v2 checks remain authoritative in:

- `docs/opportunity-canary-runbook.md`;
- `docs/runbooks/opportunity-crm-bridge-rollout.md`;
- `docs/runbooks/opportunity-analytics-v2-rollout.md`.

## 1. Prerequisites

1. Record the exact deployed SHA and require it to contain all Opportunity v2
   migrations through `20260801151000`.
2. Confirm the release CI, production build, full Jest, DB validation, isolated
   PostgreSQL runtime suite, migration upgrade/down verification, dependency
   audit and browser/accessibility audit are green for that SHA.
3. Select exactly one internal workspace with an active Auth v2 owner/member,
   a real client profile and at least one real opportunity. Do not manufacture
   production data merely to satisfy a canary.
4. Record baseline error rate, database load and Opportunity request latency.
5. Keep every Opportunity global flag `false` before deployment. Never place
   both owner and workspace base-canary allowlists in the environment.

## 2. Flag dependency graph

```text
OPPORTUNITY_ENGINE_V1_ENABLED or one exact base canary
  -> OPPORTUNITY_OUTCOMES_ENABLED or the same base canary
    -> OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED or the same workspace canary
      -> OPPORTUNITY_OUTCOMES_UI_ENABLED
      -> AGENCY_DNA_V1_ENABLED or exact Agency DNA workspace canary
        -> OPPORTUNITY_SCORING_V2 shadow or active workspace canary/global flag
        -> OPPORTUNITY_STRATEGIST_V1 workspace canary/global flag
      -> OPPORTUNITY_WORKFLOW_V1 workspace canary/global flag
      -> OPPORTUNITY_CRM_BRIDGE_ENABLED
      -> OPPORTUNITY_ANALYTICS_V2_ENABLED
```

All parsers accept only the exact string `true`. Canary variables accept one
positive decimal ID only. Malformed, multiple or ambiguous base canaries fail
closed. The legacy global-secret outcome ingest remains disabled regardless of
its old environment variable.

## 3. Deploy with flags off

1. Take the normal database backup required by the deploy workflow.
2. Apply additive migrations in order and run migration validation.
3. Deploy the application artifact with all Opportunity flags and allowlists
   off/empty.
4. Confirm health/readiness and unrelated lead-generation paths remain healthy.
5. Confirm Opportunity APIs and UI remain undiscoverable outside an approved
   canary. Deployment success alone is not acceptance.

## 4. Preflight and smoke tests

1. Run `opportunity-outcomes:preflight` read-only; every violation and drift
   counter must be zero.
2. Run the Outcome rebuild in `--dry-run` for the exact owner and workspace;
   require `rebuildFailed=0`. Do not run `--apply` unless drift is understood
   and separately approved.
3. Verify the selected workspace, active membership, role permissions and
   opportunity count. Stop when there is no real opportunity.
4. Smoke list/detail, Today, search, outcome history and operational summary
   with flags still off where applicable; no cross-workspace data may appear.

## 5. Tiny canary

1. Set only `OPPORTUNITY_CANARY_WORKSPACE_IDS` to the selected workspace. Keep
   global engine/outcome/workspace flags false.
2. Enable dependent phase-specific workspace canaries one at a time: Agency
   DNA, Scoring shadow, Strategist and Workflow. Do not activate Scoring v2
   before its shadow evaluation passes.
3. Exercise the documented funnel, exact idempotent replay, altered replay
   rejection, correction/revert, snooze/resume and meeting lifecycle.
4. Verify foreign-workspace read/write attempts return no resource and create
   no state change. Remove a test membership and confirm future access stops
   while historical actor snapshots remain readable.
5. Run the canary rebuild dry-run again and require `rebuildChanged=0`.
6. Enable CRM or Analytics only after their linked runbook gates pass. Their
   global feature switch is still tenant-limited by the base workspace canary
   while global prerequisites remain false.

## 6. Acceptance metrics

Acceptance requires all of the following for the observation window:

- zero tenant-isolation, authorization, projection, append-only, privacy or
  idempotency violations;
- `rawContactRows=0`, no secrets/contact values in logs or evidence;
- no unexpected 5xx response from Opportunity routes;
- unchanged-payload replay succeeds and changed-payload replay returns `409`;
- rebuild dry-run reports zero drift and zero failures;
- Analytics summary/export stay below the documented 1000 ms controlled
  benchmark guard and export refuses rather than truncates over 5000 rows;
- CRM signature, revocation, replay, rate and SSRF controls pass;
- database load, error rate and latency do not rise materially from baseline;
- Today/Research Mode, responsive layouts and keyboard/screen-reader paths pass
  the browser checklist.

Any failed item is a stop condition, not a waiver.

## 7. Expansion stages

1. Hold the single-workspace canary for the approved observation period.
2. Because allowlists intentionally accept one ID, move to another workspace by
   replacing the exact ID; do not create a comma-separated cohort.
3. Activate global prerequisites only through a separate production approval:
   engine, outcomes, workspace context, then UI and downstream phases in the
   dependency order above.
4. Re-run preflight, smoke, metrics and privacy checks after every stage.

## 8. Kill switch

On any stop condition, first clear the most downstream phase flag/canary. If
the fault is not isolated, clear all phase-specific canaries and then the base
workspace canary. Confirm APIs return `404`, jobs stop accepting work and no
new ledger/workflow/CRM events are written. Flags are the primary kill switch;
do not delete audit or ledger data.

## 9. Rollback

1. Disable flags/canaries in reverse dependency order.
2. Roll back the application artifact through the approved deploy workflow.
3. Leave additive schema, immutable ledger, receipts and audit rows in place;
   application rollback is designed to tolerate them.
4. Use down migrations only in an explicit maintenance window after backup and
   only when no rows depend on the phase being removed. Never down-migrate to
   erase evidence or force a rollback.
5. If projection drift exists, preserve evidence, diagnose the writer first,
   then use the documented workspace-scoped rebuild with separate approval.

## 10. Post-rollout verification

Record deployed SHA, migration set, exact non-secret flag state, workspace ID,
preflight/rebuild counters, browser result, acceptance window and rollback
readiness. Re-run tenant probes, privacy scan, idempotency probe, analytics/CRM
checks and core lead-pipeline smoke tests. Production logs and evidence must not
contain company names, personal contacts, credentials, cookies or signatures.
