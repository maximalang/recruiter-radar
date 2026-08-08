#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$repo_root/scripts/deploy/run-commercial-signal-production-canary.sh"
temporary_dir="$(mktemp -d)"
app_dir="$temporary_dir/app"
mock_bin="$temporary_dir/bin"
container_root="$temporary_dir/container"
action_log="$temporary_dir/actions.log"
expected_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

mkdir -p "$app_dir" "$mock_bin" "$container_root"
cat > "$app_dir/configure-notification-encryption.sh" <<'CONFIG_EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'configurator:%s\n' "$*" >> "$MOCK_ACTION_LOG"
CONFIG_EOF
chmod +x "$app_dir/configure-notification-encryption.sh"

cat > "$mock_bin/docker" <<'DOCKER_EOF'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  compose)
    case "${2:-}" in
      ps)
        printf 'mock-web-container\n'
        ;;
      exec)
        output=''
        previous=''
        for argument in "$@"; do
          if [ "$previous" = --output ]; then
            output="$argument"
            break
          fi
          previous="$argument"
        done
        if [ -z "$output" ]; then
          echo 'Mock runner did not receive --output.' >&2
          exit 71
        fi
        printf 'runner:start\n' >> "$MOCK_ACTION_LOG"
        sleep "${MOCK_RUNNER_DELAY:-1}"
        printf '{"completed":%s}\n' "${MOCK_RECEIPT_COMPLETED:-true}" \
          > "$MOCK_CONTAINER_ROOT/$(basename "$output")"
        printf 'runner:finish:%s\n' "${MOCK_RUNNER_STATUS:-0}" >> "$MOCK_ACTION_LOG"
        exit "${MOCK_RUNNER_STATUS:-0}"
        ;;
      *) exit 72 ;;
    esac
    ;;
  inspect)
    case "$*" in
      *Health.Status*) printf 'healthy\n' ;;
      *) printf 'sha256:expected-image\n' ;;
    esac
    ;;
  image)
    printf 'sha256:expected-image\n'
    ;;
  exec)
    receipt_path="${5:-}"
    test -f "$MOCK_CONTAINER_ROOT/$(basename "$receipt_path")"
    ;;
  cp)
    source_path="${2#*:}"
    destination="$3"
    cp "$MOCK_CONTAINER_ROOT/$(basename "$source_path")" "$destination"
    printf 'receipt:copied\n' >> "$MOCK_ACTION_LOG"
    ;;
  *)
    echo "Unexpected mock docker call: $*" >&2
    exit 73
    ;;
esac
DOCKER_EOF
chmod +x "$mock_bin/docker"

write_dark_environment() {
  cat > "$app_dir/.env" <<'ENV_EOF'
PUBLIC_APP_ORIGIN=https://recruiter-radar.ru
SENTINEL=preserve-exactly
ENV_EOF
}

run_host() {
  local run_id="$1"
  shift
  PATH="$mock_bin:$PATH" \
    MOCK_ACTION_LOG="$action_log" \
    MOCK_CONTAINER_ROOT="$container_root" \
    MOCK_RUNNER_DELAY="${MOCK_RUNNER_DELAY:-1}" \
    MOCK_RUNNER_STATUS="${MOCK_RUNNER_STATUS:-0}" \
    MOCK_RECEIPT_COMPLETED="${MOCK_RECEIPT_COMPLETED:-true}" \
    RR_APP_DIR="$app_dir" \
    RR_CANARY_EXPECTED_SHA="$expected_sha" \
    RR_CANARY_WORKSPACE_ID=1 \
    RR_CANARY_RUN_ID="$run_id" \
    RR_CANARY_CONFIRMATION=RUN_ONE_WORKSPACE_CANARY \
    RR_CANARY_HEARTBEAT_SECONDS=5 \
    "$@" bash "$runner"
}

write_dark_environment
cp "$app_dir/.env" "$temporary_dir/original.env"
: > "$action_log"
success_output="$temporary_dir/success.output"
MOCK_RUNNER_DELAY=1 run_host success-run env > "$success_output"
grep -q '^canary_runner=active$' "$success_output"
grep -q '^receipt_archived=true$' "$success_output"
grep -q '^rollback_dark=true$' "$success_output"
cmp "$temporary_dir/original.env" "$app_dir/.env"
test -f "$app_dir/canary-evidence/success-run.json"
test "$(stat -c '%a' "$app_dir/canary-evidence")" = 700
test "$(stat -c '%a' "$app_dir/canary-evidence/success-run.json")" = 600
copy_line="$(grep -n '^receipt:copied$' "$action_log" | tail -n 1 | cut -d: -f1)"
restore_line="$(grep -n '^configurator:$' "$action_log" | tail -n 1 | cut -d: -f1)"
test "$copy_line" -lt "$restore_line"

write_dark_environment
: > "$action_log"
failed_output="$temporary_dir/failed.output"
set +e
MOCK_RUNNER_DELAY=1 MOCK_RUNNER_STATUS=2 MOCK_RECEIPT_COMPLETED=false \
  run_host failed-run env > "$failed_output"
failed_status=$?
set -e
test "$failed_status" = 2
grep -q '^canary_runner_exit=2$' "$failed_output"
grep -q '^receipt_archived=true$' "$failed_output"
grep -q '^rollback_dark=true$' "$failed_output"
cmp "$temporary_dir/original.env" "$app_dir/.env"
test -f "$app_dir/canary-evidence/failed-run.json"

write_dark_environment
: > "$action_log"
signal_output="$temporary_dir/signal.output"
PATH="$mock_bin:$PATH" \
  MOCK_ACTION_LOG="$action_log" \
  MOCK_CONTAINER_ROOT="$container_root" \
  MOCK_RUNNER_DELAY=3 \
  RR_APP_DIR="$app_dir" \
  RR_CANARY_EXPECTED_SHA="$expected_sha" \
  RR_CANARY_WORKSPACE_ID=1 \
  RR_CANARY_RUN_ID=signal-run \
  RR_CANARY_CONFIRMATION=RUN_ONE_WORKSPACE_CANARY \
  RR_CANARY_HEARTBEAT_SECONDS=5 \
  bash "$runner" > "$signal_output" 2>&1 &
host_pid=$!
sleep 1
kill -HUP "$host_pid"
wait "$host_pid"
grep -q '^operator_signal=HUP; canary continues under the deployment lock$' "$signal_output"
grep -q '^receipt_archived=true$' "$signal_output"
grep -q '^rollback_dark=true$' "$signal_output"
cmp "$temporary_dir/original.env" "$app_dir/.env"

write_dark_environment
: > "$action_log"
lock_output="$temporary_dir/lock.output"
exec 8> /tmp/recruiter-radar-deployment.lock
flock -n 8
set +e
run_host lock-refusal-run env > "$lock_output" 2>&1
lock_status=$?
set -e
flock -u 8
exec 8>&-
test "$lock_status" = 1
grep -q 'Another production mutation is active' "$lock_output"
cmp "$temporary_dir/original.env" "$app_dir/.env"
test ! -e "$app_dir/canary-evidence/lock-refusal-run.runner.log"
test ! -s "$action_log"

write_dark_environment
: > "$action_log"
MOCK_RUNNER_DELAY=1 run_host closed-output-run env | head -n 1 >/dev/null
test -f "$app_dir/canary-evidence/closed-output-run.json"
cmp "$temporary_dir/original.env" "$app_dir/.env"

printf 'Commercial Signal canary host runner tests passed.\n'
