#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
TELEGRAM_OVERRIDE="$APP_DIR/.rr-telegram.compose.yml"
RUNTIME_DIR="$APP_DIR/config/tg-runtime"
KEY_FILE=""
DEPLOYMENT_LOCK="${RR_DEPLOYMENT_LOCK:-/tmp/recruiter-radar-deployment.lock}"

usage() {
  echo "Usage: $0 --key-file <base64-telegram-env-file>" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --key-file)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      KEY_FILE="$2"
      shift 2
      ;;
    *) usage; exit 2 ;;
  esac
done

[ -n "$KEY_FILE" ] || { usage; exit 2; }
test -d "$APP_DIR" || { echo "Recruiter Radar app directory is missing: $APP_DIR" >&2; exit 1; }
test -f "$KEY_FILE" || { echo 'Staged Telegram env file is missing.' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo 'Docker CLI is required.' >&2; exit 1; }
command -v base64 >/dev/null 2>&1 || { echo 'base64 is required.' >&2; exit 1; }
command -v flock >/dev/null 2>&1 || { echo 'flock is required.' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo 'sha256sum is required.' >&2; exit 1; }

cd "$APP_DIR"
umask 077
exec 9>"$DEPLOYMENT_LOCK"
if ! flock -w 180 9; then
  echo 'Timed out waiting for the production deployment lock.' >&2
  exit 1
fi

strip_quotes() {
  local value="$1"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

read_env_value() {
  local key="$1" source="$2" value
  value="$(sed -n "s/^${key}=//p" "$source" | tail -n 1)"
  strip_quotes "$value"
}

# Decode and validate the staged Telegram env bundle.
encoded_bundle="$(tr -d '\r\n' < "$KEY_FILE")"
[ -n "$encoded_bundle" ] || { echo 'Staged Telegram env bundle is empty.' >&2; exit 1; }
decoded_bundle="$(printf '%s' "$encoded_bundle" | base64 -d 2>/dev/null || true)"
unset encoded_bundle
if ! printf '%s\n' "$decoded_bundle" | grep -q '^TELEGRAM_API_ID='; then
  echo 'TELEGRAM_API_ID is missing in the staged bundle.' >&2
  exit 1
fi
if ! printf '%s\n' "$decoded_bundle" | grep -q '^TELEGRAM_API_HASH='; then
  echo 'TELEGRAM_API_HASH is missing in the staged bundle.' >&2
  exit 1
fi
if ! printf '%s\n' "$decoded_bundle" | grep -q '^TELEGRAM_SESSION='; then
  echo 'TELEGRAM_SESSION is missing in the staged bundle.' >&2
  exit 1
fi

TELEGRAM_API_ID="$(printf '%s\n' "$decoded_bundle" | sed -n 's/^TELEGRAM_API_ID=//p' | tail -n 1)"
TELEGRAM_API_HASH="$(printf '%s\n' "$decoded_bundle" | sed -n 's/^TELEGRAM_API_HASH=//p' | tail -n 1)"
TELEGRAM_SESSION="$(printf '%s\n' "$decoded_bundle" | sed -n 's/^TELEGRAM_SESSION=//p' | tail -n 1)"
unset decoded_bundle

if ! [[ "$TELEGRAM_API_ID" =~ ^[0-9]+$ ]]; then
  echo 'TELEGRAM_API_ID has an unexpected format.' >&2
  exit 1
fi
if ! [[ "$TELEGRAM_API_HASH" =~ ^[a-f0-9]{32}$ ]]; then
  echo 'TELEGRAM_API_HASH has an unexpected format.' >&2
  exit 1
fi
if [ "${#TELEGRAM_SESSION}" -lt 20 ]; then
  echo 'TELEGRAM_SESSION is too short.' >&2
  exit 1
fi

source_env="$ENV_FILE"
[ -f "$source_env" ] || source_env="/dev/null"
configured_compose_files="$(read_env_value COMPOSE_FILE "$source_env")"
if [ -n "$configured_compose_files" ]; then
  case ":$configured_compose_files:" in
    *":$TELEGRAM_OVERRIDE:"* | *":.rr-telegram.compose.yml:"*) : ;;
    *) configured_compose_files="${configured_compose_files}:$TELEGRAM_OVERRIDE" ;;
  esac
