#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
OVERRIDE_FILE="$APP_DIR/.rr-timeweb-mcp.compose.yml"
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

# Never print the token. Validate only its presence and a conservative maximum size.
token_bytes="$(wc -c < "$TOKEN_FILE" | tr -d '[:space:]')"
if ! [[ "$token_bytes" =~ ^[0-9]+$ ]] || [ "$token_bytes" -lt 16 ] || [ "$token_bytes" -gt 4096 ]; then
  echo "Staged Timeweb MCP token is missing or malformed" >&2
  exit 1
fi

umask 077
env_tmp="$(mktemp "$APP_DIR/.env.timeweb.XXXXXX")"
override_tmp="$(mktemp "$APP_DIR/.rr-timeweb-mcp.compose.XXXXXX")"
cleanup() { rm -f "$env_tmp" "$override_tmp"; }
trap cleanup EXIT

token="$(cat "$TOKEN_FILE")"
# Strip one trailing newline without altering token contents otherwise.
token="${token%$'\n'}"
[ -n "$token" ] || { echo "Staged Timeweb MCP token is empty" >&2; exit 1; }

awk \
  -v token_value="$token" \
  -v issuer_value="$EXPECTED_ISSUER" \
  -v subject_value="$EXPECTED_SUBJECT" \
  -v override_value="$OVERRIDE_FILE" '
  BEGIN {
    compose_written = 0
    rr_mcp_written = 0
    mutations_written = 0
    timeweb_enabled_written = 0
    token_written = 0
    issuer_written = 0
    subjects_written = 0
  }
  /^COMPOSE_FILE=/ {
    value = substr($0, index($0, "=") + 1)
    gsub(/^['\"]|['\"]$/, "", value)
    n = split(value, parts, ":")
    found = 0
    for (i = 1; i <= n; i++) if (parts[i] == override_value) found = 1
    if (!found) value = (value == "" ? override_value : value ":" override_value)
    if (!compose_written) { print "COMPOSE_FILE=" value; compose_written = 1 }
    next
  }
  /^RR_MCP_ENABLED=/ {
    if (!rr_mcp_written) { print "RR_MCP_ENABLED=false"; rr_mcp_written = 1 }
    next
  }
  /^RR_MCP_MUTATIONS_ENABLED=/ {
    if (!mutations_written) { print "RR_MCP_MUTATIONS_ENABLED=false"; mutations_written = 1 }
    next
  }
  /^RR_TIMEWEB_MCP_ENABLED=/ {
    if (!timeweb_enabled_written) { print "RR_TIMEWEB_MCP_ENABLED=true"; timeweb_enabled_written = 1 }
    next
  }
  /^RR_TIMEWEB_MCP_TOKEN=/ {
    if (!token_written) { print "RR_TIMEWEB_MCP_TOKEN=" token_value; token_written = 1 }
    next
  }
  /^RR_MCP_OAUTH_ISSUER=/ {
    if (!issuer_written) { print "RR_MCP_OAUTH_ISSUER=" issuer_value; issuer_written = 1 }
    next
  }
  /^RR_MCP_ALLOWED_SUBJECTS=/ {
    if (!subjects_written) { print "RR_MCP_ALLOWED_SUBJECTS=" subject_value; subjects_written = 1 }
    next
  }
  { print }
  END {
    if (!compose_written) print "COMPOSE_FILE=" override_value
    if (!rr_mcp_written) print "RR_MCP_ENABLED=false"
    if (!mutations_written) print "RR_MCP_MUTATIONS_ENABLED=false"
    if (!timeweb_enabled_written) print "RR_TIMEWEB_MCP_ENABLED=true"
    if (!token_written) print "RR_TIMEWEB_MCP_TOKEN=" token_value
    if (!issuer_written) print "RR_MCP_OAUTH_ISSUER=" issuer_value
    if (!subjects_written) print "RR_MCP_ALLOWED_SUBJECTS=" subject_value
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
      RR_MCP_ALLOWED_SUBJECTS: rr_owner
COMPOSE_EOF
chmod 600 "$override_tmp"

COMPOSE_FILE_VALUE="$(sed -n 's/^COMPOSE_FILE=//p' "$env_tmp" | tail -n 1)"
IFS=':' read -r -a compose_files <<< "$COMPOSE_FILE_VALUE"
compose_args=()
for compose_file in "${compose_files[@]}"; do
  [ -n "$compose_file" ] && compose_args+=(-f "$compose_file")
done
if [ "${#compose_args[@]}" -eq 0 ]; then
  echo "COMPOSE_FILE is empty after Timeweb runtime configuration" >&2
  exit 1
fi
# During preflight the final override does not exist yet; replace its path with the staged candidate.
preflight_args=()
for ((i = 0; i < ${#compose_args[@]}; i += 2)); do
  candidate="${compose_args[$((i + 1))]}"
  if [ "$candidate" = "$OVERRIDE_FILE" ]; then candidate="$override_tmp"; fi
  preflight_args+=(-f "$candidate")
done

docker compose --env-file "$env_tmp" "${preflight_args[@]}" config >/dev/null
if [ "$preflight_only" = "true" ]; then
  echo "Timeweb MCP server-only runtime preflight passed."
  exit 0
fi

mv "$env_tmp" "$ENV_FILE"
env_tmp=""
mv "$override_tmp" "$OVERRIDE_FILE"
override_tmp=""
trap - EXIT

docker compose --env-file "$ENV_FILE" "${compose_args[@]}" up -d --force-recreate web

docker compose --env-file "$ENV_FILE" "${compose_args[@]}" exec -T web node -e '
  const expectedIssuer = "https://recruiter-radar.ru/operator/oauth";
  if (process.env.RR_MCP_ENABLED !== "false") process.exit(1);
  if (process.env.RR_MCP_MUTATIONS_ENABLED !== "false") process.exit(1);
  if (process.env.RR_TIMEWEB_MCP_ENABLED !== "true") process.exit(1);
  if ((process.env.RR_TIMEWEB_MCP_TOKEN || "").trim().length < 16) process.exit(1);
  if (process.env.RR_MCP_OAUTH_ISSUER !== expectedIssuer) process.exit(1);
  if (process.env.RR_MCP_ALLOWED_SUBJECTS !== "rr_owner") process.exit(1);
  console.log("Timeweb MCP runtime boundary is valid");
'
