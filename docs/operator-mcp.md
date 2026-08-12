# Recruiter Radar private operator MCP

`https://recruiter-radar.ru/api/internal/mcp` is a private production operator resource server for the owner of Recruiter Radar. It is not a customer-facing MCP and it is not an alternative development workflow.

Code changes remain:

```text
ChatGPT -> GitHub branch/PR -> CI -> merge -> tested-sha autodeploy
```

Production operations are:

```text
ChatGPT
  -> OAuth authorization server (WorkOS AuthKit)
  -> Caddy public TLS boundary
  -> isolated operator container on 127.0.0.1:3001
       -> read-only PostgreSQL role
       -> /run/recruiter-radar-operator/agent.sock
            -> fixed host adapters only
```

The public application remains on `127.0.0.1:3000` and has no operator-agent socket or operator database credential.

## Decision record: WorkOS AuthKit

The operator MCP resource server is provider-neutral at the JWT-validation layer, but production activation is intentionally gated on `RR_OPERATOR_AUTH_PROVIDER=workos` so an old Auth0 configuration cannot accidentally reactivate the endpoint.

| Candidate | Current MCP fit | Owner maintenance | Important constraint | Decision |
| --- | --- | --- | --- | --- |
| WorkOS AuthKit | Excellent: OAuth authorization server metadata, S256 PKCE, refresh tokens, CIMD, optional DCR, Resource Indicators | Low | External SaaS dependency | **Chosen** |
| Auth0 | Good | Low/medium | Resource Parameter Compatibility Profile plus careful DCR setup adds MCP-specific complexity | Replaced |
| Keycloak | Partial for this target | High | Self-hosting/patching burden; strict current Resource Indicator compatibility is not the best fit | Rejected |
| Cloudflare Access Managed OAuth | Good as a separate OAuth front door | Medium | It owns the OAuth challenge/boundary; layering it in front of AuthKit would create two authorization authorities | Rejected as primary auth; edge/WAF remains optional |
| Recruiter Radar customer auth / custom AS | Would require building an authorization server | Very high | Adds OAuth 2.1, client metadata/registration, refresh/revocation and security-critical maintenance to the product | Rejected |

Why an external IdP is justified even for one owner: the existing Recruiter Radar authentication stack is an application session/passkey system, not an OAuth authorization server. Implementing an authorization server solely for one private MCP creates more security-critical code than delegating authorization while keeping authorization enforcement (`aud`, `sub`, scopes) local to Recruiter Radar.

Primary references:

- OpenAI Developer mode and MCP apps in ChatGPT: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- WorkOS AuthKit MCP guide: https://workos.com/docs/authkit/mcp
- MCP authorization specification: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

## Threat model

### Assets

- production availability and deployment integrity;
- production PostgreSQL data and tenant separation;
- credentials, cookies, access/refresh tokens and application secrets;
- Docker/Caddy/host control;
- operational logs that may contain hostile or sensitive text;
- Commercial Signal quality truth, especially `HUMAN_REVIEWED` and `QUALITY_VALIDATED`.

### Actors

- the explicitly allowlisted owner through ChatGPT;
- unauthenticated Internet clients;
- an attacker with a stolen OAuth token/session;
- prompt/tool-injection content inside application logs or database-derived diagnostics;
- a compromised public web container;
- a compromised operator container;
- a compromised CI/SSH/deployment credential.

### Trust boundaries and blast radius

1. **Internet -> Caddy.** Caddy terminates TLS and overwrites forwarding headers. No OpenAI IP allowlist is assumed.
2. **Caddy -> operator container.** Only MCP and RFC 9728 metadata paths route to loopback `:3001`. The public app stays on `:3000`.
3. **WorkOS -> MCP resource server.** Access tokens must have an exact configured `iss`, exact MCP `aud`, non-expired validity, `rr.operator.read`, and an immutable `sub` in the explicit allowlist. Tool-specific scopes are enforced before tool execution.
4. **Operator -> PostgreSQL.** A dedicated `rr_operator_ro` login has read-only defaults and SELECT-only grants. Each diagnostic transaction still begins with `BEGIN READ ONLY` and bounded statement/lock timeouts.
5. **Operator -> host agent.** A root-owned Unix socket is accessible only to the operator group. The agent maps a small action enum to fixed argv subprocesses. The operator container never receives `/var/run/docker.sock`.
6. **GitHub -> production.** Source deploy and rollback remain the existing exact-tested-SHA workflow. No second generic deployment engine is exposed through MCP.

A stolen read token therefore cannot write to the database or call mutation tools. A compromised public web container has neither the operator socket nor the read-only operator credential. A compromised operator container can reach only the read-only database credential and the allowlisted Unix agent, not a generic root shell.

## MCP protocol contract

The preferred protocol is `2026-07-28` stateless HTTP POST with `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` for tool calls. A single bounded `2025-11-25` initialize fallback remains temporarily for clients that have not yet migrated; older protocol branches were removed.

- `GET /api/internal/mcp`: `405`;
- `POST /api/internal/mcp`: JSON-RPC only, maximum 64 KiB;
- no generic SSE/session state;
- current discovery: `server/discover`;
- tools: `tools/list`, `tools/call`;
- RFC 9728 path-specific metadata: `/.well-known/oauth-protected-resource/api/internal/mcp`;
- compatibility root metadata: `/.well-known/oauth-protected-resource`;
- cache: private/no-store for MCP responses;
- request correlation: `X-Request-ID` generated or bounded from the caller;
- unauthenticated coarse per-IP rate limit plus authenticated per-subject rate limit.

The endpoint is invisible (`404`) unless both `RR_OPERATOR_MODE=true` and `RR_MCP_ENABLED=true`.

