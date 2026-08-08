#!/usr/bin/env bash
set -Eeuo pipefail

app_dir="${RR_APP_DIR:-/opt/recruiter-radar}"
environment_file="$app_dir/.env"
configurator="$app_dir/configure-notification-encryption.sh"
deployment_marker="$app_dir/.deployment-switched"
deployment_lock=/tmp/recruiter-radar-deployment.lock
expected_sha="${RR_CANARY_EXPECTED_SHA:-}"
workspace_id="${RR_CANARY_WORKSPACE_ID:-}"
confirmation="${RR_CANARY_CONFIRMATION:-}"
heartbeat_seconds="${RR_CANARY_HEARTBEAT_SECONDS:-30}"
run_id="${RR_CANARY_RUN_ID:-canary-locked-$(date -u +%Y%m%dT%H%M%SZ)}"
runtime_flag_pattern='^(COMMERCIAL_SIGNAL_.*|COMPANY_EVENTS_V1_ENABLED|COMPANY_STATE_V1_ENABLED|SIGNAL_EPISODES_V2_ENABLED|COMMERCIAL_THESIS_V1_ENABLED|EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED|AGENCY_DNA_MATCH_V2_ENABLED|OPPORTUNITY_SCORING_V3_ENABLED|QUERY_PLANNER_V2_ENABLED)='

if [ "$#" -ne 0 ]; then
  echo 'Configure the canary with RR_CANARY_* environment variables; arguments are not accepted.' >&2
  exit 2
