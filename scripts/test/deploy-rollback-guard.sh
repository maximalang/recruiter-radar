#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
guard_script="$repo_root/scripts/deploy/rollback-guard.sh"
recovery_script="$repo_root/scripts/deploy/recover-deployment.sh"
temporary_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

run_after_switch_failure() {
  local scenario="$temporary_dir/after-switch.sh"
  local command_log="$temporary_dir/after-switch.log"
  local rollback_log="$temporary_dir/after-switch.rollback"

  cat > "$scenario" <<'SCENARIO_EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

source "$GUARD_SCRIPT"

rollback() {
  printf 'rollback\n' >> "$ROLLBACK_LOG"
  return 73
}

switch_image() {
  printf 'switch-image\n' >> "$COMMAND_LOG"
}

configure_runtime() {
  printf 'docker compose up\n' >> "$COMMAND_LOG"
  return 42
}

switch_image
rollback_guard_arm
configure_runtime
printf 'unreachable\n' >> "$COMMAND_LOG"
SCENARIO_EOF
  chmod +x "$scenario"

  set +e
  GUARD_SCRIPT="$guard_script" \
    COMMAND_LOG="$command_log" \
    ROLLBACK_LOG="$rollback_log" \
    bash "$scenario"
  local status=$?
  set -e

  test "$status" = "42"
  test "$(grep -c '^rollback$' "$rollback_log")" = "1"
  test "$(sed -n '1p' "$command_log")" = "switch-image"
  test "$(sed -n '2p' "$command_log")" = "docker compose up"
  ! grep -q '^unreachable$' "$command_log"
}

run_before_switch_failure() {
  local scenario="$temporary_dir/before-switch.sh"
  local rollback_log="$temporary_dir/before-switch.rollback"

  cat > "$scenario" <<'SCENARIO_EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

source "$GUARD_SCRIPT"

rollback() {
  printf 'rollback\n' >> "$ROLLBACK_LOG"
}

exit 19
SCENARIO_EOF
  chmod +x "$scenario"

  set +e
  GUARD_SCRIPT="$guard_script" \
    ROLLBACK_LOG="$rollback_log" \
    bash "$scenario"
  local status=$?
  set -e

  test "$status" = "19"
  test ! -e "$rollback_log"
}

run_signal_failure() {
  local signal="$1"
  local expected_status="$2"
  local scenario="$temporary_dir/signal-$signal.sh"
  local rollback_log="$temporary_dir/signal-$signal.rollback"

  cat > "$scenario" <<'SCENARIO_EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

source "$GUARD_SCRIPT"

rollback() {
  printf 'rollback\n' >> "$ROLLBACK_LOG"
}

rollback_guard_arm
kill "-$TEST_SIGNAL" "$$"
printf 'unreachable\n' >> "$ROLLBACK_LOG"
SCENARIO_EOF
  chmod +x "$scenario"

  set +e
  GUARD_SCRIPT="$guard_script" \
    ROLLBACK_LOG="$rollback_log" \
    TEST_SIGNAL="$signal" \
    bash "$scenario"
  local status=$?
  set -e

  test "$status" = "$expected_status"
  test "$(grep -c '^rollback$' "$rollback_log")" = "1"
  ! grep -q '^unreachable$' "$rollback_log"
}

run_marker_lifecycle() {
  local marker="$temporary_dir/.deployment-switched"

  # shellcheck source=/dev/null
  source "$guard_script"
  rollback_guard_write_marker \
    "$marker" \
    "abcdef1234567890" \
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  grep -q '^deploy_sha=abcdef1234567890$' "$marker"
  grep -q '^previous_image_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$' "$marker"
  grep -q '^created_at=' "$marker"

  cp "$marker" "$marker.original"
  if rollback_guard_write_marker \
    "$marker" \
    "bbbbbbbbbbbbbbbb" \
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; then
    echo "Existing deployment marker was unexpectedly overwritten" >&2
    return 1
  fi
  cmp "$marker.original" "$marker"

  rollback_guard_finalize "$marker" "abcdef1234567890"
  test ! -e "$marker"
}

