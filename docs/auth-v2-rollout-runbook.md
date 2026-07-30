# Auth Platform v2 rollout runbook

## Scope and safety boundary

Auth v2 is additive and fail-closed. All rollout flags stay disabled by
default:

```dotenv
AUTH_PLATFORM_V2_ENABLED=false
AUTH_WORKSPACES_V2_ENABLED=false
AUTH_ONBOARDING_V2_ENABLED=false
AUTH_PASSKEYS_ENABLED=false
AUTH_LEGACY_SESSION_MIGRATION_ENABLED=false
AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED=false
AUTH_V2_CANARY_USER_IDS=
AUTH_TRUSTED_PROXY_HEADER=x-real-ip
AUTH_TRUSTED_PROXY_HOPS=
```

Never print or copy session cookies, raw tokens, magic links, challenge values,
email addresses, IP addresses, user-agent strings, credential IDs, or their
hashes into tickets, logs, or rollout evidence. The operational commands below
emit aggregate JSON only.

The production Caddy ingress is the only trusted client-address writer. Before
adding a canary user, apply the reviewed
`scripts/deploy/configure-caddy-real-ip.sh` change, verify that the application
port is not publicly reachable around Caddy, and set
`AUTH_TRUSTED_PROXY_HEADER=x-real-ip`. Leave `AUTH_TRUSTED_PROXY_HOPS` empty for
this single-value header. Caddy overwrites every client-supplied `X-Real-IP`
value with `{remote_host}`; trusting the header without that enforced ingress
boundary is prohibited.

For a different reviewed ingress, `cf-connecting-ip` is accepted as another
single-value header, or `x-forwarded-for` may be used only with an explicit
`AUTH_TRUSTED_PROXY_HOPS` value from `1` through `10`. Do not copy a hop count
between environments. Preflight blocks malformed configuration and blocks any
canary or enabled Auth v2 capability when no trusted client-address source is
configured.

The canary must be an existing internal test account. Operators **do not create**
a production user with direct SQL, migrations, fixtures, or the canary command.
Create and verify the internal account through the supported product flow before
the rollout window.

## Owners

- Auth runtime owner: flags, canary window, security alerts, and rollback.
- Database owner: migrations, preflight, dry-run/backfill, and parity checks.
- Product owner: internal test account and acceptance evidence.
- Email deliverability owner: sender-domain authentication, suppression and
  bounce monitoring, provider health, and magic-link delivery SLOs.
- Incident commander: go/no-go and the final rollback decision.

The deliverability owner must confirm SPF/DKIM/DMARC alignment, provider
suppression visibility, bounce/complaint thresholds, and a monitored support
path before any canary login.

## Preflight and migration verification

Run against the explicitly selected environment. Save only the aggregate JSON
output:

```powershell
npm.cmd run db:migrate
npm.cmd run auth-v2:verify-db
npm.cmd run auth-v2:preflight
npm.cmd run auth-v2:backfill
```

`auth-v2:backfill` is dry-run by default. It reports candidates and changes
nothing. Resolve every blocking violation before applying:

```powershell
npm.cmd run auth-v2:backfill -- --apply --batch-size=100 --max-batches=10
npm.cmd run auth-v2:verify-backfill
npm.cmd run auth-v2:preflight
npm.cmd run auth-v2:session-report
```

Do not proceed if any verifier exits non-zero, row-count parity fails, tenant
relationships conflict, active workspaces lack membership, or aggregate session
alerts are unexplained. The preflight JSON must also report
`trustedClientAddressNotReady: 0`,
`trustedProxyConfigurationValid: true`, and `trustedProxyConfigured: true`
before canary.

## Single-user canary

Keep the global platform flag explicitly false. Set exactly one existing
internal test user in `AUTH_V2_CANARY_USER_IDS`, and enable the subordinate
capabilities:

```dotenv
AUTH_PLATFORM_V2_ENABLED=false
AUTH_WORKSPACES_V2_ENABLED=true
AUTH_ONBOARDING_V2_ENABLED=true
AUTH_PASSKEYS_ENABLED=true
AUTH_V2_CANARY_USER_IDS=<internal-test-user-id>
```

Verify that the CLI argument and allowlist identify the same single account:

```powershell
npm.cmd run auth-v2:canary -- --user-id=<internal-test-user-id>
```

Then exercise signup/login, magic-link delivery, safe `returnTo`, session
rotation, workspace switching, role denial, team invitation, profile, checkout,
billing, leads, review, opportunities/outcomes, notification settings, exports,
passkey registration/login/fallback/removal, logout, and account-security
surfaces. Confirm another account remains on legacy behavior.

Canary promotion requires:

1. all operational JSON reports `ok: true`;
2. no raw auth or contact data in logs;
3. delivery and bounce/complaint health within the agreed thresholds;
4. no cross-workspace access or privilege escalation;
5. no regression in payment, delivery, opportunity/outcome, admin, export, or
   public routes;
6. an explicit incident-commander go decision.

## Staged rollout

Expand `AUTH_V2_CANARY_USER_IDS` only through a reviewed configuration change.
Re-run preflight, canary checks for each explicitly approved internal account,
session report, security smoke, and browser acceptance after every expansion.
Do not enable `AUTH_PLATFORM_V2_ENABLED=true` until the canary population and
deliverability gates are complete.

When the global flag is eventually approved, enable capabilities in this order:

1. session read and workspace authorization;
2. onboarding;
3. passkeys;
4. legacy-session migration for a time-bounded, explicitly dated window.

Do not remove the legacy path or rollback compatibility in the same release as
global enablement.

## rollback

Stop expansion immediately on authorization denial anomalies, cross-tenant
evidence, login or delivery error spikes, unexplained session rotation backlog,
or payment/profile regressions.

Rollback order:

1. set `AUTH_LEGACY_SESSION_MIGRATION_ENABLED=false`;
2. set `AUTH_PASSKEYS_ENABLED=false`;
3. set `AUTH_ONBOARDING_V2_ENABLED=false`;
4. set `AUTH_WORKSPACES_V2_ENABLED=false`;
5. set `AUTH_PLATFORM_V2_ENABLED=false`;
6. set `AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED=true` only for the bounded
   compatibility window needed to read already-issued v2 sessions;
7. clear `AUTH_V2_CANARY_USER_IDS`;
8. re-run `auth-v2:preflight` and `auth-v2:session-report`;
9. verify legacy login, checkout/payment, profile, delivery, opportunities,
   outcomes, admin, exports, public routes, and safe `returnTo`;
10. record the incident and assign session cleanup and deliverability follow-up.

Database migrations are additive and are not rolled back during the first
response. Do not run down migrations or delete auth/workspace data as an
incident shortcut. Revoke compromised sessions through the supported account
security controls and preserve the append-only security ledger.
