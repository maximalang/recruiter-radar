#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
YOUTUBE_OVERRIDE="$APP_DIR/.rr-youtube.compose.yml"
KEY_FILE=""
DEPLOYMENT_LOCK="${RR_DEPLOYMENT_LOCK:-/tmp/recruiter-radar-deployment.lock}"

usage() {
  echo "Usage: $0 --key-file <base64-api-key-file>" >&2
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
test -f "$KEY_FILE" || { echo 'Staged YouTube API key file is missing.' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo 'Docker CLI is required.' >&2; exit 1; }
command -v base64 >/dev/null 2>&1 || { echo 'base64 is required.' >&2; exit 1; }
command -v flock >/dev/null 2>&1 || { echo 'flock is required.' >&2; exit 1; }

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

encoded_key="$(tr -d '\r\n' < "$KEY_FILE")"
[ -n "$encoded_key" ] || { echo 'Staged YouTube API key is empty.' >&2; exit 1; }
youtube_api_key="$(printf '%s' "$encoded_key" | base64 -d 2>/dev/null || true)"
unset encoded_key
if ! [[ "$youtube_api_key" =~ ^[A-Za-z0-9_-]{20,200}$ ]]; then
  echo 'YOUTUBE_API_KEY has an unexpected format.' >&2
  exit 1
fi

source_env="$ENV_FILE"
[ -f "$source_env" ] || source_env="/dev/null"
configured_compose_files="$(read_env_value COMPOSE_FILE "$source_env")"
if [ -n "$configured_compose_files" ]; then
  case ":$configured_compose_files:" in
    *":$YOUTUBE_OVERRIDE:"* | *":.rr-youtube.compose.yml:"*) : ;;
    *) configured_compose_files="${configured_compose_files}:$YOUTUBE_OVERRIDE" ;;
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
  configured_compose_files="${configured_compose_files}:$YOUTUBE_OVERRIDE"
fi

env_tmp="$(mktemp "$APP_DIR/.env.youtube.XXXXXX")"
override_tmp="$(mktemp "$APP_DIR/.rr-youtube.compose.XXXXXX")"
cleanup() { rm -f "$env_tmp" "$override_tmp" "$KEY_FILE"; }
trap cleanup EXIT

awk '
  /^COMPOSE_FILE=/ { next }
  /^YOUTUBE_API_KEY=/ { next }
  { print }
' "$source_env" > "$env_tmp"
printf 'COMPOSE_FILE=%s\n' "$configured_compose_files" >> "$env_tmp"
printf 'YOUTUBE_API_KEY=%s\n' "$youtube_api_key" >> "$env_tmp"
chmod 600 "$env_tmp"
unset youtube_api_key

cat > "$override_tmp" <<'COMPOSE_EOF'
services:
  web:
    environment:
      YOUTUBE_API_KEY: ${YOUTUBE_API_KEY:?YOUTUBE_API_KEY is required}
COMPOSE_EOF
chmod 600 "$override_tmp"

mv "$env_tmp" "$ENV_FILE"; env_tmp=""
mv "$override_tmp" "$YOUTUBE_OVERRIDE"; override_tmp=""
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

docker compose --env-file "$ENV_FILE" "${compose_args[@]}" exec -T web node --input-type=module -e '
  const key = process.env.YOUTUBE_API_KEY?.trim() || "";
  if (!key) throw new Error("YOUTUBE_API_KEY is not available in the web runtime.");
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "id");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("key", key);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    let reason = "unknown";
    try {
      const payload = await response.json();
      reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || reason;
    } catch {}
    throw new Error(`YouTube production key check failed with HTTP ${response.status} (${reason}).`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.items)) throw new Error("YouTube API returned an unexpected payload.");
  console.log(JSON.stringify({ check: "youtube-production-auth", status: "passed", items: payload.items.length }));
' </dev/null

trap - EXIT
printf '%s\n' '{"youtubeRuntimeConfigured":true,"youtubeLiveAuthVerified":true,"authMode":"api-key"}'
