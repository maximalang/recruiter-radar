# Recruiter Radar private Operator MCP

This is the production runbook for the single-owner Recruiter Radar Operator MCP. It is a separate security domain from customer authentication, Better Auth, billing, workspaces and normal Recruiter Radar users.

## Canonical endpoints

- MCP resource: `https://recruiter-radar.ru/api/internal/mcp`
- OAuth issuer: `https://recruiter-radar.ru/operator/oauth`
- owner subject: `rr_owner`
- first-rollout scope: `rr.operator.read`
- RFC 9728 metadata: `https://recruiter-radar.ru/.well-known/oauth-protected-resource/api/internal/mcp`

## Architecture

```text
ChatGPT
  -> Caddy TLS boundary
       -> exact OAuth routes -> 127.0.0.1:3002 -> operator-auth
       -> MCP + RFC9728     -> 127.0.0.1:3001 -> operator resource server
                                                   -> rr_operator_ro PostgreSQL
                                                   -> bounded Unix host-agent
```

`operator-auth` uses `oidc-provider@9.11.1` and a PostgreSQL adapter. OAuth state is stored only in schema `operator_auth` through login `rr_operator_auth`. That role has no product-table grants and no CREATE privilege on `public`.

The MCP resource server remains a separate Next.js runtime with `rr_operator_ro`. It does not receive OAuth write credentials. The customer-facing web runtime does not receive the host-agent socket or operator DB credentials.

## OAuth profile

The production profile intentionally keeps the attack surface small:

- Authorization Code only;
- PKCE required, S256 only;
- `offline_access` + rotating refresh tokens;
- refresh-token reuse revokes the associated grant family;
- RFC 8707 resource indicator bound to the exact MCP resource;
- JWT access tokens signed with persistent ES256 P-256 key(s);
- `iss`, exact single `aud`, `exp`, `nbf`, sane `iat`, `sub` and scopes validated by the resource server;
- RFC 9207 authorization-response issuer supported by the provider;
- revocation endpoint enabled;
- DCR enabled only as a compatibility fallback for public clients; no client secret, wildcard redirect URI or non-HTTPS redirect is accepted;
- CIMD disabled for the first rollout because the provider implementation is experimental and therefore not a stable production dependency for this private MCP.

Implicit, hybrid, password, client-credentials, device flow, CIBA and generic admin scopes are not part of this profile.

## Owner model

There is exactly one principal: `rr_owner`.

There is no signup, registration UI, password reset, organization, invitation, social login or linkage to normal Recruiter Radar users. The subject is immutable and is not a secret.

The owner password is never stored. `operator-auth` requires an Argon2id encoded hash supplied through the GitHub Actions secret `RR_MCP_OWNER_PASSWORD_HASH`. The hash is staged as a root-only file during bootstrap and is never printed by the workflow.

### Initial owner password bootstrap

Run this on a trusted local machine from the exact repository revision you are about to deploy:

```bash
cd operator-auth
npm ci --no-audit --no-fund
read -rsp 'Owner password: ' RR_OWNER_PASSWORD; printf '\n'
printf '%s' "$RR_OWNER_PASSWORD" | node --input-type=module -e '
  import argon2 from "argon2";
  let input="";
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(await argon2.hash(input, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  }));
' > /tmp/rr-owner-password.hash
unset RR_OWNER_PASSWORD
cat /tmp/rr-owner-password.hash | gh secret set RR_MCP_OWNER_PASSWORD_HASH --repo maximalang/recruiter-radar
rm -f /tmp/rr-owner-password.hash
```

Do not paste the plaintext password into GitHub, a shell command argument, a ticket, ChatGPT, logs or this repository.

When the secret is absent, `Operator MCP Bootstrap` leaves the MCP fail-dark rather than inventing a credential or falling back to unauthenticated access.

## Persistent signing and session secrets

Bootstrap creates these only on the production host when missing:

- `/var/lib/recruiter-radar-operator/auth-secrets/jwks.json`
- `/var/lib/recruiter-radar-operator/auth-secrets/cookie-keys.json`

They are root/service-group readable only and mounted read-only into `operator-auth`. They are not regenerated on container restart.

### Signing-key rotation

1. Generate a new ES256 P-256 private JWK with a unique `kid` on the host without logging it.
2. Add it to the private JWK set while retaining the previous active key.
3. Restart only `operator-auth` through the normal controlled operator bootstrap/deploy path.
4. Verify JWKS exposes both public keys and new tokens use the new `kid`.
5. Keep the previous public key until every access token signed with it has exceeded the maximum access-token lifetime plus clock skew.
6. Remove the old private/public JWK and verify discovery/JWKS again.

Never rotate by deleting the only key before old access tokens expire.

### Cookie-key rotation

Prepend a new high-entropy key to `cookie-keys.json`, retain at least the immediately previous key during the session transition, then recreate `operator-auth`. Do not rotate keys on every deploy.

## Password rotation

Create a new Argon2id hash using the local procedure above, replace `RR_MCP_OWNER_PASSWORD_HASH`, and rerun `Operator MCP Bootstrap` for the current production SHA. Existing OAuth grants should be revoked after a password rotation if credential compromise is suspected.

## Refresh-token revocation