else
  base_compose=""
  for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    if [ -f "$candidate" ]; then base_compose="$candidate"; break; fi
  done
  [ -n "$base_compose" ] || { echo "No Docker Compose file found in $APP_DIR" >&2; exit 1; }
  configured_compose_files="$base_compose"
  case "$base_compose" in
    compose.yaml) standard_override="compose.override.yaml" ;;
    compose.yml) standard_override="compose.override.yml" ;;
    docker-compose.yaml) standard_override="docker-compose.override.yaml" ;;
    docker-compose.yml) standard_override="docker-compose.override.yml" ;;
  esac
  if [ -n "${standard_override:-}" ] && [ -f "$standard_override" ]; then
    configured_compose_files="${configured_compose_files}:$standard_override"
  fi
  configured_compose_files="${configured_compose_files}:$TELEGRAM_OVERRIDE"
fi

env_tmp="$(mktemp "$APP_DIR/.env.telegram.XXXXXX")"
override_tmp="$(mktemp "$APP_DIR/.rr-telegram.compose.XXXXXX")"
runtime_tmp="$(mktemp -u "$RUNTIME_DIR/.env.XXXXXX")"
cleanup() { rm -f "$env_tmp" "$override_tmp" "$runtime_tmp" "$KEY_FILE"; }
trap cleanup EXIT

# Write .env without Telegram secrets (they live in the runtime dir only).
awk '
  /^COMPOSE_FILE=/ { next }
  /^TELEGRAM_API_ID=/ { next }
  /^TELEGRAM_API_HASH=/ { next }
  /^TELEGRAM_SESSION=/ { next }
  { print }
' "$source_env" > "$env_tmp"
printf 'COMPOSE_FILE=%s\n' "$configured_compose_files" >> "$env_tmp"
chmod 600 "$env_tmp"

cat > "$override_tmp" <<'COMPOSE_EOF'
services:
  web:
    env_file:
      - /opt/recruiter-radar/config/tg-runtime/.env
COMPOSE_EOF
chmod 600 "$override_tmp"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
printf 'TELEGRAM_API_ID=%s\n' "$TELEGRAM_API_ID" > "$runtime_tmp"
printf 'TELEGRAM_API_HASH=%s\n' "$TELEGRAM_API_HASH" >> "$runtime_tmp"
printf 'TELEGRAM_SESSION=%s\n' "$TELEGRAM_SESSION" >> "$runtime_tmp"
chmod 600 "$runtime_tmp"
unset TELEGRAM_API_ID TELEGRAM_API_HASH TELEGRAM_SESSION

mv "$env_tmp" "$ENV_FILE"; env_tmp=""
mv "$override_tmp" "$TELEGRAM_OVERRIDE"; override_tmp=""
mv "$runtime_tmp" "$RUNTIME_DIR/.env"; runtime_tmp=""
rm -f "$KEY_FILE"; KEY_FILE=""

compose_args=()
IFS=':' read -r -a compose_files <<< "$configured_compose_files"
for compose_file in "${compose_files[@]}"; do compose_args+=(-f "$compose_file"); done

docker compose --env-file "$ENV_FILE" "${compose_args[@]}" config >/dev/null
docker compose --env-file "$ENV_FILE" "${compose_args[@]}" up -d --force-recreate web

published_web_port="$(docker compose --env-file "$ENV_FILE" "${compose_args[@]}" port web 3000)"
if [ "$published_web_port" != "127.0.0.1:3000" ]; then
  echo "Web port trust boundary is invalid: expected 127.0.0.1:3000" >&2
  exit 1
fi

# sha256 comparison: local staged runtime vs container-visible runtime.
local_sha="$(sha256sum "$RUNTIME_DIR/.env" | awk '{print $1}')"
container_sha="$(docker compose --env-file "$ENV_FILE" "${compose_args[@]}" exec -T web sha256sum /opt/recruiter-radar/config/tg-runtime/.env | awk '{print $1}')"
if [ "$local_sha" != "$container_sha" ]; then
  echo "sha256 mismatch between local and container Telegram runtime config." >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" "${compose_args[@]}" exec -T web node --input-type=module -e '
  const apiId = process.env.TELEGRAM_API_ID?.trim() || "";
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() || "";
  const session = process.env.TELEGRAM_SESSION?.trim() || "";
  if (!apiId || !apiHash || !session) throw new Error("Telegram credentials are not available in the web runtime.");
  const { TelegramClient, sessions } = await import("teleproto");
  const client = new TelegramClient(new sessions.StringSession(session), Number(apiId), apiHash, { connectionRetries: 1, autoReconnect: false });
  try {
    await client.connect();
    const authorized = await client.checkAuthorization();
    if (!authorized) throw new Error("not-authorized");
    console.log(JSON.stringify({ check: "telegram-production-auth", status: "passed" }));
  } finally {
    await client.disconnect().catch(() => {});
  }
' </dev/null

trap - EXIT
printf '%s\n' '{"telegramRuntimeConfigured":true,"telegramLiveAuthVerified":true,"authMode":"mtproto-session"}'
