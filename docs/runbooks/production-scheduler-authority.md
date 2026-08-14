# Production scheduler authority

GitHub Actions is the only repository-authorized production clock for Recruiter Radar source refresh, daily delivery, and government snapshot synchronization.

## Repository contract

The production clocks are:

- `.github/workflows/source-refresh-clock.yml` — hourly source-refresh clock. Persisted PostgreSQL scheduler state still decides which source is due, and the runtime PostgreSQL advisory lock remains the cross-process overlap guard.
- `.github/workflows/daily-radar-clock.yml` — once-per-day delivery clock. Partial/catastrophic outcomes use bounded retry with backoff; the application-level fenced lease and per-profile run state provide correctness.
- `.github/workflows/government-source-clocks.yml` — EIS daily; FNS, Rosstat, and Rospatent weekly according to the workflow contract.

`cron/railway.toml` is manual/deprecated compatibility tooling only and MUST NOT contain `cronSchedule`. `n8n/workflows/hh-daily.json` MUST remain `"active": false`.

Repository state cannot prove that an already-created external Railway cron service was disabled. That is an operator action after merge.

## Deployment migration after merge

1. Confirm the PR changes are present on the repository default branch (`main`).
2. In GitHub Actions, confirm **Source Refresh Clock**, **Daily Radar Clock**, and **Government Source Clocks** exist and are enabled on the default branch.
3. Run **Source Refresh Clock** with `workflow_dispatch`; require a successful run and verify the source scheduler reports either due work or an expected cadence/credential defer. Do not bypass the PostgreSQL advisory lock.
4. Run **Government Source Clocks** with `workflow_dispatch` through its controlled/no-op path. Require the configured sync to validate without inventing snapshot activation.
5. Check `GET /api/cron/daily-radar` on production and require HTTP 200 health. A manual POST must only be used with the production `CRON_API_KEY` and normal delivery safeguards.
6. In Railway, locate the legacy daily-radar cron service that previously used `0 3 * * *` and **disable or delete the scheduled service**. Do not mark this check complete from repository evidence alone.
7. In n8n, confirm **HH Daily Pipeline** remains inactive. The checked-in workflow has `active: false`; confirm the deployed n8n instance matches it.
8. Confirm there is no other external scheduler calling `/api/cron/daily-radar` or acting as a second source-refresh authority.

## Required post-merge evidence

Record the following operator result:

```text
GitHub Source Refresh Clock active: yes/no
GitHub Daily Radar Clock active: yes/no
GitHub Government Source Clocks active: yes/no
legacy Railway daily clock inactive: yes/no
n8n HH Daily inactive: yes/no
manual source-refresh dispatch: pass/fail
manual government controlled/no-op dispatch: pass/fail
daily clock health endpoint: pass/fail
```

Until that external verification is complete, production preflight must retain the boundary:

```json
{
  "repositoryReady": true,
  "deploymentReady": true,
  "runtimeVerified": true,
  "productionScheduled": false,
  "scheduleAuthority": "github-actions",
  "scheduleVerification": "external-after-merge"
}
```

Do not convert `productionScheduled` to `true` merely because workflow files exist in a feature branch or because repository tests pass.
