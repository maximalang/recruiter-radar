#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
smoke_script="$repo_root/scripts/test/landing-events-caddy-smoke.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

LANDING_SMOKE_LIB_ONLY=true
# shellcheck source=landing-events-caddy-smoke.sh
source "$smoke_script"

pull_attempts=0
docker() {
  if [ "$1" = "pull" ]; then
    pull_attempts=$((pull_attempts + 1))
    [ "$pull_attempts" -ge 2 ]
    return
  fi
  fail "unexpected docker command in retry test: $*"
}
sleep() {
  :
}

retry_pull "postgres:16-alpine" 3 0 \
  || fail "pull retry should recover after the first failure"
[ "$pull_attempts" = "2" ] \
  || fail "pull retry used $pull_attempts attempts instead of 2"

pull_attempts=0
docker() {
  if [ "$1" = "pull" ]; then
    pull_attempts=$((pull_attempts + 1))
    return 1
  fi
  fail "unexpected docker command in exhausted retry test: $*"
}

if retry_pull "caddy:2-alpine" 3 0; then
  fail "pull retry unexpectedly succeeded after every pull failed"
fi
[ "$pull_attempts" = "3" ] \
  || fail "exhausted pull retry used $pull_attempts attempts instead of 3"

primary_failure_output="$(
  (
    dump_diagnostics_once() {
      printf 'diagnostics-ran\n'
    }
    cleanup() {
      printf 'cleanup-ran\n'
      return 19
    }
    trap finish EXIT
    false
  ) 2>&1
)" && primary_failure_status=0 || primary_failure_status=$?

[ "$primary_failure_status" = "1" ] \
  || fail "cleanup replaced primary exit status with $primary_failure_status"
printf '%s\n' "$primary_failure_output" | grep -q '^diagnostics-ran$' \
  || fail "primary failure did not trigger diagnostics"
printf '%s\n' "$primary_failure_output" | grep -q '^cleanup-ran$' \
  || fail "primary failure did not trigger cleanup"

stable_sequence=(0 1 0 1 1)
stable_index=0
eventually_stable() {
  local result="${stable_sequence[$stable_index]}"
  stable_index=$((stable_index + 1))
  [ "$result" = "1" ]
}

wait_for_consecutive_successes "restarting service" 5 2 0 eventually_stable \
  || fail "readiness should recover after two consecutive successes"
[ "$stable_index" = "5" ] \
  || fail "readiness did not reset after the transient success"

readiness_checks=0
readiness_diagnostics=0
never_ready() {
  readiness_checks=$((readiness_checks + 1))
  return 1
}
dump_diagnostics_once() {
  readiness_diagnostics=$((readiness_diagnostics + 1))
}

if wait_for_consecutive_successes "test service" 3 2 0 never_ready; then
  fail "readiness timeout unexpectedly succeeded"
fi
[ "$readiness_checks" = "3" ] \
  || fail "readiness timeout ran $readiness_checks checks instead of 3"
[ "$readiness_diagnostics" = "1" ] \
  || fail "readiness timeout emitted $readiness_diagnostics diagnostics instead of 1"

# Restore the real diagnostics implementation after the focused counter stub.
source "$smoke_script"
db_container="missing-db"
web_container="missing-web"
caddy_container="missing-caddy"
network="missing-network"
diagnostics_dumped=false
container_exists() {
  return 1
}
network_exists() {
  return 1
}
docker() {
  printf 'docker %s\n' "$*"
}
missing_diagnostics_output="$(dump_diagnostics_once 2>&1)" \
  || fail "missing resources broke diagnostics"
printf '%s\n' "$missing_diagnostics_output" | grep -q 'container=missing-db status=not-created' \
  || fail "missing container was not reported safely"

diagnostics_dumped=false
container_exists() {
  return 0
}
network_exists() {
  return 0
}
readiness_log_output="$(
  wait_for_consecutive_successes "logged service" 1 1 0 never_ready 2>&1
)" && readiness_log_status=0 || readiness_log_status=$?
[ "$readiness_log_status" = "1" ] \
  || fail "logged readiness timeout returned $readiness_log_status instead of 1"
printf '%s\n' "$readiness_log_output" | grep -q 'docker logs --tail 200 missing-web' \
  || fail "readiness timeout did not print web logs"

printf '%s\n' \
  '{"ok":true,"pullRetryAttempts":2,"pullFailureAttempts":3,"cleanupPreservedStatus":1,"stableReadinessChecks":5,"readinessChecks":3,"readinessDiagnostics":1,"missingResourcesSafe":true,"timeoutLogs":true}'
