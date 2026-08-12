# WorkOS/AuthKit runbook for Recruiter Radar operator MCP

This runbook configures WorkOS only as the OAuth authorization server for the private Recruiter Radar operator MCP. Recruiter Radar remains the resource server and validates every access token locally.

Do not put a WorkOS API key, client secret, access token or refresh token in Recruiter Radar environment variables, GitHub logs, this repository or ChatGPT.

## 1. WorkOS/AuthKit environment

Use a production WorkOS environment and an AuthKit domain that will remain stable. The MCP resource server performs an exact string comparison against the JWT `iss`, so copy the exact `issuer` value from WorkOS discovery rather than guessing slash/path normalization.

Verify:

```text
https://<authkit-domain>/.well-known/oauth-authorization-server
```

The metadata should expose authorization code + refresh token support, S256 PKCE, token endpoint, registration metadata as configured, and `offline_access` support.

## 2. MCP client registration model

In WorkOS Dashboard:

1. Open **Connect -> Configuration**.
2. Enable **Client ID Metadata Document (CIMD)**.
3. Keep **Dynamic Client Registration (DCR)** disabled initially.
4. If the real ChatGPT **Scan Tools** flow proves that the current client build still requires DCR, enable DCR only as a compatibility fallback and re-run acceptance. Do not enable DCR merely because an older MCP client once needed it.

This preference follows current MCP authorization direction: CIMD reduces authorization-server registration state for public MCP clients, while WorkOS retains DCR for backward compatibility.

## 3. Resource Indicator

Add exactly this Resource Indicator in WorkOS:

```text
https://recruiter-radar.ru/api/internal/mcp
```

This value must match all three places:

- WorkOS Resource Indicator;
- protected-resource metadata `resource`;
- JWT access-token `aud`.

Do not use the site root, an `/api` prefix, a localhost URL, or the protected-resource metadata URL as the resource.

## 4. Owner identity

Use one dedicated owner identity for the first production acceptance.

Recommended controls:

- verified primary email in WorkOS;
- passkey where supported;
- MFA enabled for the owner/session policy;
- no shared account;
- review active WorkOS sessions and revoke stale sessions before production enablement.

After an OAuth test login, obtain the immutable subject identifier that WorkOS places in the access-token `sub` claim. Store only that identifier as the GitHub Actions secret `RR_MCP_OAUTH_ALLOWED_SUBJECTS`.

Authorization in Recruiter Radar is based on exact `sub`, never on email address, display name, Google account label or mutable profile fields.

## 5. Scopes

Start with only:

```text
rr.operator.read
```

The initial access token must not receive mutation scopes.

After read-only E2E is proven and the actual ChatGPT UI/plan is proven to support write actions, add only the capabilities that will be used:

```text
rr.operator.restart
rr.operator.proxy
```

Recruiter Radar also requires `rr.operator.read` on mutation tokens. A token that has only a mutation scope is rejected.

Do not create a wildcard `rr.operator.*` scope and do not create a generic admin scope.

## 6. Refresh tokens

ChatGPT documentation expects the authorization provider to support refresh/offline access for durable connectivity. AuthKit advertises the refresh-token grant and `offline_access` in its MCP authorization metadata.

During acceptance, prove both:

1. initial authorization/login works;
2. reconnect after token refresh/re-authorization works without weakening subject, audience or scope checks.

Do not declare the integration complete after only the first token succeeds.

## 7. GitHub production activation

Configure repository settings, not committed files:

### Variables

```text
RR_OPERATOR_AUTH_PROVIDER=workos
RR_MCP_ENABLED=true
RR_MCP_MUTATIONS_ENABLED=false
RR_MCP_OAUTH_ISSUER=<exact WorkOS issuer from discovery>
```

### Secret

```text
RR_MCP_OAUTH_ALLOWED_SUBJECTS=<exact immutable WorkOS sub>
```

No WorkOS client secret is required by the Recruiter Radar MCP resource server.

After these settings exist, merge/deploy an ordinary tested `main` SHA. The post-deploy `Operator MCP Bootstrap` workflow will:

- create/verify the read-only PostgreSQL role;
- install the allowlisted Unix-socket host agent;
- start the isolated operator container;
- install the narrow Caddy route;
- verify the public RFC 9728 metadata endpoint;
- verify unauthenticated MCP requests return `401` with the path-specific resource-metadata challenge.

If the WorkOS settings are absent, the workflow intentionally leaves the MCP dark (`404`).

## 8. ChatGPT connection

Use the UI that is actually present in the user’s ChatGPT account; OpenAI plan labels and rollout rules can change independently of this repository.

For the current documented custom-app flow on ChatGPT web:

1. Open **Settings -> Apps**.
2. Enable Developer mode / custom app creation if the account UI exposes it.
3. Choose **Create** / add a custom MCP app.
4. MCP URL:

   ```text
   https://recruiter-radar.ru/api/internal/mcp
   ```

5. Authentication: **OAuth**.
6. Click **Scan Tools**.
7. Complete the WorkOS/AuthKit login and consent flow.
8. Confirm the scan exposes the expected **nine read tools** while `RR_MCP_MUTATIONS_ENABLED=false`.
9. Create/enable the app in the account/workspace UI.

If the user’s Plus UI exposes a custom MCP entry even though current public plan documentation does not describe that exact rollout, treat the observed UI as a compatibility signal — but still require real OAuth + Scan Tools + tool-call acceptance before declaring support.

## 9. Read-only acceptance

All checks are required:

- OAuth login succeeds;
- protected-resource discovery uses the exact MCP resource;
- access token `aud` is the exact MCP URL;
- access token `sub` matches the one-owner allowlist;
- read token has `rr.operator.read` and no mutation scope;
- **Scan Tools** returns the nine expected read tools;
- `get_production_state` returns the exact production deployment SHA;
- `get_system_health`, service status and resource usage work;
- bounded logs work and returned text contains no known test credential/PII fixtures;
- database diagnostics report read-only mode and current migrations;
- Quality tools do not manufacture `HUMAN_REVIEWED`/`QUALITY_VALIDATED`;
- missing token => `401`;
- wrong issuer/audience/subject => denied;
- wrong scope => `403`;
- reconnect/refresh works;
- MCP audit event exists for successful and denied calls;
- public web behavior is unchanged.

## 10. Optional mutation activation

Only after read-only acceptance and actual ChatGPT write support are proven:

1. add `rr.operator.restart` and/or `rr.operator.proxy` in WorkOS;
2. set `RR_MCP_MUTATIONS_ENABLED=true` in GitHub repository variables;
3. deploy/bootstrap again;
4. re-scan or recreate the ChatGPT custom app so the changed tool snapshot is reviewed;
5. prove a bounded `restart_service(web)` with an idempotency key and verify the postcondition/audit;
6. prove `reload_proxy` only after Caddy validation passes;
7. confirm `db`, `redis` and `firecrawl` cannot be restarted through MCP.

Do not add deploy/rollback/migration/shell/SQL/filesystem/HTTP-fetch tools to make ChatGPT “more powerful”. Those boundaries are intentional.

## References

- WorkOS AuthKit MCP: https://workos.com/docs/authkit/mcp
- OpenAI Developer mode and MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- MCP authorization specification: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