The authorization server exposes its revocation endpoint and persists grants/refresh tokens in `operator_auth`. Rotation is enabled. Reuse of a consumed refresh token causes the provider to revoke the grant family. For an emergency global owner reset, clear the owner’s OAuth grants from the isolated `operator_auth` store through a controlled server administration procedure; do not mutate product tables.

## Login security

The owner login interaction is server-side and uses:

- Argon2id verification;
- a `Secure`, `HttpOnly`, `SameSite=Strict` CSRF cookie;
- per-interaction CSRF token;
- generic invalid-credential response;
- IP + account failure counters in persistent `operator_auth.login_throttle`;
- bounded exponential lockout;
- `Cache-Control: no-store`, frame denial and restrictive CSP;
- structured audit events with an allowlist of fields.

Passwords, password hashes, authorization codes, JWTs, refresh tokens, private JWKs, cookies and full Authorization headers are not audit fields.

## Resource server and read tools

Unauthenticated MCP requests return HTTP `401` with `WWW-Authenticate` pointing at the path-specific RFC 9728 metadata document. Missing/invalid read scope returns `403`.

With `RR_MCP_MUTATIONS_ENABLED=false`, `tools/list` exposes only:

1. `get_production_state`
2. `get_system_health`
3. `get_service_state`
4. `get_recent_logs`
5. `get_resource_usage`
6. `get_reverse_proxy_state`
7. `get_database_state`
8. `get_quality_validation_state`
9. `list_quality_review_targets`

No read tool exposes arbitrary shell, SQL, filesystem, HTTP fetch, environment dump, Docker API or secrets. Database diagnostics execute in explicit read-only transactions.

## Mutation rollout

Keep `RR_MCP_MUTATIONS_ENABLED=false` until real ChatGPT read-only E2E has succeeded.

The only mutation capabilities already designed are:

- `restart_service(web|n8n)` with `rr.operator.restart`;
- `reload_proxy` with `rr.operator.proxy`.

Before enabling them, separately verify ChatGPT confirmation behavior, scope issuance, audit, idempotency and postconditions. Do not add arbitrary shell/SQL/filesystem/fetch, `docker.sock`, DB/Redis/Firecrawl restart, migrations, deploy or rollback. Deploy/rollback remain GitHub Actions operations.

## Deployment

`Deploy` remains the customer-facing tested-SHA deployment. After a successful `main` Deploy, `Operator MCP Bootstrap` consumes exactly that SHA.

The bootstrap:

- builds the exact-SHA `operator-auth` image in GitHub Actions;
- transfers it and audited bootstrap scripts over the existing SSH deployment channel;
- maintains `rr_operator_ro` and `rr_operator_auth` as distinct PostgreSQL roles;
- creates `operator_auth` persistence only;
- recreates operator services on loopback ports only;
- preserves the bounded host-agent;
- installs only the exact Caddy routes needed by MCP/OAuth;
- validates external RFC 9728, OIDC/RFC 8414/JWKS and unauthenticated MCP behavior when enabled.

A bootstrap failure does not roll back or patch the already-verified public product release.

## ChatGPT setup and acceptance

In ChatGPT Developer mode, create a custom MCP/app with:

```text
https://recruiter-radar.ru/api/internal/mcp
```

Then complete OAuth owner login and authorization and run Scan Tools.

Do not call the system production-ready until the real account/UI has proven:

- Scan Tools succeeds;
- `tools/list` contains only the nine read tools above;
- `get_production_state` reports the expected production SHA;
- `get_system_health`, service status and resource usage return bounded diagnostics;
- bounded logs remain sanitized/untrusted content;
- `get_database_state` proves the read-only DB transaction/role;
- refresh/reconnect works after initial authorization;
- secrets do not appear in tool output or audit.

If the actual ChatGPT plan/UI cannot complete a supported mode, record that exact product limitation. Do not loosen OAuth or MCP security to work around it.

## Fail-dark / rollback

MCP is visible only when the isolated operator runtime has both `RR_OPERATOR_MODE=true` and a complete valid OAuth configuration. Missing owner hash, signing state, auth persistence or invalid issuer/resource/sub configuration must not result in anonymous MCP access.

To disable the subsystem, remove/rotate the owner hash secret and rerun the normal bootstrap/deploy path so the operator MCP is configured dark. Do not introduce a temporary no-auth path.

## Troubleshooting

- **MCP `404`:** verify bootstrap intentionally enabled the MCP; absence of the owner hash leaves it dark.
- **MCP `401`:** inspect RFC 9728 metadata, issuer discovery and JWT `iss/aud/sub/scope` without logging the token.
- **OAuth discovery wrong host/scheme:** verify Caddy `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto=https`; the provider trusts only the loopback proxy boundary.
- **DCR rejected:** client must be public and use exact HTTPS redirect URIs with Authorization Code.
- **PKCE rejected:** only S256 is supported.
- **Refresh rejected after reuse:** expected; refresh-token reuse revokes the grant family and requires fresh authorization.
- **OAuth state lost after restart:** treat as a persistence incident; `MemoryAdapter` is not a production fallback. Verify `operator_auth` connectivity/role and do not enable anonymous access.
- **JWT key not found:** verify persistent JWKS and safe overlapping key rotation; do not regenerate keys automatically.
- **mutations missing:** expected in the read-only rollout.
