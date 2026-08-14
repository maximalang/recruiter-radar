#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
TIMEWEB_OVERRIDE="$APP_DIR/.rr-timeweb-mcp.compose.yml"
NOTIFICATION_OVERRIDE="$APP_DIR/.rr-notification-key.compose.yml"
TOKEN_FILE="${RR_TIMEWEB_MCP_TOKEN_FILE:-/var/lib/recruiter-radar-timeweb/token}"
EXPECTED_ISSUER="https://recruiter-radar.ru/operator/oauth"
EXPECTED_SUBJECT="rr_owner"
preflight_only=false

case "${1:-}" in
  "") ;;
  --preflight) preflight_only=true ;;
  *) echo "Usage: $0 [--preflight]" >&2; exit 2 ;;
esac

cd "$APP_DIR"
[ -f "$ENV_FILE" ] || { echo "Production .env is missing" >&2; exit 1; }
[ -f "$TOKEN_FILE" ] || { echo "RR_TIMEWEB_MCP_TOKEN is not staged on the server" >&2; exit 1; }

token_bytes="$(wc -c < "$TOKEN_FILE" | tr -d '[:space:]')"
if ! [[ "$token_bytes" =~ ^[0-9]+$ ]] || [ "$token_bytes" -lt 16 ] || [ "$token_bytes" -gt 4096 ]; then
  echo "Staged Timeweb MCP token is missing or malformed" >&2
  exit 1
fi

strip_quotes() {
  local value="$1"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

compose_args=()
configured_compose_files="${COMPOSE_FILE:-}"
if [ -z "$configured_compose_files" ]; then
  configured_compose_files="$(sed -n 's/^COMPOSE_FILE=//p' "$ENV_FILE" | tail -n 1)"
  configured_compose_files="$(strip_quotes "$configured_compose_files")"
fi
if [ -n "$configured_compose_files" ]; then
  IFS=':' read -r -a compose_files <<< "$configured_compose_files"
  for compose_file in "${compose_files[@]}"; do [ -n "$compose_file" ] && compose_args+=(-f "$compose_file"); done
else
  base_compose=""
  for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    if [ -f "$candidate" ]; then base_compose="$candidate"; break; fi
  done
  [ -n "$base_compose" ] || { echo "No Docker Compose file found in $APP_DIR" >&2; exit 1; }
  compose_args+=(-f "$base_compose")
  case "$base_compose" in
    compose.yaml) standard_override="compose.override.yaml" ;;
    compose.yml) standard_override="compose.override.yml" ;;
    docker-compose.yaml) standard_override="docker-compose.override.yaml" ;;
    docker-compose.yml) standard_override="docker-compose.override.yml" ;;
  esac
  if [ -n "${standard_override:-}" ] && [ -f "$standard_override" ]; then compose_args+=(-f "$standard_override"); fi
fi
if [ -f "$NOTIFICATION_OVERRIDE" ]; then compose_args+=(-f "$NOTIFICATION_OVERRIDE"); fi

umask 077
env_tmp="$(mktemp "$APP_DIR/.env.timeweb.XXXXXX")"
override_tmp="$(mktemp "$APP_DIR/.rr-timeweb-mcp.compose.XXXXXX")"
cleanup() { rm -f "$env_tmp" "$override_tmp"; }
trap cleanup EXIT

token="$(cat "$TOKEN_FILE")"
token="${token%$'\n'}"
[ -n "$token" ] || { echo "Staged Timeweb MCP token is empty" >&2; exit 1; }

