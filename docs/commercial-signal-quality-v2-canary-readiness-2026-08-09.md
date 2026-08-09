# Commercial Signal Quality Engine v2 canary readiness

Date: 2026-08-09

## Decision

`NOT READY FOR PRODUCTION CANARY`.

The code is dark by default and no production flags were changed. No canary was
run because explicit operator approval was absent and the current production
quality gate had no valid successful receipt.

## Observed production state

The audited production runtime was healthy at the container level, but the two
available Commercial Signal receipts were unsuccessful:

- `commercial-signal-production-20260808T142639Z.json`: failed at
  `commercial_signal_canary` with `http_500`, zero plans scanned;
- `commercial-signal-production-20260808T151507Z.json`: failed at the same
  stage/code after 44 plans and 44 metric snapshots.

Neither receipt completed, neither contained a reviewed TOP sample, and neither
is a valid Quality Engine v2 receipt. Relevant runtime flags and the canary
workspace were unset, so production remained fail-closed. This evidence is a
readiness blocker, not permission to weaken P@5 or other quality thresholds.

## Implemented readiness controls

- exact-`true`, dark-by-default `COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED`;
- append-only tenant/candidate/evidence lineage;
- heuristic and uncalibrated model labels;
- deterministic evidence independence and future-evidence exclusion;
- DNC/conflict and confirmed-negative blocking;
- no UI reader, cron route, automatic outreach, automatic weight update, or ML
  production rollout;
- synthetic-only v3 comparison explicitly labeled `contract_only`;
- PostgreSQL contracts wired into CI.

## Missing production signals and data

The following are genuinely missing or not yet proven at production scale:

- normalized meaningful repost cycles distinct from routine HH lifecycle
  republication;
- salary and job-description change history;
- close/reopen cycles and role-level time-to-fill history;
- evidenced internal recruiting capacity and hiring velocity/capacity ratio;
- reviewed company agency-use history and previous agency relationship;
- explicit procurement constraints and confirmed no-agency policy evidence;
- approved, reproducible role/region market-difficulty observations;
- a production producer that assembles all Quality v2 component inputs before
  calling the append-only repository;
- a tenant-approved Quality v2 shadow sample with TOP and missed-opportunity
  manual annotations;
- sufficient mature reply/meeting/proposal/won/lost outcomes;
- an untouched temporal holdout and diversity review;
- a valid successful Commercial Signal base canary receipt.

## Required rollout sequence

1. Keep the flag dark and merge only after CI/PostgreSQL contracts pass.
2. Add the reviewed component-input producer and run shadow only for one
   explicitly approved internal workspace.
3. Review TOP and the four missed-opportunity sample types manually.
4. Produce a signed quality report without lowering the existing P@5 gate.
5. Only then request separate authorization for an internal workspace canary.

Stop immediately on tenant-lineage mismatch, future leakage, invalid receipt,
zero coverage in a critical dimension, unreviewed negative evidence, missing
credentials, unsafe runtime state, or absent operator approval. A zero-lead run
is a supply finding and does not authorize threshold reduction.

## Local verification limitation

The TypeScript, unit, static migration, evaluator, and JavaScript syntax gates
run locally. PostgreSQL runtime verification could not be executed because no
isolated `DATABASE_URL` was available and Docker Desktop's engine was not
running. Production data was not used as a substitute.
