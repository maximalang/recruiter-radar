#!/usr/bin/env bash

deployment_switched=false

rollback_on_error() {
  local exit_code=$?

  trap - ERR
  if [ "$deployment_switched" = "true" ]; then
    deployment_switched=false
    echo "Deployment failed after production switch. Starting rollback." >&2
    rollback || true
  fi

  exit "$exit_code"
}

rollback_guard_arm() {
  deployment_switched=true
  trap rollback_on_error ERR
}

rollback_guard_disarm() {
  deployment_switched=false
  trap - ERR
}
