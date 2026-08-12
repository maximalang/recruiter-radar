#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bootstrap="$repo_root/scripts/deploy/configure-operator-mcp.sh"
workflow="$repo_root/.github/workflows/operator-mcp-bootstrap.yml"

# The MCP container may connect to the Unix socket but may never mutate the host
# runtime directory or receive Docker's privileged socket.
grep -Fq '${AGENT_RUNTIME_DIR}:${AGENT_RUNTIME_DIR}:ro' "$bootstrap"
! grep -Fq '${AGENT_RUNTIME_DIR}:${AGENT_RUNTIME_DIR}:rw' "$bootstrap"
! grep -Fq '/var/run/docker.sock' "$bootstrap"

grep -Fq 'cap_drop:' "$bootstrap"
grep -Fq 'no-new-privileges:true' "$bootstrap"
grep -Fq 'read_only: true' "$bootstrap"

# Re-bootstrap must remove privilege drift from the diagnostic DB role.
grep -Fq 'ALTER ROLE rr_operator_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;' "$bootstrap"
grep -Fq "ALTER ROLE rr_operator_ro SET default_transaction_read_only = on;" "$bootstrap"
grep -Fq 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM rr_operator_ro;' "$bootstrap"
grep -Fq 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO rr_operator_ro;' "$bootstrap"

# Uploaded secret-bearing bootstrap material is parsed as data, never evaluated
# as a shell fragment. WorkOS is an explicit activation gate.
! grep -Eq '^[[:space:]]*source[[:space:]].*bootstrap_env' "$workflow"
grep -Fq 'RR_OPERATOR_AUTH_PROVIDER=workos' "$repo_root/.env.operator-mcp.example"
grep -Fq 'RR_OPERATOR_AUTH_PROVIDER:-}" != "workos"' "$workflow"
grep -Fq 'read_bootstrap_value()' "$workflow"

printf '%s\n' '{"ok":true,"operatorBootstrapBoundary":"validated"}'
