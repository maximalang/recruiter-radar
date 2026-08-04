# Commercial Signal Engine mandatory contract matrix v1

Phase 10 turns the 20 mandatory product invariants into one executable,
versioned gate. It adds no runtime behavior, schema, reader, writer, flag, job,
or production data access.

The source of truth is
`apps/web/fixtures/commercial-signal-engine-contracts.v1.json`. Every contract
has:

- a stable ordered ID from `CSE-01` through `CSE-20`;
- one product requirement;
- the pipeline layer responsible for it;
- at least one exact executable test file and test title;
- for PostgreSQL evidence, the package gate that CI must run.

The verifier rejects missing/reordered IDs, duplicate requirements, unsupported
layers, unsafe paths, missing test titles or fixtures, absent package scripts,
and PostgreSQL gates not enforced by `.github/workflows/test.yml`. It emits a
SHA-256 matrix hash so the exact evidence map can be recorded with a run.

## Contract coverage

| ID | Invariant | Primary evidence layer |
| --- | --- | --- |
| CSE-01 | Ordinary vacancy is not actionable | Signal Episode + Scoring v3 |
| CSE-02 | Cross-source vacancy duplicate counts once | Company Event + legacy canonicalization |
| CSE-03 | Four baseline vacancies are ordinary | Company State |
| CSE-04 | Four vacancies above a low baseline can form an episode | Company State + Signal Episode |
| CSE-05 | CTO change without hiring evidence stays context | Signal Episode |
| CSE-06 | CTO change plus acceleration forms one combined episode | Signal Episode |
| CSE-07 | No Agency DNA Match means no candidate | Scoring v3 dark job |
| CSE-08 | Strong quality without contact queues enrichment | Scoring v3 + PostgreSQL |
| CSE-09 | Low external propensity cannot qualify | Scoring v3 |
| CSE-10 | Existing client maps to Grow | Scoring v3 mode identity |
| CSE-11 | Former client maps to Reactivate | Scoring v3 mode identity |
| CSE-12 | Do-not-contact blocks all commercial action | Scoring v3 hard gate |
| CSE-13 | Negative evidence can demote a high score | Scoring v3 replay |
| CSE-14 | Changed input creates an immutable scoring generation | Candidate repository + PostgreSQL |
| CSE-15 | Repeated ingestion is idempotent | Company Events PostgreSQL |
| CSE-16 | Feedback cannot cross workspace | Query Planner unit + PostgreSQL |
| CSE-17 | Query exclusions remain profile/tenant scoped | Query Planner unit + PostgreSQL |
| CSE-18 | Stale episodes expire and leave qualified output | Signal Episode + Scoring v3 |
| CSE-19 | Untrusted LLM text cannot alter score/status | Commercial Thesis boundary + Scoring v3 |
| CSE-20 | Evidence-based reasons contain real evidence IDs | Commercial Thesis + Scoring v3 |

## Standalone gate

```powershell
npm.cmd run test:commercial-signal:contracts
```

The command first validates the matrix, then runs the nine unique Jest files
that provide its unit evidence. PostgreSQL evidence is not silently mocked or
duplicated; the matrix names three existing isolated gates, and the verifier
requires all of them in CI:

```powershell
npm.cmd run test:company-events-v1:db
npm.cmd run test:opportunity-scoring-v3:db
npm.cmd run test:query-planner-v2:db
```

Those gates create disposable databases and exercise actual constraints,
tenant lineage, replay, and append-only behavior. Full CI continues to run the
rest of the phase-specific PostgreSQL gates as well.

## New explicit regression cases

The matrix audit found and added four previously implicit boundaries:

- an empty latest Agency DNA Match set builds no Opportunity Candidate;
- negative feedback in one workspace does not alter another workspace plan;
- extra untrusted LLM/generated fields are ignored by deterministic Scoring v3;
- every Scoring v3 reason whose basis is evidence uses non-empty IDs from the
  exact input evidence set.

## Delivery boundary

Phase 10 does not merge or activate Phases 1–9. Green contracts demonstrate
code-level invariants only. They do not prove real-data precision, calibration,
production health, canary acceptance, or authorization to switch readers,
deploy, enable flags, execute shadow jobs, or access production data.
