# Commercial Signal Engine — production canary runbook

Status: **production-safe code path; production canary must be explicitly operated and reviewed**.

This document describes the operational contract for moving Recruiter Radar from the legacy vacancy-centric delivery path to the evidence-first Commercial Signal pipeline for exactly one internal workspace.

## 1. What is authoritative

The commercial pipeline is:

```text
Agency DNA
→ Query Planner v2
→ approved source execution
→ source observation
→ Evidence
→ Company Event
→ Company State Change
→ Signal Episode v2
→ Commercial Thesis
→ External Agency Propensity
→ Agency DNA Match v2
→ Opportunity Scoring v3
→ exact-lineage opportunity writer
→ Commercial Signal Card / Today
→ workflow
→ Outcome Ledger
```

A vacancy is only a source observation. It is never sufficient by itself to become a user-visible opportunity.

## 2. Runtime modes

`COMMERCIAL_SIGNAL_RUNTIME_MODE` accepts only:

- `legacy` — legacy reader/writer remain authoritative. Commercial Signal data can remain stored but is not authoritative.
- `shadow` — Commercial Signal may be computed for evaluation; it cannot replace Today.
- `canary` — exactly one configured workspace may use the full Commercial Signal writer/reader.

There is intentionally no executable global Commercial Signal mode. Wider
rollout requires a separate reviewed change after the real canary quality gate
passes.

Invalid or missing values resolve to `legacy`.

Canary scope:

```bash
COMMERCIAL_SIGNAL_RUNTIME_MODE=canary
COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS=<one-positive-workspace-id>
```

`COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS` must contain exactly one workspace id. Multiple ids fail closed to legacy.

The following upstream flags must all be exactly `true` before the canary can become authoritative:

```bash
COMPANY_EVENTS_V1_ENABLED=true
COMPANY_STATE_V1_ENABLED=true
SIGNAL_EPISODES_V2_ENABLED=true
COMMERCIAL_THESIS_V1_ENABLED=true
EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED=true
AGENCY_DNA_MATCH_V2_ENABLED=true
OPPORTUNITY_SCORING_V3_ENABLED=true
QUERY_PLANNER_V2_ENABLED=true
```

## 3. Source execution policy

Operational approval is narrower than the source enum.

Use `COMMERCIAL_SIGNAL_ALLOWED_QUERY_SOURCES` to explicitly allow source execution. The safe default is:

```bash
COMMERCIAL_SIGNAL_ALLOWED_QUERY_SOURCES=rabota-rossii
```

Current canary policy:

| Source | Default | Additional condition | Canary rationale |
| --- | --- | --- | --- |
| `rabota-rossii` | allowed | none beyond standard network policy | official open-data adapter already implemented |
| `hh` | blocked unless explicitly allowlisted | `HH_USER_AGENT` and explicit operator approval | public API path only; do not silently enable |
| `superjob` | blocked unless explicitly allowlisted | `SUPERJOB_API_APP_ID` and explicit operator approval | credentialed API path only |
| `habr-career` | blocked | none | repository live adapter is HTML scraping, not approved for this canary |

Never turn an enum/schema value into production permission automatically.

## 4. Production scheduler order

When runtime mode is not `canary`, the existing daily radar scheduler runs only the legacy path.

When runtime mode is `canary`, the scheduler runs:

1. legacy daily radar for **non-canary** workspaces;
2. Query Planner downstream-yield materialization;
3. one full Commercial Signal canary pipeline;
4. corporate-only enrichment queue.

The canary workspace is excluded from legacy digest delivery while the canary reader is authoritative. A failure in a required canary stage returns a non-zero scheduler result; the writer is not allowed to publish partially processed candidates.

## 5. Exact lineage contract

Every materialized Commercial Signal opportunity has an immutable lineage key over:

```text
workspace
client profile
organization
Signal Episode identity + generation
Opportunity Candidate identity + generation
score version
```

The writer additionally requires exact evidence that a persisted Query Planner source execution produced a signal which became a Company Event participating in the exact Signal Episode.

Forbidden lineage shortcuts:

