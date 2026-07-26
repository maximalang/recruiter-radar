#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
NOTIFICATION_OVERRIDE="$APP_DIR/.rr-notification-key.compose.yml"

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
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

notification_key="$(
  sed -n 's/^NOTIFICATION_ENCRYPTION_KEY=//p' "$ENV_FILE" |
    tail -n 1
)"
notification_key="$(strip_quotes "$notification_key")"
landing_rate_limit_salt="$(
  sed -n 's/^LANDING_ANALYTICS_RATE_LIMIT_SALT=//p' "$ENV_FILE" |
    tail -n 1
)"
landing_rate_limit_salt="$(strip_quotes "$landing_rate_limit_salt")"

if [ -z "$landing_rate_limit_salt" ]; then
  echo "LANDING_ANALYTICS_RATE_LIMIT_SALT is required; refusing to deploy" >&2
  exit 1
fi
unset landing_rate_limit_salt

if [ -z "$notification_key" ]; then
  # Preserve credentials encrypted while the app used the SESSION_SECRET fallback.
  # This computes exactly the same 32-byte key as notification-secrets.ts.
  notification_key="$(
    docker compose "${compose_args[@]}" run --rm --no-deps -T web \
      node -e '
        const { createHash } = require("node:crypto");
        const value = process.env.SESSION_SECRET?.trim();
        if (!value || value.length < 32) process.exit(2);
        process.stdout.write(
          createHash("sha256").update(value, "utf8").digest("hex"),
        );
      '
  )"
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

env_tmp="$(mktemp "$APP_DIR/.env.notification.XXXXXX")"
awk -v value="$notification_key" '
  BEGIN { written = 0 }
  /^NOTIFICATION_ENCRYPTION_KEY=/ {
    if (!written) {
      print "NOTIFICATION_ENCRYPTION_KEY=" value
      written = 1
    }
    next
  }
  { print }
  END {
    if (!written) print "NOTIFICATION_ENCRYPTION_KEY=" value
  }
' "$ENV_FILE" > "$env_tmp"
chmod 600 "$env_tmp"
mv "$env_tmp" "$ENV_FILE"
unset notification_key

cat > "$NOTIFICATION_OVERRIDE" <<'COMPOSE_EOF'
services:
  web:
    # Caddy is the only public ingress and the only trusted X-Real-IP writer.
    ports: !override
      - "127.0.0.1:3000:3000"
    environment:
      NOTIFICATION_ENCRYPTION_KEY: ${NOTIFICATION_ENCRYPTION_KEY:?NOTIFICATION_ENCRYPTION_KEY is required}
      LANDING_ANALYTICS_RATE_LIMIT_SALT: ${LANDING_ANALYTICS_RATE_LIMIT_SALT:?LANDING_ANALYTICS_RATE_LIMIT_SALT is required}
      PUBLIC_APP_ORIGIN: ${PUBLIC_APP_ORIGIN:-https://recruiter-radar.ru}
COMPOSE_EOF
chmod 600 "$NOTIFICATION_OVERRIDE"

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
    console.log("Notification encryption key is configured");
  '
