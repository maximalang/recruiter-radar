# Opportunity Analytics v2 Phase 9 evidence — 2026-08-02

```yaml
status: local_verified
production_deploy: not_run
production_flag_activation: not_authorized
tenant_canary: not_run
feature_default: OPPORTUNITY_ANALYTICS_V2_ENABLED=false
```

## Scope

Privacy-safe local verification of the Phase 9 schema, tenant-scoped analytics,
calibration export and query-plan guard. This record is not production or
canary acceptance.

## PostgreSQL evidence

Disposable PostgreSQL ran all migrations, runtime suites and downgrade
verifiers. The Phase 9 runtime case proved:

- exact workspace isolation returns an empty foreign-workspace cohort;
- reverted terminal events are excluded and the effective replacement remains;
- immature and mature cohort states are distinct;
- confirmed RUB value is derived only from the effective won event and remains
  a decimal string;
- event-time assignee attribution is captured without historical backfill;
- calibration output uses a public reference and exposes no assigned identity;
- down migration refuses to erase captured assignment attribution.

Full command to repeat:

```powershell
$env:DATABASE_URL='<isolated PostgreSQL admin URL>'
npm.cmd run test:opportunity-engine:db
npm.cmd run test:opportunity-engine:down
```

## Query-plan evidence

Command:

```powershell
npm.cmd run opportunity-outcomes:benchmark
```

Final local disposable-PostgreSQL result:

```text
fixture: 10 owners, 10 workspaces, 100 profiles, 10,000 opportunities,
         100,000 outcome events, 1,000 corrections
legacy funnel: 10.219 ms execution, 0.772 ms planning
Analytics v2: 36.997 ms execution, 0.506 ms planning
index: benchmark_outcome_owner_opportunity_time_idx
regression guard: 1,000 ms
```

The controlled plan stayed below the guard and used an owner-scoped event
index, so no additional production schema index was justified. These numbers
are local evidence and do not promise production latency.

## Rollout boundary

The global feature flag remains off. No production environment, tenant data,
canary traffic or deploy was accessed. A future rollout must follow
`docs/runbooks/opportunity-analytics-v2-rollout.md` and stop when no suitable
real internal workspace already has the required outcome history.
