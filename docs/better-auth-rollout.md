# Better Auth rollout

## Decision

Recruiter Radar adopts Better Auth as a self-hosted identity and OAuth foundation, but does **not** replace the existing product authorization/session model in one release.

The initial integration is additive and fail-dark:

- Better Auth is pinned to the stable `1.6.25` line.
- HTTP base path is `/api/identity`; existing `/api/auth/*` flows remain unchanged.
- Better Auth vendor tables live in PostgreSQL schema `better_auth`.
- Existing `public.users.id BIGINT` remains the product identity used by billing, workspaces, leads, opportunities and authorization.
- `public.better_auth_identity_links` is the only one-to-one bridge between the identity provider user and the product user.
- All Better Auth runtime gates are false by default.

This makes the foundation deployable before any user-facing migration and gives rollback a bounded blast radius.

## Runtime gates

```text
BETTER_AUTH_ENABLED=false
BETTER_AUTH_MCP_OAUTH_ENABLED=false
BETTER_AUTH_MCP_DCR_ENABLED=false
```

Child gates cannot bypass their parent gate. Production must keep every gate false until the matching acceptance phase is complete.

`BETTER_AUTH_SECRET` is a dedicated secret. It must not reuse `SESSION_SECRET`, MCP secrets, provider client secrets or database credentials.

## Database boundary

Better Auth uses `search_path=better_auth,public` and a statement timeout. Vendor tables are intentionally kept out of `public` so names such as `user`, `session`, `account` and OAuth token tables cannot collide with Recruiter Radar's existing auth platform.

The bridge is one-to-one:

```text
better_auth."user".id (text)
        ↕ 1:1
public.better_auth_identity_links
        ↕ 1:1
public.users.id (bigint)
```

Deleting an identity deletes the bridge row, not the product user. Product account deletion remains an explicit Recruiter Radar lifecycle operation.

## MCP OAuth boundary

The future private operator OAuth resource is exactly:

```text
https://recruiter-radar.ru/api/internal/mcp
```

The first OAuth rollout advertises only:

```text
openid
profile
email
offline_access
rr.operator.read
```

Mutation scopes are deliberately absent from the identity foundation.

OAuth Provider DCR is a separate gate. It must stay off until the real ChatGPT MCP discovery/registration flow is tested against the deployed authorization server. The current operator MCP remains disabled until that E2E acceptance succeeds.

The JWT signer is ES256 so the existing operator verifier does not need a broader algorithm allowlist. Private JWKS material remains encrypted by Better Auth and keys are rotated with a grace period.

## Social login policy

Social providers are **not** part of the foundation rollout. They are added only after provider-token encryption at rest is implemented and tested.

Planned provider order for the Russian market:

1. Yandex ID
2. VK ID
3. Google
4. optional Microsoft/GitHub where product demand justifies them

Provider account linking must preserve one product user and must never silently merge identities on an untrusted email match.

## Rollout phases

### Phase 0 — foundation (this change)

- dependency pin and lockfile
- isolated schema and bridge
- fail-dark `/api/identity`
- OAuth authorization-server metadata alias
- read-only MCP OAuth configuration, disabled
- focused security/DB/build CI

Acceptance: deploy with all gates false and prove no existing login, checkout, billing, admin or operator behavior changes.

### Phase 1 — identity session bridge

- create/resolve Better Auth users against existing product users
- explicit account-linking rules
- Better Auth login/session UX
- no product authorization rewrite
- migration/canary metrics and rollback

Acceptance: existing and new user E2E, account recovery, session revocation, checkout return-to and workspace isolation.

### Phase 2 — social authentication

- encrypted provider tokens
- Yandex ID
- VK ID
- Google
- controlled linking/unlinking and takeover tests

Acceptance: no duplicate product users, no provider-token leakage, safe revoke/relink flows.

### Phase 3 — private MCP OAuth

- switch operator OAuth issuer from the disabled external-provider placeholder to the deployed Better Auth issuer
- enable DCR only if required by the actual ChatGPT client flow
- preserve exact resource/audience and immutable subject allowlist
- read-only OAuth E2E first

Acceptance: ChatGPT OAuth login, reconnect/refresh, `tools/list`, read tool call, wrong subject/scope/audience denial and sanitized audit trail.

### Phase 4 — optional operator mutations

Mutation scopes remain separate and are enabled only after read-only E2E is stable. Deploy/rollback remain in GitHub Actions rather than becoming generic MCP controls.

## Rollback

Before Phase 1, rollback is straightforward:

1. keep all Better Auth gates false;
2. deploy previous application release if needed;
3. run the dedicated down migration only after confirming the bridge is unused.

The down migration intentionally does not use `CASCADE`; unexpected dependencies must block rollback instead of being silently destroyed.

After identities are live, do not drop the Better Auth schema as an automated rollback. Disable new auth entry points first and use the documented identity/session migration path.
