# Better Auth rollout

## Decision

Recruiter Radar adopts Better Auth as a self-hosted **website identity foundation**. It does **not** replace the existing product authorization/session model in one release, and the stable Better Auth OAuth Provider is **not** part of this foundation.

The initial integration is additive and fail-dark:

- Better Auth is pinned to stable `1.6.25`.
- HTTP base path is `/api/identity`; existing `/api/auth/*` flows remain unchanged.
- Better Auth vendor tables live in PostgreSQL schema `better_auth`.
- Existing `public.users.id BIGINT` remains the product identity used by billing, workspaces, leads, opportunities and authorization.
- `public.better_auth_identity_links` is the only one-to-one bridge between Better Auth identity and the product user.
- Better Auth is disabled by default.
- `@better-auth/oauth-provider` is deliberately absent from the dependency graph.

This makes the foundation deployable before any user-facing migration and gives rollback a bounded blast radius.

## Runtime gate

```text
BETTER_AUTH_ENABLED=false
```

Production keeps this false until the website identity bridge acceptance phase is complete.

`BETTER_AUTH_SECRET` is a dedicated secret. It must not reuse `SESSION_SECRET`, MCP secrets, provider client secrets or database credentials.

## Database boundary

Better Auth uses `search_path=better_auth,public` and a statement timeout. Vendor tables are intentionally kept out of `public` so names such as `user`, `session` and `account` cannot collide with Recruiter Radar's existing auth platform.

The bridge is one-to-one:

```text
better_auth."user".id (text)
        ↕ 1:1
public.better_auth_identity_links
        ↕ 1:1
public.users.id (bigint)
```

Deleting an identity deletes the bridge row, not the product user. Product account deletion remains an explicit Recruiter Radar lifecycle operation.

## Operator MCP OAuth boundary

The private operator MCP remains a separate authorization boundary and stays fail-dark.

The stable `@better-auth/oauth-provider` 1.6.x line is affected by `GHSA-p2fr-6hmx-4528`: RFC 8707 resource indicators are not bound to the original authorization grant. The upstream advisory states that the 1.6.x stable line is not patched; the fix starts in the 1.7 prerelease line.

Therefore this rollout does **not**:

- install `@better-auth/oauth-provider`;
- expose a Better Auth authorization-server metadata route;
- expose Better Auth DCR;
- issue Better Auth access/refresh tokens for the operator MCP;
- change the existing operator MCP issuer/provider configuration.

A future MCP OAuth change requires a patched **stable** release (or a separately reviewed authorization server) plus real ChatGPT OAuth acceptance. A single-audience workaround is not treated as sufficient production justification for the operator control plane.

## Social login policy

Social providers are **not** part of the foundation rollout. They are added only after provider-token encryption at rest is implemented and tested.

Planned provider order for the Russian market:

1. Yandex ID
2. VK ID
3. Google
4. optional Microsoft/GitHub where product demand justifies them

Provider account linking must preserve one product user and must never silently merge identities on an untrusted email match.

## Rollout phases

### Phase 0 — website identity foundation (this change)

- stable Better Auth dependency pin and lockfile;
- isolated schema and one-to-one bridge;
- fail-dark `/api/identity`;
- focused security/DB/build CI;
- no OAuth Provider dependency or MCP route.

Acceptance: deploy with `BETTER_AUTH_ENABLED=false` and prove no existing login, checkout, billing, admin or operator behavior changes.

### Phase 1 — identity session bridge

- create/resolve Better Auth users against existing product users;
- explicit account-linking rules;
- Better Auth login/session UX;
- no product authorization rewrite;
- migration/canary metrics and rollback.

Acceptance: existing and new user E2E, account recovery, session revocation, checkout return-to and workspace isolation.

### Phase 2 — social authentication

- encrypted provider tokens;
- Yandex ID;
- VK ID;
- Google;
- controlled linking/unlinking and takeover tests.

Acceptance: no duplicate product users, no provider-token leakage, safe revoke/relink flows.

### Phase 3 — private MCP OAuth, separately gated

Re-evaluate the current stable OAuth/MCP ecosystem at implementation time. Use Better Auth only if the selected stable version contains the protected-resource fix and passes ChatGPT MCP discovery, PKCE, refresh/reconnect, exact audience, scope and immutable-subject tests. Otherwise keep/use another production-grade OAuth authorization server.

Acceptance: ChatGPT OAuth login, reconnect/refresh, `tools/list`, read tool call, wrong subject/scope/audience denial and sanitized audit trail.

### Phase 4 — optional operator mutations

Mutation scopes remain separate and are enabled only after read-only E2E is stable. Deploy/rollback remain in GitHub Actions rather than becoming generic MCP controls.

## Rollback

Before Phase 1, rollback is straightforward:

1. keep `BETTER_AUTH_ENABLED=false`;
2. deploy the previous application release if needed;
3. run the dedicated down migration only after confirming the bridge is unused.

The down migration intentionally does not use `CASCADE`; unexpected dependencies must block rollback instead of being silently destroyed.

After identities are live, do not drop the Better Auth schema as an automated rollback. Disable new auth entry points first and use the documented identity/session migration path.
