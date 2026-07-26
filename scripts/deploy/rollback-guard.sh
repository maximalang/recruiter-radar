#!/usr/bin/env bash

deployment_switched=false
rollback_in_progress=false

rollback_guard_clear_traps() {
  trap - ERR INT TERM HUP
}

rollback_guard_handle_failure() {
  local exit_code="$1"
  local failure_reason="$2"

  rollback_guard_clear_traps
  if [ "$deployment_switched" = "true" ] &&
    [ "$rollback_in_progress" != "true" ]; then
    deployment_switched=false
    rollback_in_progress=true
    echo "Deployment interrupted by ${failure_reason}. Starting rollback." >&2
    rollback || true
  fi

  exit "$exit_code"
}

rollback_on_error() {
  local exit_code=$?
  rollback_guard_handle_failure "$exit_code" "an error"
}

rollback_on_int() {
  rollback_guard_handle_failure 130 "SIGINT"
}

rollback_on_term() {
  rollback_guard_handle_failure 143 "SIGTERM"
}

rollback_on_hup() {
  rollback_guard_handle_failure 129 "SIGHUP"
}

rollback_guard_arm() {
  deployment_switched=true
  rollback_in_progress=false
  trap rollback_on_error ERR
  trap rollback_on_int INT
  trap rollback_on_term TERM
  trap rollback_on_hup HUP
}

rollback_guard_disarm() {
  deployment_switched=false
  rollback_guard_clear_traps
}

rollback_guard_write_marker() {
  local marker_path="$1"
  local deploy_sha="$2"
  local previous_image_id="$3"
  local marker_directory
  local marker_tmp

  if [ -e "$marker_path" ] || [ -L "$marker_path" ]; then
    echo "An unresolved deployment marker already exists; refusing to overwrite recovery state." >&2
    return 1
  fi
  if ! printf '%s' "$deploy_sha" | grep -Eq '^[0-9a-f]{7,64}$'; then
    echo "Deploy SHA is invalid; refusing to create the deployment marker." >&2
    return 1
  fi
  if ! printf '%s' "$previous_image_id" |
    grep -Eq '^sha256:[0-9a-f]{64}$'; then
    echo "Previous image ID is invalid; refusing to create the deployment marker." >&2
    return 1
  fi

  marker_directory="$(dirname "$marker_path")"
  marker_tmp="$(mktemp "$marker_directory/.deployment-switched.XXXXXX")"
  umask 077
  if ! {
    printf 'deploy_sha=%s\n' "$deploy_sha"
    printf 'previous_image_id=%s\n' "$previous_image_id"
    printf 'created_at=%s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  } > "$marker_tmp"; then
    rm -f "$marker_tmp"
    return 1
  fi
  chmod 600 "$marker_tmp"
  if ! mv "$marker_tmp" "$marker_path"; then
    rm -f "$marker_tmp"
    return 1
  fi
}

rollback_guard_finalize() {
  local marker_path="$1"
  local expected_deploy_sha="$2"
  local marker_deploy_sha

  if [ ! -f "$marker_path" ]; then
    echo "Deployment marker is missing; refusing to finalize an untracked deployment." >&2
    return 1
  fi

  marker_deploy_sha="$(
    sed -n 's/^deploy_sha=//p' "$marker_path"
  )"
  if [ "$marker_deploy_sha" != "$expected_deploy_sha" ]; then
    echo "Deployment marker SHA does not match the verified deployment." >&2
    return 1
  fi

  rm -f "$marker_path"
  echo "Deployment ${expected_deploy_sha} finalized; recovery marker removed."
}