- latest opportunity for a company;
- nearest timestamp;
- same evidence hash;
- same profile;
- freshest candidate;
- fuzzy company match.

If the exact chain cannot be proven, materialization fails closed.

The established `opportunities` workflow surface still requires `hiring_episode_id`. During canary the writer creates one deterministic compatibility `hiring_episode` from the exact Signal Episode generation. It is a workflow bridge only; it is never rediscovered by similarity.

Every new Outcome Ledger event for a Commercial Signal opportunity snapshots:

- lineage id;
- candidate id + generation;
- Signal Episode id + generation;
- exact Query Plan snapshot ids;
- immutable v3 score snapshot.

## 6. Company Events policy

Event creation is deterministic and evidence-backed. LLM text must never create Company Events.

Implemented vacancy-derived events include:

- `job_posting`;
- `vacancy_repost`;
- `vacancy_salary_change`;
- `vacancy_cluster`;
- `recruiter_vacancy`;
- `new_region`;
- `hiring_restart`.

A raw `job_posting` is the atomic source observation. It does not mean that the company is a lead.

Changed observations append immutable `company_event_publications`; exact replay remains idempotent through `publication_fingerprint`.

`new_region` is guarded against first-observation false positives: production persistence requires older evidenced hiring history before treating a recent region as expansion.

Context/business events must only be added when a permitted source supplies direct evidence. Never infer funding, leadership, contracts, product launches or new business units from LLM-generated text.

## 7. Company State / Signal Episodes

Company State is the baseline layer. Absolute hiring volume is insufficient. The runtime tracks rolling 7/14/30-day activity, distributions, vacancy lifetime, repost rate and acceleration/deceleration against company history.

Signal Episodes group a situation rather than producing one lead per vacancy. Priority episode semantics include:

- persistent hiring problem;
- recruiting capacity gap;
- leadership-led expansion;
- new unit buildout;
- regional expansion;
- reactivation window.

Business/leadership context without hiring evidence must remain contextual and cannot produce an actionable opportunity.

## 8. Actionability and enrichment

A strong quality opportunity without a safe contact path enters:

```text
qualified_needs_enrichment
```

The enrichment worker is restricted to company-owned `http(s)` surfaces rooted in the organization domain/website and uses the repository network-policy-aware crawler.

Allowed results:

- careers page;
- corporate contact page;
- HR/recruitment function surface;
- generic company email;
- generic corporate contact;
- corporate social/contact surface when explicitly supported.

Forbidden:

- personal email discovery;
- personal phone discovery;
- private profiles;
- bypassing access controls;
- personal-data enrichment from broker/scraping shortcuts.

Enrichment evidence is attached to the exact opportunity lineage and is supporting/contact evidence only. It cannot originate a hiring episode.

## 9. Query Planner downstream yield

A shared physical request can serve multiple profiles only when the request is identical. Consumers, exclusions, feedback, Agency DNA, ranking and metrics remain tenant/profile scoped.

The planner measures downstream yield instead of optimizing fetched rows:

- source executions;
- zero-result executions;
- fetched records;
- unique source signals;
- unique companies;
- Company Events;
- Signal Episodes;
- qualified opportunities;
- actionable opportunities;
- accepted;
- contacted;
- replied;
- meetings;
- won.

Budget expansion requires downstream commercial yield. High fetched volume alone can never increase a plan budget. Duplicate-heavy, zero-result or non-actionable plans are reduced.

## 10. Human annotation workflow

Operator annotation command:

```bash
node packages/db/scripts/annotate-commercial-signal-opportunity.mjs \
  --lineage-id <id> \
  --reviewer-user-id <workspace-member-user-id> \
  --label strong \
  --reason other \
  --review-set canary \
  --note "Concrete review note"
```

Labels:

```text
strong
acceptable
weak
not_a_lead
```

Structured reasons:

```text
ordinary_hiring
wrong_role
wrong_region
wrong_company_size
weak_external_need
internal_only
bad_timing
bad_economics
duplicate
stale
wrong_persona
no_safe_contact
other
```

Review sets:

```text
training
holdout
production_shadow
canary
```