awk \
  -v token_value="$token" \
  -v issuer_value="$EXPECTED_ISSUER" \
  -v subject_value="$EXPECTED_SUBJECT" '
  BEGIN { old_enabled=0; mutations=0; tw_enabled=0; tw_token=0; issuer=0; subjects=0 }
  /^RR_MCP_ENABLED=/ { if (!old_enabled) { print "RR_MCP_ENABLED=false"; old_enabled=1 }; next }
  /^RR_MCP_MUTATIONS_ENABLED=/ { if (!mutations) { print "RR_MCP_MUTATIONS_ENABLED=false"; mutations=1 }; next }
  /^RR_TIMEWEB_MCP_ENABLED=/ { if (!tw_enabled) { print "RR_TIMEWEB_MCP_ENABLED=true"; tw_enabled=1 }; next }
  /^RR_TIMEWEB_MCP_TOKEN=/ { if (!tw_token) { print "RR_TIMEWEB_MCP_TOKEN=" token_value; tw_token=1 }; next }
  /^RR_MCP_OAUTH_ISSUER=/ { if (!issuer) { print "RR_MCP_OAUTH_ISSUER=" issuer_value; issuer=1 }; next }
  /^RR_MCP_OAUTH_ALLOWED_SUBJECTS=/ { if (!subjects) { print "RR_MCP_OAUTH_ALLOWED_SUBJECTS=" subject_value; subjects=1 }; next }
  { print }
  END {
    if (!old_enabled) print "RR_MCP_ENABLED=false"
    if (!mutations) print "RR_MCP_MUTATIONS_ENABLED=false"
    if (!tw_enabled) print "RR_TIMEWEB_MCP_ENABLED=true"
    if (!tw_token) print "RR_TIMEWEB_MCP_TOKEN=" token_value
    if (!issuer) print "RR_MCP_OAUTH_ISSUER=" issuer_value
    if (!subjects) print "RR_MCP_OAUTH_ALLOWED_SUBJECTS=" subject_value
  }
' "$ENV_FILE" > "$env_tmp"
chmod 600 "$env_tmp"
unset token

cat > "$override_tmp" <<'COMPOSE_EOF'
services:
  web:
    environment:
      RR_MCP_ENABLED: "false"
      RR_MCP_MUTATIONS_ENABLED: "false"
      RR_TIMEWEB_MCP_ENABLED: "true"
      RR_TIMEWEB_MCP_TOKEN: ${RR_TIMEWEB_MCP_TOKEN:?RR_TIMEWEB_MCP_TOKEN is required}
      RR_MCP_OAUTH_ISSUER: https://recruiter-radar.ru/operator/oauth
      RR_MCP_OAUTH_ALLOWED_SUBJECTS: rr_owner
COMPOSE_EOF
chmod 600 "$override_tmp"

preflight_args=("${compose_args[@]}" -f "$override_tmp")
docker compose --env-file "$env_tmp" "${preflight_args[@]}" config >/dev/null

if [ "$preflight_only" = "true" ]; then
  echo "Timeweb MCP server-only runtime preflight passed."
  exit 0
fi

mv "$env_tmp" "$ENV_FILE"; env_tmp=""
mv "$override_tmp" "$TIMEWEB_OVERRIDE"; override_tmp=""
trap - EXIT

runtime_args=("${compose_args[@]}" -f "$TIMEWEB_OVERRIDE")
docker compose --env-file "$ENV_FILE" "${runtime_args[@]}" up -d --force-recreate web

docker compose --env-file "$ENV_FILE" "${runtime_args[@]}" exec -T web node -e '
  if (process.env.RR_MCP_ENABLED !== "false") process.exit(1);
  if (process.env.RR_MCP_MUTATIONS_ENABLED !== "false") process.exit(1);
  if (process.env.RR_TIMEWEB_MCP_ENABLED !== "true") process.exit(1);
  if ((process.env.RR_TIMEWEB_MCP_TOKEN || "").trim().length < 16) process.exit(1);
  if (process.env.RR_MCP_OAUTH_ISSUER !== "https://recruiter-radar.ru/operator/oauth") process.exit(1);
  if (process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS !== "rr_owner") process.exit(1);
  console.log("Timeweb MCP runtime boundary is valid");
'
