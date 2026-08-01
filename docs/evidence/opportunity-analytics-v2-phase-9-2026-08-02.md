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

Disposable PostgreSQL ran all 78 migrations, runtime suites and 20 downgrade
verifiers. The Phase 9 runtime case proved:

- exact workspace isolation returns an empty foreign-workspace cohort;
- reverted terminal events are excluded and the effective replacement remains;
- immature and mature cohort states are distinct;
- confirmed RUB value is derived only from the effective won event and remains
  a decimal string;
- event-time assignee attribution is captured without historical backfill;
- a cross-workspace assignee is rejected by PostgreSQL;
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
fixture: 10 owners, 10 workspaces, 1,000 profiles,
         20,000 opportunities, 200,000 outcome events
target workspace: 100,000 outcome events, 1,000 corrections
legacy funnel: 93.423 ms execution, 0.880 ms planning
Analytics v2 summary: 416.023 ms execution, 1.259 ms planning
calibration export: 386.349 ms execution, 0.818 ms planning
indexes: owner/type/time, owner/opportunity/time and owner/reverts
regression guard: 1,000 ms
```

Both controlled plans stayed below the guard and used the modeled production
owner-scoped event/correction indexes, so no additional production schema index
was justified. These numbers are local evidence and do not promise production
latency.

## Rollout boundary

The global feature flag remains off. No production environment, tenant data,
canary traffic or deploy was accessed. A future rollout must follow
`docs/runbooks/opportunity-analytics-v2-rollout.md` and stop when no suitable
real internal workspace already has the required outcome history.
