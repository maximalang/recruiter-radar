#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
NOTIFICATION_OVERRIDE="$APP_DIR/.rr-notification-key.compose.yml"
preflight_only=false

case "${1:-}" in
  "") ;;
  --preflight) preflight_only=true ;;
  *)
    echo "Usage: $0 [--preflight]" >&2
    exit 2
    ;;
esac

cd "$APP_DIR"

compose_args=()
configured_compose_files="${COMPOSE_FILE:-}"

strip_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

read_env_value() {
  local key="$1"
  local source="$2"
  local value
  value="$(
    sed -n "s/^${key}=//p" "$source" |
      tail -n 1
  )"
  strip_quotes "$value"
}

if [ -z "$configured_compose_files" ] && [ -f "$ENV_FILE" ]; then
  configured_compose_files="$(
    sed -n 's/^COMPOSE_FILE=//p' "$ENV_FILE" |
      tail -n 1
  )"
  configured_compose_files="$(strip_quotes "$configured_compose_files")"
fi

if [ -n "$configured_compose_files" ]; then
  IFS=':' read -r -a compose_files <<< "$configured_compose_files"
  for compose_file in "${compose_files[@]}"; do
    compose_args+=(-f "$compose_file")
  done
else
  base_compose=""
  for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    if [ -f "$candidate" ]; then
      base_compose="$candidate"
      break
    fi
  done

  if [ -z "$base_compose" ]; then
    echo "No Docker Compose file found in $APP_DIR" >&2
    exit 1
  fi

  compose_args+=(-f "$base_compose")

  standard_override=""
  case "$base_compose" in
    compose.yaml) standard_override="compose.override.yaml" ;;
    compose.yml) standard_override="compose.override.yml" ;;
    docker-compose.yaml) standard_override="docker-compose.override.yaml" ;;
    docker-compose.yml) standard_override="docker-compose.override.yml" ;;
  esac

  if [ -n "$standard_override" ] && [ -f "$standard_override" ]; then
    compose_args+=(-f "$standard_override")
  fi
fi

umask 077
env_source="$ENV_FILE"
if [ ! -f "$env_source" ]; then
  env_source="/dev/null"
fi

notification_key="$(read_env_value NOTIFICATION_ENCRYPTION_KEY "$env_source")"
landing_rate_limit_salt="$(read_env_value LANDING_ANALYTICS_RATE_LIMIT_SALT "$env_source")"
public_app_origin="$(read_env_value PUBLIC_APP_ORIGIN "$env_source")"
file_mcp_enabled="$(read_env_value RR_MCP_ENABLED "$env_source")"
file_mcp_token="$(read_env_value RR_MCP_TOKEN "$env_source")"
file_deploy_sha="$(read_env_value RR_DEPLOY_SHA "$env_source")"

mcp_enabled="${RR_MCP_ENABLED:-${file_mcp_enabled:-false}}"
mcp_token="${RR_MCP_TOKEN:-$file_mcp_token}"
deploy_sha="${RR_DEPLOY_SHA:-$file_deploy_sha}"

case "$mcp_enabled" in
  true | false) ;;
  *)
    echo "RR_MCP_ENABLED must be exactly true or false; refusing to deploy" >&2
    exit 1
    ;;
esac

if [ "$mcp_enabled" = "true" ] && [ "${#mcp_token}" -lt 32 ]; then
  echo "RR_MCP_TOKEN must contain at least 32 characters when RR_MCP_ENABLED=true; refusing to deploy" >&2
  exit 1
fi

if [ -n "$deploy_sha" ] && ! [[ "$deploy_sha" =~ ^[A-Fa-f0-9]{40}$ ]]; then
  echo "RR_DEPLOY_SHA must be a full 40-character commit SHA when set; refusing to deploy" >&2
  exit 1
fi

if [ "${#landing_rate_limit_salt}" -lt 32 ]; then
  echo "LANDING_ANALYTICS_RATE_LIMIT_SALT must contain at least 32 characters; refusing to deploy" >&2
  exit 1
fi
unset landing_rate_limit_salt

if [ "$public_app_origin" != "https://recruiter-radar.ru" ]; then
  echo "PUBLIC_APP_ORIGIN must use the canonical HTTPS origin; refusing to deploy" >&2
  exit 1
fi

if [ -z "$notification_key" ]; then
  echo "NOTIFICATION_ENCRYPTION_KEY is missing or invalid; refusing to deploy" >&2
  exit 1
fi

valid_key=false
if [[ "$notification_key" =~ ^[A-Fa-f0-9]{64}$ ]]; then
  valid_key=true
else
  decoded_bytes="$(
    set +o pipefail
    printf '%s' "$notification_key" |
      openssl base64 -d -A 2>/dev/null |
      wc -c |
      tr -d '[:space:]'
  )"
  if [ "$decoded_bytes" = "32" ]; then
    valid_key=true
  fi
fi

if [ "$valid_key" != "true" ]; then
  echo "NOTIFICATION_ENCRYPTION_KEY is missing or invalid; refusing to deploy" >&2
  exit 1
fi