run_external_recovery() {
  local app_dir="$temporary_dir/recovery-app"
  local mock_bin="$temporary_dir/recovery-bin"
  local marker="$app_dir/.deployment-switched"
  local recovery_lock="$app_dir/.deployment-recovery.lock"
  local command_log="$temporary_dir/recovery.log"
  mkdir -p "$app_dir" "$mock_bin"

  cat > "$mock_bin/docker" <<'DOCKER_EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$RECOVERY_COMMAND_LOG"
if [ "$*" = "inspect --format {{.Image}} recruiter-radar-web-1" ] &&
  [ -n "${MOCK_RUNNING_IMAGE_ID:-}" ]; then
  printf '%s\n' "$MOCK_RUNNING_IMAGE_ID"
fi
DOCKER_EOF
  cat > "$mock_bin/curl" <<'CURL_EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >> "$RECOVERY_COMMAND_LOG"
if [ "${MOCK_HEALTH_FAIL:-false}" = "true" ]; then
  exit 7
fi
printf '{"ok":true}\n'
CURL_EOF
  cat > "$app_dir/configure-notification-encryption.sh" <<'CONFIG_EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'configure\n' >> "$RECOVERY_COMMAND_LOG"
if [ -n "${MOCK_CONFIGURE_DELAY:-}" ]; then
  sleep "$MOCK_CONFIGURE_DELAY"
fi
if [ "${MOCK_CONFIGURE_FAIL:-false}" = "true" ]; then
  exit 44
fi
CONFIG_EOF
  chmod +x \
    "$mock_bin/docker" \
    "$mock_bin/curl" \
    "$app_dir/configure-notification-encryption.sh"

  : > "$command_log"
  PATH="$mock_bin:$PATH" \
    RECOVERY_COMMAND_LOG="$command_log" \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_MARKER="$marker" \
    RR_RECOVERY_LOCK="$recovery_lock" \
    EXPECTED_DEPLOY_SHA="abcdef1234567890" \
    bash "$recovery_script"
  test ! -s "$command_log"

  cat > "$marker" <<'MARKER_EOF'
deploy_sha=abcdef1234567890
previous_image_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
created_at=2026-07-26T10:00:00Z
MARKER_EOF
  PATH="$mock_bin:$PATH" \
    RECOVERY_COMMAND_LOG="$command_log" \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_MARKER="$marker" \
    RR_RECOVERY_LOCK="$recovery_lock" \
    EXPECTED_DEPLOY_SHA="abcdef1234567890" \
    bash "$recovery_script"
  test ! -e "$marker"
  grep -q '^docker image inspect sha256:' "$command_log"
  grep -q '^docker tag sha256:.* recruiter-radar:latest$' "$command_log"
  grep -q '^configure$' "$command_log"
  grep -q '^curl ' "$command_log"

  local successful_log_size
  successful_log_size="$(wc -c < "$command_log")"
  PATH="$mock_bin:$PATH" \
    RECOVERY_COMMAND_LOG="$command_log" \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_MARKER="$marker" \
    RR_RECOVERY_LOCK="$recovery_lock" \
    EXPECTED_DEPLOY_SHA="abcdef1234567890" \
    bash "$recovery_script"
  test "$(wc -c < "$command_log")" = "$successful_log_size"

  : > "$command_log"
  cat > "$marker" <<'MARKER_EOF'
deploy_sha=abcdef1234567890
previous_image_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
created_at=2026-07-26T10:00:00Z
MARKER_EOF
  PATH="$mock_bin:$PATH" \
    RECOVERY_COMMAND_LOG="$command_log" \
    MOCK_CONFIGURE_DELAY=1 \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_MARKER="$marker" \
    RR_RECOVERY_LOCK="$recovery_lock" \
    EXPECTED_DEPLOY_SHA="abcdef1234567890" \
    bash "$recovery_script" &
  local first_recovery_pid=$!
  sleep 0.1
  PATH="$mock_bin:$PATH" \
    RECOVERY_COMMAND_LOG="$command_log" \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_MARKER="$marker" \
    RR_RECOVERY_LOCK="$recovery_lock" \
    EXPECTED_DEPLOY_SHA="abcdef1234567890" \
    bash "$recovery_script" &
  local second_recovery_pid=$!
  wait "$first_recovery_pid"
  wait "$second_recovery_pid"
  test ! -e "$marker"
  test "$(grep -c '^configure$' "$command_log")" = "1"
  test "$(grep -c '^docker tag .* recruiter-radar:latest$' "$command_log")" = "1"

  : > "$command_log"
  cat > "$marker" <<'MARKER_EOF'
deploy_sha=abcdef1234567890
previous_image_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
created_at=2026-07-26T10:00:00Z
MARKER_EOF
  set +e
  PATH="$mock_bin:$PATH" \
    RECOVERY_COMMAND_LOG="$command_log" \
    MOCK_HEALTH_FAIL=true \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_MARKER="$marker" \
    RR_RECOVERY_LOCK="$recovery_lock" \
    RR_RECOVERY_HEALTH_ATTEMPTS=1 \
    RR_RECOVERY_HEALTH_DELAY=0 \
    EXPECTED_DEPLOY_SHA="abcdef1234567890" \
    bash "$recovery_script"
  local unhealthy_status=$?
  set -e
  test "$unhealthy_status" = "1"
  test -f "$marker"
  test "$(grep -c '^configure$' "$command_log")" = "1"

  PATH="$mock_bin:$PATH" \
    RECOVERY_COMMAND_LOG="$command_log" \
    MOCK_RUNNING_IMAGE_ID="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_MARKER="$marker" \
    RR_RECOVERY_LOCK="$recovery_lock" \
    EXPECTED_DEPLOY_SHA="abcdef1234567890" \
    bash "$recovery_script"
  test ! -e "$marker"
  test "$(grep -c '^configure$' "$command_log")" = "1"

  cat > "$marker" <<'MARKER_EOF'
deploy_sha=abcdef1234567890
previous_image_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
created_at=2026-07-26T10:00:00Z
MARKER_EOF
  set +e
  PATH="$mock_bin:$PATH" \
    RECOVERY_COMMAND_LOG="$command_log" \
    MOCK_CONFIGURE_FAIL=true \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_MARKER="$marker" \
    RR_RECOVERY_LOCK="$recovery_lock" \
    EXPECTED_DEPLOY_SHA="abcdef1234567890" \
    bash "$recovery_script"
  local failure_status=$?
  set -e
  test "$failure_status" = "44"
  test -f "$marker"
}

run_after_switch_failure
run_before_switch_failure
run_signal_failure INT 130
run_signal_failure TERM 143
run_marker_lifecycle
run_external_recovery

printf '%s\n' \
  '{"ok":true,"rollbackCount":1,"signals":["INT","TERM"],"markerLifecycle":"verified","externalRecovery":"idempotent"}'
