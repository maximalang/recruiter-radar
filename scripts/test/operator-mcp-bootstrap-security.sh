#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bootstrap="$repo_root/scripts/deploy/configure-operator-mcp.sh"
workflow="$repo_root/.github/workflows/operator-mcp-bootstrap.yml"
env_example="$repo_root/.env.operator-mcp.example"

# MCP and auth containers may never receive Docker's privileged socket or a writable host runtime.
grep -Fq '${AGENT_RUNTIME_DIR}:${AGENT_RUNTIME_DIR}:ro' "$bootstrap"
! grep -Fq '${AGENT_RUNTIME_DIR}:${AGENT_RUNTIME_DIR}:rw' "$bootstrap"
! grep -Fq '/var/run/docker.sock' "$bootstrap"
grep -Fq '${AUTH_SECRET_DIR}:/run/secrets/rr-operator-auth:ro' "$bootstrap"
grep -Fq 'cap_drop: [ALL]' "$bootstrap"
grep -Fq 'no-new-privileges:true' "$bootstrap"
grep -Fq 'read_only: true' "$bootstrap"
grep -Fq '127.0.0.1:3001:3000' "$bootstrap"
grep -Fq '127.0.0.1:3002:3002' "$bootstrap"

# Product diagnostics remain read-only and OAuth persistence has a distinct write role/schema only.
grep -Fq 'ALTER ROLE rr_operator_ro SET default_transaction_read_only = on;' "$bootstrap"
grep -Fq 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO rr_operator_ro;' "$bootstrap"
grep -Fq 'CREATE ROLE rr_operator_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;' "$bootstrap"
grep -Fq 'REVOKE ALL PRIVILEGES ON SCHEMA public FROM rr_operator_auth;' "$bootstrap"
grep -Fq 'CREATE SCHEMA operator_auth AUTHORIZATION rr_operator_auth' "$bootstrap"
grep -Fq "has_schema_privilege('rr_operator_auth', 'public', 'CREATE')" "$bootstrap"

# Runtime contract is provider-neutral/local; WorkOS/AuthKit assumptions must not survive.
grep -Fq 'RR_OPERATOR_AUTH_PROVIDER=local_oidc' "$env_example"
grep -Fq 'RR_MCP_ALLOWED_SUBJECTS=rr_owner' "$env_example"
grep -Fq 'RR_MCP_OAUTH_ISSUER=https://recruiter-radar.ru/operator/oauth' "$env_example"
grep -Fq 'RR_MCP_RESOURCE=https://recruiter-radar.ru/api/internal/mcp' "$env_example"
! grep -Eqi 'workos|authkit|user_<exact-workos' "$env_example"

# Bootstrap material is parsed as data, never sourced/eval'd, and owner hash is handled as a file/secret.
! grep -Eq '^[[:space:]]*source[[:space:]].*bootstrap_env' "$workflow"
! grep -Eq '(^|[^A-Za-z])eval[[:space:]]' "$workflow"
! grep -Fq 'RR_MCP_OWNER_PASSWORD=' "$workflow"

# Argon2 PHC strings contain '$' delimiters. Keep the env-file value single-quoted so Compose passes it literally.
grep -Fq "RR_MCP_OWNER_PASSWORD_HASH='\${owner_password_hash}'" "$bootstrap"
! grep -Fq 'RR_MCP_OWNER_PASSWORD_HASH=${owner_password_hash}' "$bootstrap"

printf '%s\n' '{"ok":true,"operatorBootstrapBoundary":"validated"}'
