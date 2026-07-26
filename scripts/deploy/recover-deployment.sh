#!/usr/bin/env bash
set -Eeuo pipefail

app_dir="${RR_APP_DIR:-/opt/recruiter-radar}"
marker_path="${RR_DEPLOYMENT_MARKER:-$app_dir/.deployment-switched}"
expected_deploy_sha="${EXPECTED_DEPLOY_SHA:-}"
runtime_configurator="$app_dir/configure-notification-encryption.sh"
recovery_lock_path="${RR_RECOVERY_LOCK:-/tmp/recruiter-radar-deployment.lock}"
deployment_lock_held="${RR_DEPLOYMENT_LOCK_HELD:-false}"
health_attempts="${RR_RECOVERY_HEALTH_ATTEMPTS:-30}"
health_delay="${RR_RECOVERY_HEALTH_DELAY:-2}"

if [ "$deployment_lock_held" != "true" ]; then
  if ! command -v flock > /dev/null 2>&1; then
    echo "flock is unavailable; recovery marker is preserved." >&2
    exit 1
  fi
  exec 9> "$recovery_lock_path"
  if ! flock -w 180 9; then
    echo "Timed out waiting for production deployment recovery; marker is preserved." >&2
    exit 1
  fi
fi
if [ ! -f "$marker_path" ]; then
  echo "No deployment marker found; external rollback has nothing to change."
  exit 0
fi

read_marker_value() {
  local key="$1"
  local count
  local value

  count="$(grep -c "^${key}=" "$marker_path" || true)"
  if [ "$count" -ne 1 ]; then
    echo "Deployment marker field ${key} is missing or duplicated." >&2
    return 1
  fi
  value="$(sed -n "s/^${key}=//p" "$marker_path")"
  printf '%s' "$value"
}

deploy_sha="$(read_marker_value deploy_sha)"
previous_image_id="$(read_marker_value previous_image_id)"
created_at="$(read_marker_value created_at)"

if ! printf '%s' "$deploy_sha" | grep -Eq '^[0-9a-f]{7,64}$'; then
  echo "Deployment marker contains an invalid deploy SHA." >&2
  exit 1
fi
if [ -n "$expected_deploy_sha" ] &&
  [ "$deploy_sha" != "$expected_deploy_sha" ]; then
  echo "Deployment marker SHA does not match the failed deployment." >&2
  exit 1
fi
if ! printf '%s' "$previous_image_id" |
  grep -Eq '^sha256:[0-9a-f]{64}$'; then
  echo "Deployment marker contains an invalid previous image ID." >&2
  exit 1
fi
if ! printf '%s' "$created_at" |
  grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then
  echo "Deployment marker contains an invalid timestamp." >&2
  exit 1
fi
if [ ! -x "$runtime_configurator" ]; then
  echo "Runtime configurator is unavailable; recovery marker is preserved." >&2
  exit 1
fi

cd "$app_dir"
docker image inspect "$previous_image_id" > /dev/null
running_image_id="$(
  docker inspect --format '{{.Image}}' recruiter-radar-web-1 2>/dev/null || true
)"
if [ "$running_image_id" = "$previous_image_id" ]; then
  echo "Previous production image is already running; skipping duplicate recreation."
else
  docker tag "$previous_image_id" recruiter-radar:rollback
  docker tag "$previous_image_id" recruiter-radar:latest
  "$runtime_configurator"
fi

health_ok=false
for attempt in $(seq 1 "$health_attempts"); do
  if curl -fsS http://localhost:3000/api/health > /dev/null 2>&1; then
    health_ok=true
    echo "Rollback health check passed after attempt ${attempt}"
    break
  fi
  sleep "$health_delay"
done
if [ "$health_ok" != "true" ]; then
  echo "Rollback health check failed; recovery marker is preserved." >&2
  exit 1
fi

rm -f "$marker_path"
echo "Deployment ${deploy_sha} rolled back to ${previous_image_id}; recovery marker removed."
