# Recruiter Radar Operator MCP — Auth0 production setup

This runbook configures Auth0 as the OAuth authorization server for the read-only Recruiter Radar Operator MCP.

## Fixed resource contract

- MCP endpoint: `https://recruiter-radar.ru/api/internal/mcp`
- OAuth resource / Auth0 API Identifier: `https://recruiter-radar.ru/api/internal/mcp`
- Required permission: `rr.operator.read`
- Protected-resource metadata: `https://recruiter-radar.ru/.well-known/oauth-protected-resource`
- Recruiter Radar is only the OAuth resource server. It stores no Auth0 client secret.

Do not enable `RR_MCP_ENABLED` until the Auth0 API, connection, operator identity and ChatGPT OAuth registration are ready.

## 1. Create or choose an Auth0 tenant

Use a dedicated tenant or a tenant whose third-party application policy you control. Record the exact tenant issuer from Auth0. Auth0 issuer identifiers normally use a trailing slash, for example:

```text
https://rr-operator.eu.auth0.com/
```

The Recruiter Radar resource server canonicalizes an origin-only value to the same trailing-slash issuer, but production configuration should still use the exact issuer shown by Auth0.

## 2. Create the Auth0 API

In Auth0 Dashboard:

1. Open **Applications → APIs → Create API**.
2. Name: `Recruiter Radar Operator MCP`.
3. Identifier: `https://recruiter-radar.ru/api/internal/mcp`.
4. Use RS256 signing.
5. Save.
6. Add permission / scope:
   - name: `rr.operator.read`
   - description: `Read Recruiter Radar production diagnostics`
7. In the API settings, enable **Allow Offline Access** so OAuth clients can obtain refresh tokens when they request `offline_access`.

Do not add write/admin scopes to this API.

## 3. Grant the minimum default permission to third-party clients

ChatGPT may register as a third-party OAuth client. Auth0 dynamically registered clients cannot access an API unless default third-party permissions are configured first.

In **Applications → APIs → Recruiter Radar Operator MCP → Settings**:

1. Find **Default Permissions for Third Party Apps**.
2. Select **Authorized for User-Delegated Access**.
3. Grant only `rr.operator.read`.
4. Do not grant Client Access / machine-to-machine permissions.
5. Save.

The MCP resource server independently checks the immutable OAuth `sub` allowlist, so an OAuth client grant alone never authorizes an arbitrary Auth0 user to read Recruiter Radar diagnostics.

## 4. Configure an operator login connection

Use an Auth0 Database, Social or Enterprise connection for the human operator login.

For the selected connection:

1. Open **Authentication → [connection type] → [connection]**.
2. Enable **Promote Connection to Domain Level**.
3. Keep only the identity providers you actually intend to use for this operator flow.

Third-party Auth0 applications can authenticate users only through domain-level connections.

## 5. Create the operator identity and capture its immutable subject

Create/sign in the single Auth0 user that will authorize ChatGPT.

Record its Auth0 `user_id`; this is the stable OAuth `sub`, for example:

```text
auth0|0123456789abcdef
```

Do not authorize by email address. Production `RR_MCP_OAUTH_ALLOWED_SUBJECTS` must contain exact Auth0 subject IDs only.

Start with one operator subject. Add more only through an explicit security review.

## 6. Enable Dynamic Client Registration only for ChatGPT registration

Auth0 DCR is disabled by default. If the ChatGPT custom-app OAuth flow performs dynamic registration:

1. Open **Auth0 Dashboard → Settings → Advanced**.
2. Enable **Dynamic Client Registration (DCR)**.
3. Confirm the API default third-party permission from step 3 is already configured.
4. Continue with the ChatGPT connection flow below.

Auth0 DCR clients use authorization code + PKCE and are created as strict third-party applications. The Auth0 registration endpoint is `/oidc/register`.

After ChatGPT has successfully registered and the OAuth flow has been tested, review the newly created `tpc_...` application in Auth0. If no other dynamic registrations are required, disable open DCR again and verify that the existing ChatGPT client can still refresh/reconnect before considering setup complete.

If the ChatGPT UI instead asks for a pre-registered OAuth client ID, do not create a second overlapping integration. Stop and use the UI-specific flow; the resource-server contract above remains unchanged.

## 7. Configure production runtime

On the production server, set only:

```dotenv
RR_MCP_ENABLED=true
RR_MCP_OAUTH_ISSUER=https://<tenant>.<region>.auth0.com/
RR_MCP_OAUTH_ALLOWED_SUBJECTS=auth0|<exact-user-id>
```

There is no `RR_MCP_TOKEN` and no Auth0 client secret in Recruiter Radar.

Then run:

```bash
cd /opt/recruiter-radar
./configure-notification-encryption.sh
```

The configurator fails closed if OAuth configuration is incomplete and keeps the web service bound to `127.0.0.1:3000` behind Caddy.

## 8. Verify the public OAuth/MCP boundary

Protected-resource metadata:

```bash
curl -fsS https://recruiter-radar.ru/.well-known/oauth-protected-resource
```

Expected semantics:

```json
{
  "resource": "https://recruiter-radar.ru/api/internal/mcp",
  "authorization_servers": ["https://<tenant>.<region>.auth0.com/"],
  "scopes_supported": ["rr.operator.read"]
}
```

Unauthenticated MCP request:

```bash
curl -i https://recruiter-radar.ru/api/internal/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: `401` and `WWW-Authenticate` pointing at Recruiter Radar protected-resource metadata.

A token without `rr.operator.read` must return `403` with `error="insufficient_scope"`.

## 9. Connect ChatGPT

In the ChatGPT account where custom MCP creation is available:

1. Open the custom app / MCP creation screen.
2. Endpoint: `https://recruiter-radar.ru/api/internal/mcp`.
3. Choose OAuth authentication.
4. Run **Scan Tools**.
5. Complete Auth0 Universal Login and consent using the exact operator identity from step 5.
6. Finish the tool scan and create/enable the app.

Expected tool inventory — exactly four read-only tools:

1. `get_production_state`
2. `get_database_state`
3. `get_quality_validation_state`
4. `list_quality_review_targets`

If ChatGPT asks for a refresh/offline consent, allow it. Auth0 API Offline Access must remain enabled so the connection does not die when the first access token expires.

## 10. Acceptance gate

Do not call the MCP production-ready until all of these are true:

- protected-resource metadata returns the exact Auth0 issuer and MCP resource;
- unauthenticated MCP returns 401 with the OAuth challenge;
- wrong audience is rejected;
- wrong `sub` is rejected;
- missing `rr.operator.read` returns 403;
- the allowed operator completes Auth0 consent from ChatGPT;
- ChatGPT scans exactly four tools;
- `get_production_state` succeeds;
- `get_database_state` succeeds in read-only mode;
- no shell, arbitrary SQL, Docker or mutation tool is present;
- reconnect/refresh is verified after the initial authorization.

Only after this gate should the MCP be used for the real production/Stage 2 audit. It still must not manufacture human-review labels or claim `HUMAN_REVIEWED` / `QUALITY_VALIDATED` without independent human review.