env_tmp=""
override_tmp=""
cleanup_preflight_files() {
  if [ -n "$env_tmp" ]; then
    rm -f "$env_tmp"
  fi
  if [ -n "$override_tmp" ]; then
    rm -f "$override_tmp"
  fi
}
trap cleanup_preflight_files EXIT

env_tmp="$(mktemp "$APP_DIR/.env.production.XXXXXX")"
awk \
  -v notification_value="$notification_key" \
  -v origin_value="$public_app_origin" \
  -v mcp_enabled_value="$mcp_enabled" \
  -v mcp_token_value="$mcp_token" \
  -v deploy_sha_value="$deploy_sha" '
  BEGIN {
    notification_written = 0
    origin_written = 0
    mcp_enabled_written = 0
    mcp_token_written = 0
    deploy_sha_written = 0
  }
  /^NOTIFICATION_ENCRYPTION_KEY=/ {
    if (!notification_written) {
      print "NOTIFICATION_ENCRYPTION_KEY=" notification_value
      notification_written = 1
    }
    next
  }
  /^PUBLIC_APP_ORIGIN=/ {
    if (!origin_written) {
      print "PUBLIC_APP_ORIGIN=" origin_value
      origin_written = 1
    }
    next
  }
  /^RR_MCP_ENABLED=/ {
    if (!mcp_enabled_written) {
      print "RR_MCP_ENABLED=" mcp_enabled_value
      mcp_enabled_written = 1
    }
    next
  }
  /^RR_MCP_TOKEN=/ {
    if (!mcp_token_written) {
      print "RR_MCP_TOKEN=" mcp_token_value
      mcp_token_written = 1
    }
    next
  }
  /^RR_DEPLOY_SHA=/ {
    if (!deploy_sha_written) {
      print "RR_DEPLOY_SHA=" deploy_sha_value
      deploy_sha_written = 1
    }
    next
  }
  { print }
  END {
    if (!notification_written) print "NOTIFICATION_ENCRYPTION_KEY=" notification_value
    if (!origin_written) print "PUBLIC_APP_ORIGIN=" origin_value
    if (!mcp_enabled_written) print "RR_MCP_ENABLED=" mcp_enabled_value
    if (!mcp_token_written) print "RR_MCP_TOKEN=" mcp_token_value
    if (!deploy_sha_written && deploy_sha_value != "") print "RR_DEPLOY_SHA=" deploy_sha_value
  }
' "$env_source" > "$env_tmp"
chmod 600 "$env_tmp"
unset notification_key public_app_origin mcp_token

override_tmp="$(mktemp "$APP_DIR/.rr-notification-key.compose.XXXXXX")"
cat > "$override_tmp" <<'COMPOSE_EOF'
services:
  web:
    # Caddy is the only public ingress and the only trusted X-Real-IP writer.
    ports: !override
      - "127.0.0.1:3000:3000"
    environment:
      NOTIFICATION_ENCRYPTION_KEY: ${NOTIFICATION_ENCRYPTION_KEY:?NOTIFICATION_ENCRYPTION_KEY is required}
      LANDING_ANALYTICS_RATE_LIMIT_SALT: ${LANDING_ANALYTICS_RATE_LIMIT_SALT:?LANDING_ANALYTICS_RATE_LIMIT_SALT is required}
      PUBLIC_APP_ORIGIN: ${PUBLIC_APP_ORIGIN:?PUBLIC_APP_ORIGIN is required}
      RR_MCP_ENABLED: ${RR_MCP_ENABLED:-false}
      RR_MCP_TOKEN: ${RR_MCP_TOKEN:-}
      RR_DEPLOY_SHA: ${RR_DEPLOY_SHA:-}
COMPOSE_EOF
chmod 600 "$override_tmp"

preflight_compose_args=("${compose_args[@]}" -f "$override_tmp")

docker compose --env-file "$env_tmp" "${preflight_compose_args[@]}" config >/dev/null

if [ "$preflight_only" = "true" ]; then
  echo "Production runtime configuration preflight passed."
  exit 0
fi

mv "$env_tmp" "$ENV_FILE"
env_tmp=""
mv "$override_tmp" "$NOTIFICATION_OVERRIDE"
override_tmp=""
trap - EXIT

compose_args+=(-f "$NOTIFICATION_OVERRIDE")

docker compose "${compose_args[@]}" up -d --force-recreate web

published_web_port="$(
  docker compose "${compose_args[@]}" port web 3000
)"
if [ "$published_web_port" != "127.0.0.1:3000" ]; then
  echo "Web port trust boundary is invalid: expected 127.0.0.1:3000" >&2
  exit 1
fi

docker compose "${compose_args[@]}" exec -T web \
  node -e '
    const raw = process.env.NOTIFICATION_ENCRYPTION_KEY?.trim() || "";
    const decoded = /^[a-f0-9]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    if (decoded.length !== 32) process.exit(1);
    const mcpEnabled = process.env.RR_MCP_ENABLED === "true";
    const mcpToken = process.env.RR_MCP_TOKEN?.trim() || "";
    if (mcpEnabled && mcpToken.length < 32) process.exit(1);
    console.log("Notification encryption key and optional MCP configuration are valid");
  '