## Tool taxonomy

### Read plane — `rr.operator.read`

1. `get_production_state` — deployment SHA, safe runtime state and boolean feature gates; never raw environment values.
2. `get_system_health` — uptime/load/memory/swap/disk/process count.
3. `get_service_state` — fixed allowlist: `web`, `db`, `n8n`, `redis`, `firecrawl`.
4. `get_recent_logs` — fixed service allowlist, 60 seconds–24 hours, maximum 500 lines, server-side secret/PII scrubbing. Returned log text is explicitly marked untrusted.
5. `get_resource_usage` — bounded Docker stats for allowlisted services.
6. `get_reverse_proxy_state` — Caddy active/config-valid/version only; no arbitrary Caddyfile read.
7. `get_database_state` — connectivity/version/read-only state/migration metadata.
8. `get_quality_validation_state` — aggregate Quality v2 state only.
9. `list_quality_review_targets` — anonymized IDs/counts for independent human-labeling preparation.

No read tool exposes arbitrary SQL, filesystem paths, URLs, Docker commands, environment dumps, raw evidence, customer email/phone data, or credentials.

### Controlled mutation plane

Mutation tools do not appear in `tools/list` unless `RR_MCP_MUTATIONS_ENABLED=true`.

- `restart_service({service,idempotencyKey})`
  - scopes: `rr.operator.read rr.operator.restart`;
  - enum: only `web` or `n8n`;
  - running-state precondition;
  - bounded restart timeout;
  - running-state postcondition;
  - idempotency record.

- `reload_proxy({idempotencyKey})`
  - scopes: `rr.operator.read rr.operator.proxy`;
  - validates `/etc/caddy/Caddyfile` first;
  - reload only, never edit;
  - postcondition checks Caddy active + configuration valid;
  - idempotency record.

The MCP deliberately does **not** expose deploy, rollback, migration execution, database writes, arbitrary maintenance commands or generic HTTP fetch. Deploy/rollback already have a stronger GitHub Actions implementation with tested-SHA, deployment lock, health verification and rollback guard. Database migrations remain part of the tested deployment lifecycle rather than becoming an operator shortcut.

## Audit trail

Every MCP tool call emits one JSON audit event to operator stdout:

- UTC timestamp;
- OAuth subject;
- tool;
- sanitized/allowlisted arguments only;
- status;
- duration;
- request/correlation ID;
- deployment SHA;
- mutation target where applicable;
- sanitized error code.

Denied mutation-scope checks are audited too. Raw JWTs, cookies, passwords, database URLs, idempotency values and PII are not logged.

The host agent independently emits its own action audit event. Docker log retention therefore contains an application-level and host-adapter-level trail without giving the read-only operator database a hidden write path.

## Commercial Signal quality invariant

The MCP can report `CONTRACT_TESTED` and can identify whether real snapshot/lineage data is ready for independent labeling. It **never** infers `HUMAN_REVIEWED` or `QUALITY_VALIDATED` from model-generated labels. Those remain false until independent human labels and the existing frozen evaluation workflow prove them.

## Production deployment boundary

The standard application Deploy workflow remains responsible only for the customer-facing release. After a successful Deploy, `Operator MCP Bootstrap` configures the isolated operator runtime from that exact SHA. Operator bootstrap failure does not roll back a healthy public application.

The bootstrap creates/maintains:

- host group `rr-operator`;
- dedicated PostgreSQL login `rr_operator_ro` with read-only defaults;
- root-only generated database credential in `/var/lib/recruiter-radar-operator/`;
- root-owned allowlisted Python host agent as a systemd unit;
- Unix socket `/run/recruiter-radar-operator/agent.sock` with group ACL;
- separate Compose `operator` service on `127.0.0.1:3001`;
- read-only container filesystem, dropped Linux capabilities and `no-new-privileges`;
- Caddy route limited to the MCP + protected-resource metadata paths.

No production OAuth values are committed. The activation source is GitHub repository settings:

- variable `RR_OPERATOR_AUTH_PROVIDER=workos`;
- variable `RR_MCP_ENABLED=false|true`;
- variable `RR_MCP_MUTATIONS_ENABLED=false|true`;
- variable `RR_MCP_OAUTH_ISSUER=<exact AuthKit issuer>`;
- secret `RR_MCP_OAUTH_ALLOWED_SUBJECTS=<exact immutable owner sub>`.

The default absence of these settings resolves to a dark MCP (`404`). An old Auth0 value in the server `.env` cannot enable the isolated MCP through this workflow.

## Activation sequence

1. Configure WorkOS/AuthKit using `docs/operator-mcp-workos.md`.
2. Keep `RR_MCP_MUTATIONS_ENABLED=false`.
3. Add the WorkOS GitHub settings above and set `RR_MCP_ENABLED=true`.
4. Let an ordinary tested `main` deploy finish; the separate operator bootstrap will configure the host and assert public `metadata=200` plus unauthenticated MCP `401`.
5. In ChatGPT, add `https://recruiter-radar.ru/api/internal/mcp`, select OAuth, complete login/consent, and run **Scan Tools**.
6. Prove read-only acceptance first: reconnect/refresh, production SHA, service health, sanitized logs, DB read-only, wrong subject/scope denial and audit trail.
7. Only after that decide whether the user’s actual ChatGPT plan/UI supports write actions. Official OpenAI plan documentation can lag or differ from observed rollout; the real Scan Tools/action flow is the release gate.
8. Only if write support is proven, add the two mutation scopes in WorkOS and set `RR_MCP_MUTATIONS_ENABLED=true`. Re-scan/recreate the ChatGPT app so its tool snapshot and permissions are reviewed.

Until step 6 is proven end-to-end, this MCP must not be described as production-ready.
