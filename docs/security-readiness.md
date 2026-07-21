# Security readiness before deep research

**Scope:** regression review of current route and storage boundaries. This is not a penetration-test certificate.

| Boundary | Runtime control | Automated evidence |
|---|---|---|
| Tenant-scoped leads/export | Owner ID comes from authenticated session; selected profile must belong to owner's active profiles; missing session returns empty export | `pre-deep-security-regression.test.ts`, existing export tests |
| Premium digest access | Server-side `assertDigestEntitlementByClientProfileId` on generation/delivery compatibility routes | entitlement route tests + consolidated contract |
| Billing webhook replay | Secret header, deterministic provider/event idempotency key, unique ledger, leased claim token and stale reclaim | billing webhook tests + consolidated contract |
| Notification inbound replay | Unique `(provider_account_id, event_hash)` and durable inbound state | notification platform migration/tests |
| Outbound webhook SSRF | HTTPS, no embedded credentials, reserved IPv4/IPv6 rejection, DNS resolution check, manual redirects, 15s timeout, 2 KB response diagnostics | executable `validateWebhookUrl` regression matrix |
| Secret storage | Notification credentials encrypted; full provider tokens excluded from logs/errors | notification lifecycle/provider tests |
| Telemetry privacy | Typed event allowlist, recursive sensitive-key rejection in TypeScript and PostgreSQL, 4 KB bound | `telemetry.test.ts`, migration checks |
| Operator readiness endpoints | Separate `CRON_API_KEY`, constant-time comparison, no-store response | route-level handler tests |
| SQL mutation input | Parameterized writes in scoring feedback, payments and telemetry | existing DB tests + consolidated source contract |
| Production dependency risk | Crawlee fingerprint dependency chain removed; production audit runs in CI | dependency security contract + `npm audit --omit=dev --audit-level=high` |
| Deployment provenance | Deploy only successful Tests `head_sha`; immutable image; rollback image and health rollback | deploy workflow contract + CI Docker build |

## Known limitations / external blockers

- This pass does not provide an independent black-box penetration test.
- Production secrets, provider credentials, SSH permissions and infrastructure firewall state cannot be validated from repository fixtures.
- Distributed rate limiting still depends on production Redis configuration when more than one application instance is used.
- Long-term centralized audit-log retention and alert routing require an external observability backend.
- Legal/robots/provider approval remains required for restricted data sources.

## Required interpretation

A green test suite means the documented controls are implemented and their known regressions are covered. It does not prove that external infrastructure, credentials or operational procedures are configured correctly in production.