Feedback is stored under the exact workspace/profile lineage. One agency's feedback must not tune another agency's ranking.

## 11. Validation status

Allowed workspace states:

```text
uncalibrated
insufficient_sample
shadow_validated
canary_validated
```

The database prevents `shadow_validated`/`canary_validated` unless the real review sample contains at least:

- 100 reviewed Commercial Signal opportunities;
- 30 `strong`/`acceptable` opportunities that were `qualified_actionable`;
- a non-empty holdout set.

`canary_validated` additionally requires at least one real downstream outcome (`accepted`, `contacted`, `replied`, `meeting`, or `won`).

Do not invent Precision/NDCG/conversion metrics if the sample is smaller. Report `insufficient_sample` instead.

## 12. TOP-20 production review

Before any rollout beyond the internal canary, manually review the top 20 ranked opportunities and record an annotation for every one.

For each opportunity verify:

1. What exact source query ran and why?
2. What source observation was found?
3. Is the entity resolution correct?
4. Which Company Event(s) were created?
5. Did the company actually change relative to its baseline?
6. Is the situation unusual for this company?
7. Is there a plausible staffing problem rather than ordinary hiring?
8. Does External Agency Propensity have current positive evidence?
9. Do negative signals contradict external-agency need?
10. Does Agency DNA materially fit role/service/geography/economics?
11. Is this one situation rather than duplicate vacancies?
12. Is the evidence current and directly openable?
13. Is the contact/action path corporate and permitted?
14. Would an agency operator reasonably act now?
15. Is the Commercial Signal Card faithful to the underlying evidence?

The TOP-20 review is not complete until every decision can be traced back through exact lineage.

## 12.1 One-workspace operated run and immutable receipt

The complete host-side mutation window must hold the same lock as production
deployments. Acquire it before changing `.env`, and keep file descriptor `9`
open through container restart, the operated run, receipt archival, and the
final dark-runtime restart:

```bash
deployment_lock=/tmp/recruiter-radar-deployment.lock
exec 9> "$deployment_lock"
if ! flock -n 9; then
  echo "Another production mutation is active; refusing the canary." >&2
  exit 1
fi
```

Do not release the lock between enable and rollback. Do not use a local SSH
timeout shorter than the runner's 15-minute request timeout plus both runtime
restarts. If the operator connection is interrupted, do not start another canary
until the original host process has exited, the deployment lock can be acquired,
the receipt is archived and the runtime is dark. A second session must never
recreate the web container while a source execution is still active.

The operator runner performs authenticated read-only preflight for all required
cron surfaces before any mutation. It then runs, in order:

```text
Query Plan downstream-yield materialization
→ one environment-scoped Commercial Signal canary
→ corporate-only enrichment
→ TOP-ranked lineage snapshot
```

It never accepts a workspace in an HTTP query. The expected workspace id is
used only to verify that the environment-managed canary returned the one
approved workspace. The command requires an explicit confirmation token and
writes a new receipt with `wx`; an existing receipt can never be overwritten.

PowerShell example:

```powershell
$env:CRON_API_KEY = '<production cron key>'
$env:DATABASE_URL = '<production read/write database URL>'
$env:COMMERCIAL_SIGNAL_CANARY_ALLOWED_HOST = '<production-host>'
npm.cmd run commercial-signal:canary:run -- `
  --base-url https://<production-host> `
  --workspace-id <approved-internal-workspace-id> `
  --run-id canary-2026-08-08-01 `
  --output C:\secure-canary-evidence\canary-2026-08-08-01.json `
  --confirm RUN_ONE_WORKSPACE_CANARY
```

Keep receipts outside the repository. They contain production lineage ids and
are operational evidence even though the receipt deliberately excludes API
keys, personal contacts, company names, evidence text, and source URLs.
The SHA-256 value detects accidental or post-run content changes; it is not an
operator signature. Store receipts in access-controlled, append-only evidence
storage and retain the printed hash independently.

An unsuccessful mutating stage produces a signed failed receipt and stops the
remaining stages. It is not a completed canary run and cannot satisfy the
quality gate. A failed read-only preflight produces no receipt because no
production mutation occurred.

