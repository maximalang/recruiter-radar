# Daily yield measurement v1

Status: `BLOCKED_NO_READ_ONLY_DATABASE` as of 2026-08-26. The repository has the measurement contract and fixture evidence, but this worktree was not given `DATABASE_URL`; no production numbers are claimed.

## Scope

The script measures the canonical legacy daily digest output from `digest_candidates` for two or three named client profiles. It is read-only and does not create, update, or delete database rows.

```bash
npm run quality:measure-daily-yield -- \
  --profile-id <engineering-moscow-profile-id> \
  --profile-id <backend-spb-profile-id> \
  --profile-id <data-moscow-profile-id> \
  --from 2026-08-19T00:00:00.000Z \
  --to 2026-08-26T00:00:00.000Z
```

The command requires `DATABASE_URL` to be supplied by the approved runtime/secret store. It never reads `.env*` and never prints the connection string.

## Metric contract

- **Unique companies/day after dedupe:** one row per `(client_profile_id, Europe/Moscow calendar day, org_id)`, retaining the highest `total_score`, then newest `created_at`, then highest candidate id.
- **A/B-gate share:** deduped rows whose persisted `payload.confidence_gate` or `payload.confidenceGate` is `A` or `B`, divided by deduped rows. Missing/unknown gates remain visible in `unknownGateCount` and are not silently counted as A/B.
- **Lawful-contact-path share:** deduped rows with a persisted non-empty `payload.contact_paths`, a supported reachability reason (`reachability.career-page`, `reachability.corporate-contact`, or `reachability.direct-surface`), or a registry-only source family (`egrul-fns`, `fedresurs`). This mirrors the existing `deriveLawfulContactPath` policy without exporting contact values.
- **No-data behavior:** no matching rows is an explicit unavailable result; it is not reported as zero quality.

The output includes profile metadata, daily counts, aggregate counts, query window, timezone, dedupe rule, and `productionWrites: false`. Company names are not printed by the measurement report.

## Evidence available now

- `packages/db/scripts/measure-daily-yield.test.mjs`: 3/3 deterministic tests passed for dedupe, lawful-path derivation, and profile/day isolation.
- `npm run test:commercial-signal:evaluation`: exit 0; 15 contract checks passed. This is synthetic/contract evidence, not production quality evidence.
- `npm run verify:sources:readiness`: exit 0.
- `npm run verify:sources:coverage`: exit 0.
- Production measurement remains blocked until an approved read-only `DATABASE_URL` is provided to the process.
