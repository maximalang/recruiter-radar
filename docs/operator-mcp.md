# Recruiter Radar Operator MCP

`/api/internal/mcp` is an authenticated, read-only operator MCP surface for production diagnostics.

## Security boundary

The endpoint is intentionally narrower than SSH and must stay that way.

- disabled unless `RR_MCP_ENABLED=true`;
- OAuth 2.1 resource-server authentication; static API keys/Bearer secrets are not accepted;
- OAuth access tokens are verified for signature, issuer, audience, expiry/not-before, required scope and an explicit subject allowlist;
- protected-resource metadata is published at `/.well-known/oauth-protected-resource`;
- every advertised tool declares `securitySchemes: [{ type: "oauth2", scopes: ["rr.operator.read"] }]`;
- MCP requests are rate limited;
- no Docker socket;
- no shell/exec tool;
- no arbitrary SQL tool;
- PostgreSQL tools run inside `BEGIN READ ONLY` with bounded statement/lock timeouts;
- no email, phone, raw company evidence, tokens or raw environment values are returned;
- browser `Origin` is rejected unless absent or an approved ChatGPT origin;
- current MCP `2026-07-28` and pre-2026 initialize clients are supported;
- GET transport is not exposed; the MCP server itself uses stateless HTTP POST.

The first tool set is deliberately small:

1. `get_production_state`
2. `get_database_state`
3. `get_quality_validation_state`
4. `list_quality_review_targets`

Any future write/mutation tool requires a separate security review and must not be smuggled into this read-only surface.

## OAuth contract

The canonical protected resource is:

```text
https://recruiter-radar.ru/api/internal/mcp
```

The required scope is:

```text
rr.operator.read
```

The configured authorization server must:

- expose OAuth 2.0 or OpenID Connect discovery metadata;
- expose a JWKS URL used to verify access-token signatures;
- support the authorization-code flow with PKCE for ChatGPT;
- issue an access token whose `iss` equals `RR_MCP_OAUTH_ISSUER`;
- issue the token for the exact resource/audience `https://recruiter-radar.ru/api/internal/mcp`;
- include `rr.operator.read` in `scope`, `scp`, or `permissions`;
- issue a stable `sub` that is explicitly present in `RR_MCP_OAUTH_ALLOWED_SUBJECTS`.

Use an established OAuth/OIDC provider rather than implementing a new authorization server inside Recruiter Radar. The resource server intentionally supports standard JWT access tokens signed with RS256, PS256 or ES256 and discovers signing keys through the provider's JWKS metadata.

## Production activation

MCP stays disabled when its production configuration is absent:

```dotenv
RR_MCP_ENABLED=false
RR_MCP_OAUTH_ISSUER=
RR_MCP_OAUTH_ALLOWED_SUBJECTS=
RR_DEPLOY_SHA=
```

After the OAuth provider is configured, set for example:

```dotenv
RR_MCP_ENABLED=true
RR_MCP_OAUTH_ISSUER=https://<your-oauth-issuer>
RR_MCP_OAUTH_ALLOWED_SUBJECTS=<exact-provider-subject-id>
```

Multiple explicitly authorized operator subjects may be comma-separated. Do not use email addresses as an implicit authorization rule unless the provider turns them into a stable, verified subject policy; the MCP resource server authorizes the immutable OAuth `sub` claim.

Then recreate only `web` through the existing production configurator:

```bash
cd /opt/recruiter-radar
./configure-notification-encryption.sh
```

The script fails closed when MCP is enabled without OAuth configuration and preserves the web loopback-only bind (`127.0.0.1:3000`). If it finds the obsolete `RR_MCP_TOKEN` configuration from the first implementation, it removes that secret and disables MCP until OAuth is configured, so a normal deploy cannot accidentally preserve unsupported static-token authentication.

## Smoke checks

While disabled:

```bash
curl -i https://recruiter-radar.ru/api/internal/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: `404`.

Once enabled with OAuth configured, the protected-resource document must be available:

```bash
curl -fsS https://recruiter-radar.ru/.well-known/oauth-protected-resource
```

It must advertise only the canonical Recruiter Radar MCP resource, configured authorization server and `rr.operator.read` scope.

An unauthenticated MCP request must then return `401` with a `WWW-Authenticate` challenge containing the protected-resource metadata URL. A valid OAuth access token should allow `tools/list`, whose four tools must each advertise the required OAuth security scheme.

For MCP `2026-07-28`, clients additionally send `MCP-Protocol-Version`, `Mcp-Method`, and, for a tool call, `Mcp-Name`.

## ChatGPT connection

Use the current ChatGPT developer-mode/plugin connection UI because plan availability and labels can change independently of this repository.

Endpoint:

```text
https://recruiter-radar.ru/api/internal/mcp
```

Choose OAuth authentication when prompted. ChatGPT discovers `/.well-known/oauth-protected-resource`, follows the configured authorization server metadata, runs authorization-code + PKCE, and sends the resulting access token to the MCP resource server.

Do not configure this production diagnostic endpoint as anonymous/no-auth and do not replace OAuth with a secret URL or custom API-key workaround.

## Stage 2 boundary

This MCP can inspect real Quality v2 aggregates and identify workspace/profile targets for a frozen export. It must not manufacture human labels. `HUMAN_REVIEWED` and `QUALITY_VALIDATED` remain false until independent human labels are imported and evaluated through the existing Stage 2 gold-set workflow.
