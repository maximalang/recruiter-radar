#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
NOTIFICATION_OVERRIDE="$APP_DIR/.rr-notification-key.compose.yml"
HH_OVERRIDE="$APP_DIR/.rr-hh.compose.yml"
TOKEN_FILE=""
HH_USER_AGENT_VALUE='RecruiterRadar/1.0 (support@recruiter-radar.ru)'
DEPLOYMENT_LOCK="${RR_DEPLOYMENT_LOCK:-/tmp/recruiter-radar-deployment.lock}"

usage() {
  echo "Usage: $0 --token-file <base64-token-file>" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --token-file)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      TOKEN_FILE="$2"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[ -n "$TOKEN_FILE" ] || { usage; exit 2; }
test -d "$APP_DIR" || { echo "Recruiter Radar app directory is missing: $APP_DIR" >&2; exit 1; }
test -f "$TOKEN_FILE" || { echo 'Staged HH token file is missing.' >&2; exit 1; }
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
  value="$(sed -n "s/^${key}=//p" "$source" | tail -n 1)"
  strip_quotes "$value"
}

encoded_token="$(tr -d '\r\n' < "$TOKEN_FILE")"
[ -n "$encoded_token" ] || { echo 'Staged HH token is empty.' >&2; exit 1; }

hh_access_token="$(printf '%s' "$encoded_token" | base64 -d 2>/dev/null || true)"
unset encoded_token
[ -n "$hh_access_token" ] || { echo 'Staged HH token could not be decoded.' >&2; exit 1; }

if ! [[ "$hh_access_token" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
  echo 'HH_ACCESS_TOKEN contains unsupported dotenv characters.' >&2
  exit 1
fi

source_env="$ENV_FILE"
if [ ! -f "$source_env" ]; then
  source_env="/dev/null"
fi

env_tmp="$(mktemp "$APP_DIR/.env.hh.XXXXXX")"
override_tmp="$(mktemp "$APP_DIR/.rr-hh.compose.XXXXXX")"
cleanup() {
  rm -f "$env_tmp" "$override_tmp" "$TOKEN_FILE"
}
trap cleanup EXIT

awk '
  /^HH_USER_AGENT=/ { next }
  /^HH_ACCESS_TOKEN=/ { next }
  /^HH_CLIENT_ID=/ { next }
  /^HH_CLIENT_SECRET=/ { next }
  { print }
' "$source_env" > "$env_tmp"
printf 'HH_USER_AGENT="%s"\n' "$HH_USER_AGENT_VALUE" >> "$env_tmp"
printf 'HH_ACCESS_TOKEN=%s\n' "$hh_access_token" >> "$env_tmp"
chmod 600 "$env_tmp"
unset hh_access_token

cat > "$override_tmp" <<'COMPOSE_EOF'
services:
  web:
    environment:
      HH_USER_AGENT: ${HH_USER_AGENT:?HH_USER_AGENT is required}
      HH_ACCESS_TOKEN: ${HH_ACCESS_TOKEN:?HH_ACCESS_TOKEN is required}
COMPOSE_EOF
chmod 600 "$override_tmp"

mv "$env_tmp" "$ENV_FILE"
env_tmp=""
mv "$override_tmp" "$HH_OVERRIDE"
override_tmp=""
rm -f "$TOKEN_FILE"
TOKEN_FILE=""

compose_args=()
configured_compose_files="$(read_env_value COMPOSE_FILE "$ENV_FILE")"
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
  [ -n "$base_compose" ] || { echo "No Docker Compose file found in $APP_DIR" >&2; exit 1; }
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

if [ -f "$NOTIFICATION_OVERRIDE" ]; then
  compose_args+=(-f "$NOTIFICATION_OVERRIDE")
fi
compose_args+=(-f "$HH_OVERRIDE")

docker compose --env-file "$ENV_FILE" "${compose_args[@]}" config >/dev/null
docker compose --env-file "$ENV_FILE" "${compose_args[@]}" up -d --force-recreate web

published_web_port="$(docker compose --env-file "$ENV_FILE" "${compose_args[@]}" port web 3000)"
if [ "$published_web_port" != "127.0.0.1:3000" ]; then
  echo "Web port trust boundary is invalid: expected 127.0.0.1:3000" >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" "${compose_args[@]}" exec -T web \
  node --input-type=module -e '
    const token = process.env.HH_ACCESS_TOKEN?.trim() || "";
    const userAgent = process.env.HH_USER_AGENT?.trim() || "";
    if (!token) throw new Error("HH_ACCESS_TOKEN is not available in the web runtime.");
    if (!userAgent) throw new Error("HH_USER_AGENT is not available in the web runtime.");

    const response = await fetch("https://api.hh.ru/vacancies?per_page=1", {
      headers: {
        Authorization: `Bearer ${token}`,
        "HH-User-Agent": userAgent,
        "User-Agent": userAgent,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      let type = "unknown";
      let value = "unknown";
      try {
        const payload = await response.json();
        type = payload?.errors?.[0]?.type || payload?.error || type;
        value = payload?.errors?.[0]?.value || value;
      } catch {}
      throw new Error(`HH production auth check failed with HTTP ${response.status} (${type}/${value}).`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.items)) {
      throw new Error("HH production auth check returned an unexpected vacancy payload.");
    }

    console.log(JSON.stringify({
      check: "hh-production-auth",
      status: "passed",
      vacancyItems: payload.items.length,
    }));
  ' </dev/null

trap - EXIT
printf '%s\n' '{"hhRuntimeConfigured":true,"hhLiveAuthVerified":true,"authMode":"application-token"}'
