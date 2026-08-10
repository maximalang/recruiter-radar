# Recruiter Radar Operator MCP

`/api/internal/mcp` is an authenticated, read-only operator MCP surface for production diagnostics.

## Security boundary

The endpoint is intentionally narrower than SSH and must stay that way.

- disabled unless `RR_MCP_ENABLED=true`;
- Bearer authentication with a dedicated `RR_MCP_TOKEN` of at least 32 characters;
- no Docker socket;
- no shell/exec tool;
- no arbitrary SQL tool;
- PostgreSQL tools run inside `BEGIN READ ONLY` with bounded statement/lock timeouts;
- no email, phone, raw company evidence, tokens or raw environment values are returned;
- browser `Origin` is rejected unless absent or an approved ChatGPT origin;
- current MCP `2026-07-28` and pre-2026 initialize clients are supported;
- GET transport is not exposed; the server uses stateless HTTP POST.

The first tool set is deliberately small:

1. `get_production_state`
2. `get_database_state`
3. `get_quality_validation_state`
4. `list_quality_review_targets`

Any future write/mutation tool requires a separate security review and must not be smuggled into this read-only surface.

## Production activation

The deploy configurator writes the following values into the web runtime. MCP stays disabled when they are absent:

```dotenv
RR_MCP_ENABLED=false
RR_MCP_TOKEN=
RR_DEPLOY_SHA=
```

To enable it on the production server, generate a dedicated random token and update `/opt/recruiter-radar/.env`:

```bash
cd /opt/recruiter-radar
umask 077
TOKEN="$(openssl rand -hex 32)"
printf 'Generated RR_MCP_TOKEN: %s\n' "$TOKEN"
```

Then set exactly:

```dotenv
RR_MCP_ENABLED=true
RR_MCP_TOKEN=<the generated token>
```

Do not commit the token, paste it into GitHub issues/PRs, or reuse `ADMIN_API_KEY`, `CRON_API_KEY`, database credentials or another product secret.

After editing `.env`, recreate only `web` through the existing production configurator:

```bash
cd /opt/recruiter-radar
./configure-notification-encryption.sh
```

The script fails closed if MCP is enabled without a strong token and preserves the web loopback-only bind (`127.0.0.1:3000`). Caddy remains the only public ingress.

## Smoke check

A request without credentials must fail:

```bash
curl -i https://recruiter-radar.ru/api/internal/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: `401 Unauthorized` when MCP is enabled, or `404` while disabled.

A credentialed legacy-compatible probe:

```bash
curl -sS https://recruiter-radar.ru/api/internal/mcp \
  -H "Authorization: Bearer $RR_MCP_TOKEN" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The response must list only the four read-only tools above and must not echo the token.

For MCP `2026-07-28`, clients additionally send `MCP-Protocol-Version`, `Mcp-Method`, and, for a tool call, `Mcp-Name`.

## ChatGPT connection

ChatGPT custom MCP apps require a plan that exposes developer mode/custom apps. Follow the current OpenAI product documentation because plan availability and the UI can change.

Endpoint:

```text
https://recruiter-radar.ru/api/internal/mcp
```

Authentication must never be configured as public/anonymous. If the ChatGPT custom-app UI available to the operator does not offer a secure authentication mechanism compatible with this dedicated credential, leave MCP disabled and use the documented fallback (for example a private tunnel or a separately reviewed OAuth integration) rather than weakening the server.

## Stage 2 boundary

This MCP can inspect real Quality v2 aggregates and identify workspace/profile targets for a frozen export. It must not manufacture human labels. `HUMAN_REVIEWED` and `QUALITY_VALIDATED` remain false until independent human labels are imported and evaluated through the existing Stage 2 gold-set workflow.