After each completed run, inspect the full evidence bundle with
`review-commercial-signal-top20.mjs`, then append one `canary` annotation for
every reviewed lineage with `annotate-commercial-signal-opportunity.mjs`.

## 12.2 Executable canary quality gate

After several consecutive receipts and their manual annotations, evaluate the
gate against the production database:

```powershell
npm.cmd run commercial-signal:canary:quality -- `
  --workspace-id <approved-internal-workspace-id> `
  --receipt C:\secure-canary-evidence\canary-2026-08-08-01.json `
  --receipt C:\secure-canary-evidence\canary-2026-08-09-01.json `
  --receipt C:\secure-canary-evidence\canary-2026-08-10-01.json `
  --format markdown `
  --require-pass
```

The gate is fail-closed and requires all of the following:

- at least 3 distinct, integrity-verified completed runs;
- at least 50 distinct annotated TOP-ranked lineages;
- every TOP-5 item reviewed and Precision@5 at least `0.80` on every run;
- zero `not_a_lead` annotations among authoritative Today rows;
- 100% authoritative Today lineage, evidence-backed why-now, and Agency DNA
  lineage coverage;
- no raw-vacancy-only Today row;
- no duplicate Signal Episode situation inside one Today snapshot.

Exit code `2` with `--require-pass` means the evidence is insufficient or the
quality gate failed. It is a rollout stop, not permission to lower thresholds.
The report never tunes weights and never describes the heuristic score as a
deal probability.

Zero strong opportunities is a valid run result. The receipt remains valid,
but the wider-rollout gate stays `insufficient_sample`; discovery/supply must be
improved without weakening the quality floor.

## 13. Rollback

Fast rollback is configuration-only:

```bash
COMMERCIAL_SIGNAL_RUNTIME_MODE=legacy
```

Then redeploy/restart the web and cron services according to the normal platform procedure. The reader immediately returns to the legacy path; Commercial Signal rows are retained for audit and evaluation.

Do not delete lineage, candidates, annotations or outcomes as a rollback mechanism.

If a specific upstream layer is unsafe, setting any required Commercial Signal prerequisite flag away from exact `true` also causes the canary resolver to fail closed to legacy.

## 14. Legacy PR disposition

PR #132 must not be merged wholesale. Its still-relevant Agency DNA fixes were ported on top of current main:

- `project` remains a valid declared delivery capability;
- `volume` does not match when `currentCapacity=low`.

PR #133 must not be blindly merged. Opportunity Scoring v3 already implements the current hard-gate semantics, but legacy v2 remains a fallback while `legacy` mode exists. Any remaining legacy-v2 bug should be ported minimally against current main rather than merging the stale branch.

## 15. Production-canary completion record

Do **not** mark the production canary complete merely because CI is green.

Record these actual production counts after one operated run:

```text
raw observations
Company Events
Company State Changes
Signal Episodes
review candidates
qualified opportunities
qualified_actionable
qualified_needs_enrichment
```

Then attach the TOP-20 annotations and downstream outcome evidence.

If production credentials, scheduler access or approved source credentials are unavailable to the engineering environment, state explicitly:

> Production canary not executed from this environment. Code, CI contracts, annotation/evaluation tooling, rollback and operator runbook are prepared; validation remains `uncalibrated`/`insufficient_sample` until real production review exists.

## 16. Definition of a lead

A lead is a **current, evidence-backed staffing situation that changed relative to the company baseline, forms one coherent Signal Episode, has credible external-agency need, materially fits this agency's DNA, passes Opportunity Quality, and has enough Actionability to justify a next step now**.

## 17. What is never a lead

Never treat the following as a lead by itself:

- one vacancy;
- five duplicate copies of one vacancy;
- ordinary hiring inside the company's normal baseline;
- a large employer merely because it has many open roles;
- leadership/business context without hiring evidence;
- a strong company situation with weak Agency DNA fit;
- a strong company situation with weak External Agency Propensity;
- stale evidence;
- weak entity resolution;
- a candidate whose exact lineage cannot be reproduced;
- synthetic/demo data in production canary;
- an uncalibrated numeric probability that the company will buy agency services.
