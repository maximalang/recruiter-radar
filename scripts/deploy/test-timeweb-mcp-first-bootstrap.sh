#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTH_SCRIPT="$ROOT_DIR/scripts/deploy/configure-timeweb-mcp-auth.sh"
RUNTIME_SCRIPT="$ROOT_DIR/scripts/deploy/configure-timeweb-mcp-runtime.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

APP_DIR="$TMP_DIR/app"
FAKE_BIN="$TMP_DIR/bin"
OWNER_HASH_FILE="$TMP_DIR/owner-hash"
TOKEN_FILE="$TMP_DIR/timeweb-token"
mkdir -p "$APP_DIR" "$FAKE_BIN"

cat > "$APP_DIR/.env" <<'EOF'
COMPOSE_FILE=compose.yml
EOF
cat > "$APP_DIR/compose.yml" <<'EOF'
services:
  db:
    image: postgres:16
  web:
    image: node:22
EOF
printf '%s' '$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture' > "$OWNER_HASH_FILE"
printf '%s' 'fixture-timeweb-token-1234567890' > "$TOKEN_FILE"

cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  inspect)
    exit 0
    ;;
  image)
    exit 0
    ;;
  exec)
    if [ "${2:-}" = "recruiter-radar-db-1" ]; then
      printf '%s' postgres
    fi
    exit 0
    ;;
  compose)
    exit 0
    ;;
  *)
    echo "Unexpected docker invocation: $*" >&2
    exit 1
    ;;
esac
EOF
chmod 0755 "$FAKE_BIN/docker"

export PATH="$FAKE_BIN:$PATH"
DEPLOY_SHA="$(printf 'a%.0s' {1..40})"

RR_APP_DIR="$APP_DIR" \
RR_DEPLOY_SHA="$DEPLOY_SHA" \
RR_OPERATOR_AUTH_IMAGE="recruiter-radar-operator-auth:${DEPLOY_SHA}" \
RR_MCP_OWNER_PASSWORD_HASH_FILE="$OWNER_HASH_FILE" \
  "$AUTH_SCRIPT" --preflight

# A first bootstrap must not require the Timeweb compose override to exist yet.
test ! -e "$APP_DIR/.rr-timeweb-mcp.compose.yml"

RR_APP_DIR="$APP_DIR" \
RR_TIMEWEB_MCP_TOKEN_FILE="$TOKEN_FILE" \
  "$RUNTIME_SCRIPT" --preflight

# Preflight must remain side-effect free.
test ! -e "$APP_DIR/.rr-timeweb-mcp.compose.yml"
grep -Fxq 'COMPOSE_FILE=compose.yml' "$APP_DIR/.env"

echo "Timeweb clean first-bootstrap preflight passed."
