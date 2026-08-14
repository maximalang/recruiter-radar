# Source API and runtime configuration requirements

This runbook describes current configuration boundaries. Source status, access class,
credential names, and user actions are generated in
[`docs/source-status.generated.md`](../docs/source-status.generated.md) from the three
machine-readable contracts. Do not copy source counts or live status into this file.

## Canonical contracts

- `packages/db/source-policy.json` controls priority, confidence, lead eligibility, and promotion.
- `packages/db/source-readiness.json` records implementation, configuration mode, live evidence, and blockers.
- `packages/db/source-credentials.json` records access class, registration, credential names, and runtime availability. It never stores credential values.
- `npm run verify:sources:readiness`, `npm run verify:source:credentials`, and `npm run verify:docs:source-status` fail when these contracts drift.

## Automatic runtime paths

- The daily radar ingests primary hiring sources, derives bounded company-owned context targets from tracked organizations, records source health, derives temporal intelligence, and only then builds digests.
- Company sites and newsrooms use DB-derived targets. Input files are controlled-run overrides, not the default production discovery path.
- Official FNS, EIS procurement, Rosstat, and Rospatent snapshot synchronizers discover, checksum, and atomically activate approved public datasets. Snapshot files remain reproducibility/debug inputs, not a manual production workflow.
- Public ATS discovery stores the concrete provider source ID. Russian ATS coverage currently has live proof for Huntflow, FriendWork, and e-staff; policy-blocked surfaces are not bypassed.
- GitHub organization context is public and credential-free at base rate limits. A token is optional capacity only.
- YouTube and Telegram company-channel sources are optional Class B context sources and never independently originate leads.
- GDELT uses bounded tracked-company queries plus persistent cache/cooldown. HTTP 429 is a visible rate-limited result, not successful live verification.

## Registration and credentials

Use the generated credential/action matrix for the current source-by-source state.
Important operator boundaries:

- HH: wait for the already submitted application review. Do not submit another registration. After approval, configure `HH_CLIENT_ID` and `HH_CLIENT_SECRET`; `HH_USER_AGENT` remains required for API requests.
- SuperJob: registration and runtime key are already configured; no user action is required.
- YouTube: if this optional coverage is desired, create a free Google Cloud project, enable YouTube Data API v3, and configure `YOUTUBE_API_KEY`.
- Telegram: if this optional coverage is desired, register one Telegram application and provision an authorized least-privilege MTProto session. Bot API collection is not supported.
- Class C sources require explicit permission, an official subscription, or a compliant provider decision. Missing Class C access does not authorize scraping or access-control bypasses.

Never place credential values in docs, logs, fixtures, generated status, or git.

## Required checks

```text
npm run verify:sources:readiness
npm run verify:source:credentials
npm run verify:sources:live-config
npm run verify:docs:source-status
npm run verify:source:temporal-health
npm run db:validate
npm run web:check
npm run web:build
```

Live DB verifiers must use an isolated disposable database and their explicit isolated-test acknowledgement. A fixture, HTTP response, or runnable adapter is not production live proof.