fi
if ! [[ "$expected_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'RR_CANARY_EXPECTED_SHA must be the exact lowercase production commit SHA.' >&2
  exit 2
fi
if ! [[ "$workspace_id" =~ ^[1-9][0-9]{0,18}$ ]]; then
  echo 'RR_CANARY_WORKSPACE_ID must contain one positive workspace id.' >&2
  exit 2
fi
if [ "$confirmation" != RUN_ONE_WORKSPACE_CANARY ]; then
  echo 'RR_CANARY_CONFIRMATION must equal RUN_ONE_WORKSPACE_CANARY.' >&2
  exit 2
fi
if ! [[ "$heartbeat_seconds" =~ ^[0-9]+$ ]] ||
   [ "$heartbeat_seconds" -lt 5 ] || [ "$heartbeat_seconds" -gt 300 ]; then
  echo 'RR_CANARY_HEARTBEAT_SECONDS must be between 5 and 300.' >&2
  exit 2
fi
if ! [[ "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$ ]]; then
  echo 'RR_CANARY_RUN_ID is invalid.' >&2
  exit 2
fi
if [ ! -f "$environment_file" ] || [ ! -x "$configurator" ]; then
  echo 'Production environment or runtime configurator is unavailable.' >&2
  exit 1
fi

cd "$app_dir"
umask 077

evidence_dir="$app_dir/canary-evidence"
receipt_container="/tmp/$run_id.json"
receipt_host="$evidence_dir/$run_id.json"
runner_log="$evidence_dir/$run_id.runner.log"
config_log="$evidence_dir/$run_id.config.log"
environment_backup="$app_dir/.env.$run_id.backup"
temporary_environment=''
backup_ready=false
receipt_archived=false
rollback_dark=false
operator_signal=''
runner_pid=''

emit_status() {
  printf '%s\n' "$1" 2>/dev/null || true
}

wait_for_web_health() {
  local attempt container health
  for attempt in $(seq 1 90); do
    container="$(docker compose ps -q web 2>/dev/null || true)"
    if [ -n "$container" ]; then
      health="$(
        docker inspect --format '{{.State.Health.Status}}' "$container" \
          2>/dev/null || true
      )"
      if [ "$health" = healthy ]; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

archive_receipt_if_present() {
  local container temporary_receipt
  if [ "$receipt_archived" = true ]; then
    return 0
  fi
  container="$(docker compose ps -q web 2>/dev/null || true)"
  if [ -z "$container" ] ||
     ! docker exec "$container" test -f "$receipt_container"; then
    return 0
  fi
  if [ -e "$receipt_host" ] || [ -L "$receipt_host" ]; then
    echo 'Canary receipt archive collision; refusing to overwrite evidence.' >&2
    return 1
  fi
  temporary_receipt="$receipt_host.partial.$$"
  rm -f -- "$temporary_receipt"
  if ! docker cp "$container:$receipt_container" "$temporary_receipt" >/dev/null; then
    rm -f -- "$temporary_receipt"
    return 1
  fi
  chmod 600 "$temporary_receipt"
  if ! ln "$temporary_receipt" "$receipt_host"; then
    rm -f -- "$temporary_receipt"
    return 1
  fi
  rm -f -- "$temporary_receipt"
  receipt_archived=true
  emit_status 'receipt_archived=true'
}

restore_original_environment() {
  local dark_flag_count container running_image_id expected_image_id
  if [ "$backup_ready" != true ]; then
    return 0
  fi
  if ! cp -p -- "$environment_backup" "$environment_file"; then
    return 1
  fi
  if ! "$configurator" --preflight </dev/null >>"$config_log" 2>&1; then
    return 1
  fi
  if ! "$configurator" </dev/null >>"$config_log" 2>&1; then
    return 1
  fi
  if ! wait_for_web_health; then
    return 1
  fi
  dark_flag_count="$(grep -Ec "$runtime_flag_pattern" "$environment_file" || true)"
  container="$(docker compose ps -q web 2>/dev/null || true)"
  running_image_id="$(
    docker inspect --format '{{.Image}}' "$container" 2>/dev/null || true
  )"
  expected_image_id="$(
    docker image inspect "recruiter-radar:$expected_sha" \
      --format '{{.Id}}' 2>/dev/null || true
  )"
  if [ "$dark_flag_count" != 0 ] || [ -z "$expected_image_id" ] ||
     [ "$running_image_id" != "$expected_image_id" ] ||
     ! cmp -s -- "$environment_backup" "$environment_file"; then
    return 1
  fi
  rollback_dark=true
  rm -f -- "$environment_backup"
  backup_ready=false
  emit_status 'rollback_dark=true'
}

restore_dark_runtime() {
  local original_status=$?
  local archive_status restore_status
  trap - EXIT HUP INT TERM
  set +e
  archive_receipt_if_present
  archive_status=$?
  restore_original_environment
  restore_status=$?
  if [ -n "$temporary_environment" ]; then
    rm -f -- "$temporary_environment"
  fi
  if [ "$archive_status" -ne 0 ] || [ "$restore_status" -ne 0 ]; then
    echo 'Canary cleanup failed closed; preserve the environment backup and recover manually.' >&2
    exit 90
  fi
  exit "$original_status"
}

note_operator_signal() {
  operator_signal="$1"
  emit_status "operator_signal=$1; canary continues under the deployment lock"
}

trap restore_dark_runtime EXIT
trap 'note_operator_signal HUP' HUP
trap 'note_operator_signal INT' INT
trap 'note_operator_signal TERM' TERM
trap '' PIPE

exec 9> "$deployment_lock"
if ! flock -n 9; then
  echo 'Another production mutation is active; refusing the canary.' >&2
  exit 1
fi
emit_status 'canary_lock=acquired'

if [ -e "$deployment_marker" ] || [ -L "$deployment_marker" ]; then
  echo 'Deployment recovery is pending; refusing the canary.' >&2
  exit 1
fi
if [ -e "$receipt_host" ] || [ -L "$receipt_host" ] ||
   [ -e "$runner_log" ] || [ -L "$runner_log" ]; then
  echo 'Canary evidence already exists for this run id.' >&2
  exit 1
fi
mkdir -p -- "$evidence_dir"
chmod 700 "$evidence_dir"
: > "$runner_log"
: > "$config_log"
chmod 600 "$runner_log" "$config_log"

current_container="$(docker compose ps -q web 2>/dev/null || true)"
current_health="$(
  docker inspect --format '{{.State.Health.Status}}' "$current_container" \
    2>/dev/null || true
)"
running_image_id="$(
  docker inspect --format '{{.Image}}' "$current_container" 2>/dev/null || true
)"
expected_image_id="$(
  docker image inspect "recruiter-radar:$expected_sha" --format '{{.Id}}' \
    2>/dev/null || true
)"
dark_flag_count="$(grep -Ec "$runtime_flag_pattern" "$environment_file" || true)"
if [ "$current_health" != healthy ] || [ -z "$expected_image_id" ] ||
   [ "$running_image_id" != "$expected_image_id" ] ||
   [ "$dark_flag_count" != 0 ]; then
  echo 'Production is not healthy, exact-SHA and dark; refusing the canary.' >&2
  exit 1
