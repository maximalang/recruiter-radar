# Query Planner v2

Phase 8 introduces the replacement for the cross-client query-union contract:
an additive, profile-scoped planning boundary. It is dark by default and does not switch the
existing daily ingestion path, ranking readers, Opportunity readers, Today, or
delivery.

## Invariants

- Every plan belongs to exactly one `(workspace_id, owner_id,
  client_profile_id)` tuple.
- Exclusions, feedback adjustments, ranking inputs, and historical yield stay
  on that profile's plan. They are never unioned with another client's values.
- A shared source request contains only identical source parameters. Its
  consumer table points back to the immutable profile plans that may consume
  the fetched records.
- `review` and `blocked` plans are persisted for audit but cannot become shared
  request consumers.
- Unknown geography fails closed. No HH area or Rabota Rossii region code is
  invented.
- Historical yield uses `null` when attribution is unavailable. Missing data is
  not rewritten as zero.
- More discovery recall comes from role, region, source, synonym, and bounded
  page-budget expansion. Existing evidence and quality thresholds are not
  weakened.

## Plan contract

`query_plan_snapshots` stores an immutable generation with:

- source;
- role family and synonyms;
- specialization;
- canonical region and source geography snapshot;
- seniority;
- keyword cluster;
- page budget and frequency;
- one profile consumer;
- per-profile exclusions and feedback;
- historical yield;
- source query environment;
- profile, feedback, request, identity, and canonical input hashes.

An exact replay returns the existing generation. A changed input for the same
plan identity appends the next generation. The database validates the current
Agency DNA profile snapshot before insert and rejects cross-tenant provenance.

## Shared execution boundary

`groupSharedQueryPlans` groups only `ready` plans with the same source and exact
`shared_request_hash`. `executeSharedQueryPlans` calls an injected source
executor once per group and returns all plan identities and profile consumers.
No profile exclusion or feedback value is added to another profile while
forming a group.

The Phase 8 cron job writes the immutable plan/request/consumer manifest. It
does not call external source adapters and does not replace the legacy ingest
reader. Connecting the executor to scheduled source fetching is a separate
rollout decision after dry-run and tenant-isolation evidence.

## Geography

The resolver records:

`canonical region → HH area → Rabota Rossii region code → aliases → remote relation`.

The initial mapping covers Moscow, Saint Petersburg, Moscow Oblast,
Sverdlovsk Oblast, Novosibirsk Oblast, Tatarstan, Krasnodar Krai,
Bashkortostan, Chelyabinsk Oblast, Samara Oblast, Nizhny Novgorod Oblast, and
Rostov Oblast. HH area identifiers follow the official `/areas` directory and
vacancy-search `area` contract: <https://api.hh.ru/openapi/redoc>. Rabota
Rossii codes follow its official regional vacancy API:
<https://trudvsem.ru/opendata/api>.

The mapping is versioned as `rf-source-geography-v2-2026-08-04`. A mapping
change creates a new plan input rather than silently rewriting history.

## Metrics

`query_plan_metric_snapshots` stores one immutable measurement window per plan:

- fetched records;
- unique events;
- unique companies;
- signal episodes;
- qualified opportunities;
- accepted, contacted, replied, and meeting outcomes;
- duplicate, zero-result, qualification, acceptance, contact, reply, and
  meeting rates.

Metrics are profile-scoped. One agency's feedback or downstream conversion
cannot change another agency's plan or reported yield.

## Dark job

The flag accepts only the exact string `true`:

```text
QUERY_PLANNER_V2_ENABLED=false
```

The cron endpoint is protected by `CRON_API_KEY`:

```text
GET  /api/cron/opportunities/build-query-plans-v2
POST /api/cron/opportunities/build-query-plans-v2?workspace=<id>&profile=<id>
POST /api/cron/opportunities/build-query-plans-v2?workspace=<id>&profile=<id>&apply=true
```

POST is dry-run unless `apply=true`. Apply requires both exact identifiers.
`batchSize` is bounded to 100 profiles, and unresolved geography remains out of
the execution manifest.

## Verification and rollback

```text
npm.cmd run web:check
npm.cmd run db:validate
npm.cmd run test:query-planner-v2:db
```

The isolated PostgreSQL gate applies all migrations, exercises the pure
planner, repository, dark job, tenant rejection, append-only triggers, metric
replay, and then runs the Phase 8 down migration. The down migration refuses to
drop non-empty planner tables and preserves the Phase 7 Opportunity Candidate
parent schema.

No merge, deploy, flag activation, source-executor connection, or production
backfill is authorized by this phase.
