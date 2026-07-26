#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
guard_script="$repo_root/scripts/deploy/rollback-guard.sh"
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

run_after_switch_failure
run_before_switch_failure

printf '%s\n' \
  '{"ok":true,"rollbackCount":1,"postSwitchExitCode":42,"preSwitchRollbackCount":0}'