fi

cp -p -- "$environment_file" "$environment_backup"
chmod 600 "$environment_backup"
backup_ready=true

temporary_environment="$(mktemp "$app_dir/.env.canary.XXXXXX")"
awk -v pattern="$runtime_flag_pattern" '$0 !~ pattern' \
  "$environment_file" > "$temporary_environment"
printf '%s\n' \
  'COMMERCIAL_SIGNAL_RUNTIME_MODE=canary' \
  "COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS=$workspace_id" \
  'COMMERCIAL_SIGNAL_ALLOWED_QUERY_SOURCES=rabota-rossii' \
  'COMPANY_EVENTS_V1_ENABLED=true' \
  'COMPANY_STATE_V1_ENABLED=true' \
  'SIGNAL_EPISODES_V2_ENABLED=true' \
  'COMMERCIAL_THESIS_V1_ENABLED=true' \
  'EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED=true' \
  'AGENCY_DNA_MATCH_V2_ENABLED=true' \
  'OPPORTUNITY_SCORING_V3_ENABLED=true' \
  'QUERY_PLANNER_V2_ENABLED=true' >> "$temporary_environment"
chmod --reference="$environment_file" "$temporary_environment"
chown --reference="$environment_file" "$temporary_environment"
mv -- "$temporary_environment" "$environment_file"
temporary_environment=''

enabled_flag_count="$(grep -Ec "$runtime_flag_pattern" "$environment_file" || true)"
if [ "$enabled_flag_count" != 11 ]; then
  echo 'Canary runtime flag count is invalid.' >&2
  exit 1
fi
if ! "$configurator" --preflight </dev/null >>"$config_log" 2>&1; then
  echo 'Canary runtime configuration preflight failed.' >&2
  exit 1
fi
if ! "$configurator" </dev/null >>"$config_log" 2>&1; then
  echo 'Canary runtime configuration failed.' >&2
  exit 1
fi
if ! wait_for_web_health; then
  echo 'Canary web runtime did not become healthy.' >&2
  exit 1
fi

canary_container="$(docker compose ps -q web)"
canary_image_id="$(
  docker inspect --format '{{.Image}}' "$canary_container" 2>/dev/null || true
)"
if [ "$canary_image_id" != "$expected_image_id" ]; then
  echo 'Canary web runtime does not use the expected image.' >&2
  exit 1
fi
emit_status 'canary_runtime=enabled_exact_sha'

# The SSH operator may disappear while a source request is still running. Keep
# the Docker exec client alive; the parent handlers below merely record the
# signal and continue holding the mutation lock through receipt archival and
# rollback.
trap '' HUP INT TERM
nohup docker compose exec -T \
  -e COMMERCIAL_SIGNAL_CANARY_ALLOWED_HOST=recruiter-radar.ru \
  web node packages/db/scripts/run-commercial-signal-production-canary.mjs \
  --base-url https://recruiter-radar.ru \
  --workspace-id "$workspace_id" \
  --run-id "$run_id" \
  --output "$receipt_container" \
  --confirm RUN_ONE_WORKSPACE_CANARY \
  >"$runner_log" 2>&1 </dev/null &
runner_pid=$!
trap 'note_operator_signal HUP' HUP
trap 'note_operator_signal INT' INT
trap 'note_operator_signal TERM' TERM

while kill -0 "$runner_pid" 2>/dev/null; do
  emit_status 'canary_runner=active'
  sleep "$heartbeat_seconds" || true
done
if wait "$runner_pid"; then
  runner_status=0
else
  runner_status=$?
fi
runner_pid=''
emit_status "canary_runner_exit=$runner_status"

if ! archive_receipt_if_present; then
  exit 1
fi
if [ "$runner_status" -eq 0 ] && [ "$receipt_archived" != true ]; then
  echo 'Successful canary runner produced no receipt.' >&2
  exit 1
fi

exit "$runner_status"
