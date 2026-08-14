# Recruiter Radar → Timeweb Cloud MCP bridge

This runbook describes the production MCP exposed to ChatGPT after the legacy Recruiter Radar Operator MCP retirement.

## Canonical contract

- MCP resource: `https://recruiter-radar.ru/api/internal/timeweb-mcp`
- OAuth issuer: `https://recruiter-radar.ru/operator/oauth`
- OAuth resource / JWT audience: `https://recruiter-radar.ru/api/internal/timeweb-mcp`
- OAuth scope: `rr.timeweb.manage`
- owner subject: `rr_owner`
- RFC 9728 metadata: `https://recruiter-radar.ru/.well-known/oauth-protected-resource/api/internal/timeweb-mcp`
- fixed upstream: `https://timeweb.cloud/api/v1/mcp`

The legacy Recruiter Radar MCP resource `https://recruiter-radar.ru/api/internal/mcp` and its protected-resource metadata are intentionally fail-closed with HTTP 404. `RR_MCP_ENABLED=false` and `RR_MCP_MUTATIONS_ENABLED=false` remain production invariants.

## Architecture

```text
ChatGPT Web
  -> recruiter-radar.ru Caddy/TLS
       -> /operator/oauth/* -> 127.0.0.1:3002 -> isolated operator-auth
       -> /api/internal/timeweb-mcp -> normal hardened web runtime
             -> verify Recruiter Radar OAuth JWT
             -> inject server-only Timeweb Bearer token
             -> https://timeweb.cloud/api/v1/mcp
```

The bridge does not implement or copy Timeweb tools. JSON-RPC/MCP requests are forwarded to the one fixed upstream with only the protocol headers required by MCP. User-supplied upstream URLs, bearer credentials and arbitrary headers are not supported.

## OAuth security profile

The isolated auth service keeps the existing hardened owner model while binding it to the Timeweb resource:

- Authorization Code only;
- PKCE required, S256 only;
- DCR for public OAuth clients only;
- exact HTTPS redirect URIs only;
- `offline_access` with rotating refresh tokens;
- refresh/code replay protection through persistent `operator_auth` storage;
- RFC 8707 exact resource indicator;
- ES256 / P-256 JWT access tokens;
- exact `iss`, single `aud`, `sub`, `scope`, expiry and timing validation;
- persistent signing/cookie keys mounted read-only into auth;
- public JWKS strips private `d`;
- Argon2id owner-password verification;
- persistent IP/account brute-force throttling;
- CSRF protection and restrictive login/consent response headers;
- allowlisted structured auth audit fields only.

The private signing key exists only in the isolated auth service. The web bridge receives public JWKS through OAuth discovery, never the private signing material.

## Timeweb API credential

The deployment source of truth is the GitHub Actions secret:

`RR_TIMEWEB_MCP_TOKEN`

Do not place the token in source control, a `NEXT_PUBLIC_*` variable, ChatGPT, tickets, logs or product tables.

`Timeweb MCP Bootstrap` stages the secret through a mode-0600 file, installs it under `/var/lib/recruiter-radar-timeweb/token`, and configures only the server-side web runtime. The bridge replaces any client `Authorization` header with `Bearer <server credential>` when calling the fixed Timeweb MCP upstream.

The existing owner-login secret remains:

`RR_MCP_OWNER_PASSWORD_HASH`

It must contain an Argon2id encoded hash, never the plaintext owner password.

## Bridge boundary

The resource server enforces:

- `RR_TIMEWEB_MCP_ENABLED=true` before the route becomes active;
- fixed upstream `https://timeweb.cloud/api/v1/mcp`;
- separate Timeweb credential from Recruiter Radar mutation gates;
- 1 MiB bounded request body;
- pre-auth and per-subject rate limits;
- OAuth audience/scope/subject validation;
- 30 second upstream timeout through `AbortSignal`;
- `redirect: manual` and rejection of upstream redirects;
- MCP protocol/session/method/name headers only;
- upstream HTTP status and response-body passthrough;
- no arbitrary URL/fetch/command/filesystem/Docker-socket capability;
- safe audit metadata without request bodies, OAuth tokens or Timeweb credentials.

Unauthenticated requests return HTTP 401 with `WWW-Authenticate` pointing to the Timeweb RFC 9728 protected-resource document. A valid token with the wrong scope is rejected separately.

## Production deployment

The normal `Deploy` workflow remains responsible for the tested customer-facing release. After a successful deploy of `main`, `Timeweb MCP Bootstrap` consumes that exact SHA.

The bootstrap:

1. validates the exact deployed SHA and the Timeweb deployment scripts;
2. refuses to continue if `RR_TIMEWEB_MCP_TOKEN` or `RR_MCP_OWNER_PASSWORD_HASH` is absent/invalid;
3. builds the exact-SHA `operator-auth` image;
4. transfers scripts, image and protected files over the existing SSH deployment channel;
5. changes Caddy first so `/api/internal/mcp` is 404 before local legacy services are removed;
6. starts only the Timeweb OAuth profile on loopback `127.0.0.1:3002`;
7. removes the legacy operator container and disables the old host agent;
8. configures the web runtime with `RR_MCP_ENABLED=false`, `RR_MCP_MUTATIONS_ENABLED=false` and `RR_TIMEWEB_MCP_ENABLED=true`;
9. revalidates Caddy and local health;
10. verifies public legacy 404, Timeweb RFC 9728 metadata, OAuth discovery, public JWKS, DCR and unauthenticated 401 challenge.

A Timeweb bootstrap failure does not rewrite application code or introduce an unauthenticated fallback.

## Required production acceptance

Before treating the integration as fully accepted, verify:

- legacy `/api/internal/mcp` = 404;
- legacy protected-resource metadata = 404;
- Timeweb protected-resource metadata = 200 and exact;
- OIDC / RFC 8414 discovery = 200;
- DCR accepts the ChatGPT public client contract;
- JWKS has ES256 P-256 public keys and no `d`;
- unauthenticated Timeweb MCP = 401 with the correct `resource_metadata` challenge;
- owner login + consent issue a JWT for audience `.../timeweb-mcp` and scope `rr.timeweb.manage`;
- `tools/list` comes from the official Timeweb MCP;
- at least one clearly read-only Timeweb tool returns real infrastructure data;
- no Timeweb token appears in response bodies, browser-visible configuration or audit logs.

Do not run destructive Timeweb tools as a smoke test.

## ChatGPT Web setup

Create the custom MCP/app as:

```text
Name: Timeweb Cloud
URL: https://recruiter-radar.ru/api/internal/timeweb-mcp
Authentication: OAuth
```

Expected flow:

```text
ChatGPT
  -> protected-resource discovery
  -> OAuth discovery
  -> DCR
  -> owner login
  -> consent
  -> resource-bound access token
  -> Scan Tools
  -> official Timeweb MCP tools
```

If ChatGPT fails, capture the exact OAuth/MCP contract failure and fix the contract. Do not weaken audience validation, PKCE, DCR redirect validation or the fixed-upstream boundary as a workaround.

## Rollback / emergency disable

The legacy Recruiter Radar operational MCP must remain disabled during rollback unless a separate security review explicitly reintroduces it.

For an emergency Timeweb bridge disable, set `RR_TIMEWEB_MCP_ENABLED=false` in the controlled server runtime and recreate the web service; keep the Caddy legacy 404 rule in place. Rotate/revoke the Timeweb API token at Timeweb if compromise is suspected, then replace the GitHub Actions secret before re-enabling.
