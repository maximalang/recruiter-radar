#!/usr/bin/env bash
set -euo pipefail

# Orchestration tests for scripts/deploy/configure-telegram-runtime.sh with a
# mocked docker/curl/flock toolchain (no daemon required):
#   - credential-bundle preflight rejects bad bundles before any mutation;
#   - the candidate Compose config is validated BEFORE the live .env /
#     override are swapped (QA t_3ed42af0 F4);
#   - verification failures (digest mismatch, auth failure, port boundary,
#     health) restore the previous live state byte-for-byte and recreate the
#     stack from the restored configuration;
#   - a pre-swap failure leaves the live Compose configuration untouched and
#     does not recreate containers;
#   - the credential bundle and rollback backups are destroyed; secret values
#     never appear in script output;
#   - an existing COMPOSE_FILE chain is preserved and extended in place.
# Real-container behavior (non-root web, env_file-only injection, in-container
# digest) is covered by configure-telegram-runtime-prodshape.sh.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
configurator="$repo_root/scripts/deploy/configure-telegram-runtime.sh"
temporary_dir="$(mktemp -d)"
app_dir="$temporary_dir/app"
mock_bin="$temporary_dir/bin"
docker_log="$temporary_dir/docker.log"
stdout_file="$temporary_dir/stdout.log"
stderr_file="$temporary_dir/stderr.log"

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

mkdir -p "$app_dir" "$mock_bin"
printf 'services:\n  web:\n    image: recruiter-radar:latest\n' > "$app_dir/docker-compose.yml"

# NTFS/git-bash does not enforce POSIX modes; probe once so the 0600
# assertion is only enforced where chmod actually sticks (Linux CI/WSL).
chmod_probe="$temporary_dir/chmod-probe"
: > "$chmod_probe"
chmod 600 "$chmod_probe" 2>/dev/null || true
chmod_enforced=false
probe_perms="$(stat -c '%a' "$chmod_probe" 2>/dev/null || stat -f '%Lp' "$chmod_probe" 2>/dev/null || echo unknown)"
if [ "$probe_perms" = "600" ]; then
  chmod_enforced=true
fi

cat > "$mock_bin/docker" <<'DOCKER_EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"
case " $* " in
  *" exec -T web sh -c "*)
    if [ -n "${MOCK_CONTAINER_SHA:-}" ]; then
      printf '%s  -\n' "$MOCK_CONTAINER_SHA"
    else
      sha256sum "$RR_APP_DIR/config/tg-runtime/.env"
    fi
    ;;
  *" exec -T web node "*)
    if [ "${MOCK_TELEGRAM_AUTHORIZED:-true}" = "false" ]; then
      echo 'Error: Telegram session is not authorized.' >&2
      exit 1
    fi
    printf '{"telegramAuthorized":true}\n'
    ;;
  *" port web 3000 "*)
    printf '%s\n' "${MOCK_PUBLISHED_PORT:-127.0.0.1:3000}"
    ;;
  *" up -d --force-recreate web "*)
    if [ "${MOCK_COMPOSE_UP_FAIL:-false}" = "true" ]; then
      exit 32
    fi
    ;;
  *" config "*)
    if [ "${MOCK_COMPOSE_CONFIG_FAIL:-false}" = "true" ]; then
      exit 31
    fi
    ;;
esac
DOCKER_EOF
chmod +x "$mock_bin/docker"

cat > "$mock_bin/flock" <<'FLOCK_EOF'
#!/usr/bin/env bash
exit 0
FLOCK_EOF
chmod +x "$mock_bin/flock"

cat > "$mock_bin/curl" <<'CURL_EOF'
#!/usr/bin/env bash
# Counter-based health mock: fail the first MOCK_HEALTH_FAIL_TIMES calls,
# then succeed - lets a scenario fail verification while still allowing the
# rollback's own health wait to pass.
if [ -n "${MOCK_HEALTH_FAIL_TIMES:-}" ]; then
  count_file="${MOCK_CURL_COUNT_FILE:-/tmp/rr-mock-curl-count}"
  n="$(cat "$count_file" 2>/dev/null || echo 0)"
  n=$((n + 1))
  printf '%s' "$n" > "$count_file"
  if [ "$n" -le "$MOCK_HEALTH_FAIL_TIMES" ]; then
    exit 22
  fi
fi
exit 0
CURL_EOF
chmod +x "$mock_bin/curl"

make_bundle() { # $1=api_id $2=api_hash $3=session -> echoes bundle path
  local bundle_path="$temporary_dir/bundle-$RANDOM.b64"
  {
    printf 'TELEGRAM_API_ID=%s\n' "$1"
    printf 'TELEGRAM_API_HASH=%s\n' "$2"
    printf 'TELEGRAM_SESSION=%s\n' "$3"
  } | base64 -w0 > "$bundle_path"
  printf '%s' "$bundle_path"
}

run_configurator() { # env overrides may precede; captures stdout/stderr/status
  set +e
  env \
    PATH="$mock_bin:$PATH" \
    MOCK_DOCKER_LOG="$docker_log" \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_LOCK="$temporary_dir/deployment.lock" \
    RR_TELEGRAM_HEALTH_URL="http://127.0.0.1:1/api/health" \
    RR_TELEGRAM_HEALTH_RETRIES=3 \
    RR_TELEGRAM_HEALTH_INTERVAL_SECONDS=0 \
    "$@" \
    bash "$configurator" --key-file "$bundle_path" \
    > "$stdout_file" 2> "$stderr_file"
  run_status=$?
  set -e
  return 0
}

reset_logs() {
  : > "$docker_log"
  : > "$stdout_file"
  : > "$stderr_file"
}

log_line_of() { # $1=grep pattern -> first matching line number in docker log
  grep -nE "$1" "$docker_log" | head -1 | cut -d: -f1
}

log_count_of() { # $1=grep pattern
  grep -cE "$1" "$docker_log" || true
}

file_sha() {
  sha256sum "$1" | awk '{print $1}'
}

assert_no_rollback_residue() {
  # Temporary candidates carry a 6-char mktemp suffix; the final override is
  # .rr-telegram.compose.yml and must survive, so match suffix length exactly.
  local leftovers
  leftovers="$(find "$app_dir" -maxdepth 1 \( -name '.rr-telegram-rollback.*' -o -name '.rr-telegram.env.*' -o -name '.rr-telegram.runtime.*' -o -name '.rr-telegram.compose.??????' \) | wc -l)"
  if [ "$leftovers" -ne 0 ]; then
    echo "Temporary/rollback residue left in $app_dir:" >&2
    find "$app_dir" -maxdepth 1 >&2
    exit 1
  fi
}

valid_id="1234567"
valid_hash="0123456789abcdef0123456789abcdef"
session_one="BQECAtKx1wAAES7n0FhHb29ya2VuX3Nlc3Npb24tc3RyaW5nLW9uZQ=="
session_two="BQECAtKx1wAAES7n0FhHb29ya2VuX3Nlc3Npb24tc3RyaW5nLXR3bw=="

# --- S1: invalid bundles are rejected before any mutation --------------------
printf 'x\n' > "$app_dir/.env"
snapshot_env_sha="$(file_sha "$app_dir/.env")"
reset_logs
bundle_path="$(make_bundle "$valid_id" "TOO-SHORT" "$session_one")"
run_configurator
test "$run_status" -ne 0
grep -q 'TELEGRAM_API_HASH must be 32 lowercase hex' "$stderr_file"
test ! -s "$docker_log"
test ! -f "$bundle_path" # EXIT trap destroys the credential bundle on every failure path
assert_no_rollback_residue
test "$(file_sha "$app_dir/.env")" = "$snapshot_env_sha"

reset_logs
bundle_path="$(make_bundle "$valid_id" "$valid_hash" "has space in session")"
run_configurator
test "$run_status" -ne 0
grep -q 'outside the expected single-line base64' "$stderr_file"
test ! -s "$docker_log"
assert_no_rollback_residue
rm -f "$app_dir/.env"

# --- S2: first-install success path ------------------------------------------
printf 'PUBLIC_APP_ORIGIN=https://recruiter-radar.ru\n' > "$app_dir/.env"
reset_logs
bundle_path="$(make_bundle "$valid_id" "$valid_hash" "$session_one")"
run_configurator
test "$run_status" -eq 0
grep -q '"telegramRuntimeConfigured":true' "$stdout_file"
# credential bundle destroyed by the configurator
test ! -f "$bundle_path"
# secret value never appears in script output
if grep -qF "$session_one" "$stdout_file" "$stderr_file"; then
  echo "Session secret leaked into configurator output" >&2
  exit 1
fi
# runtime env landed with mode 600 (where the filesystem enforces modes) and
# canonical content
test -f "$app_dir/config/tg-runtime/.env"
if [ "$chmod_enforced" = true ]; then
  perms="$(stat -c '%a' "$app_dir/config/tg-runtime/.env" 2>/dev/null || stat -f '%Lp' "$app_dir/config/tg-runtime/.env")"
  test "$perms" = "600"
fi
grep -q "^TELEGRAM_SESSION=$session_one$" "$app_dir/config/tg-runtime/.env"
# .env gained the telegram override at the END of the chain
grep -q '^COMPOSE_FILE=docker-compose.yml:.rr-telegram.compose.yml$' "$app_dir/.env"
grep -q '^PUBLIC_APP_ORIGIN=https://recruiter-radar.ru$' "$app_dir/.env"
test -f "$app_dir/.rr-telegram.compose.yml"
assert_no_rollback_residue
# ordering: candidate config preflight (tmp files) -> applied config -> up -> port -> digest -> node auth
preflight_line="$(log_line_of '^compose --env-file .*\.rr-telegram\.env\..* config$')"
applied_config_line="$(log_line_of '^compose --env-file .*\.env .* config$')"
up_line="$(log_line_of ' up -d --force-recreate web$')"
port_line="$(log_line_of ' port web 3000$')"
digest_line="$(log_line_of ' exec -T web sh -c ')"
auth_line="$(log_line_of ' exec -T web node ')"
test -n "$preflight_line"
test "$preflight_line" -lt "$applied_config_line"
test "$applied_config_line" -lt "$up_line"
test "$up_line" -lt "$port_line"
test "$port_line" -lt "$digest_line"
test "$digest_line" -lt "$auth_line"
test "$(log_count_of ' up -d --force-recreate web$')" -eq 1

# --- S3: digest mismatch triggers rollback of an applied configuration -------
snapshot_env_sha="$(file_sha "$app_dir/.env")"
snapshot_override_sha="$(file_sha "$app_dir/.rr-telegram.compose.yml")"
snapshot_runtime_sha="$(file_sha "$app_dir/config/tg-runtime/.env")"
reset_logs
bundle_path="$(make_bundle "$valid_id" "$valid_hash" "$session_two")"
run_configurator MOCK_CONTAINER_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef
test "$run_status" -ne 0
grep -q 'digest mismatch' "$stderr_file"
grep -q 'restoring previous production state' "$stderr_file"
# live state restored byte-for-byte to the post-S2 snapshot
test "$(file_sha "$app_dir/.env")" = "$snapshot_env_sha"
test "$(file_sha "$app_dir/.rr-telegram.compose.yml")" = "$snapshot_override_sha"
test "$(file_sha "$app_dir/config/tg-runtime/.env")" = "$snapshot_runtime_sha"
# the rejected new session is gone from every file under the app dir
if grep -rqF "$session_two" "$app_dir"; then
  echo "Rejected session value persisted after rollback" >&2
  exit 1
fi
# rollback recreated the stack from the restored configuration
test "$(log_count_of ' up -d --force-recreate web$')" -eq 2
rollback_up_line="$(grep -nE ' up -d --force-recreate web$' "$docker_log" | tail -1 | cut -d: -f1)"
digest_fail_line="$(log_line_of ' exec -T web sh -c ')"
test "$digest_fail_line" -lt "$rollback_up_line"
assert_no_rollback_residue

# --- S4: live authorization failure triggers rollback ------------------------
reset_logs
bundle_path="$(make_bundle "$valid_id" "$valid_hash" "$session_two")"
run_configurator MOCK_TELEGRAM_AUTHORIZED=false
test "$run_status" -ne 0
grep -q 'live Telegram authorization check failed' "$stderr_file"
test "$(file_sha "$app_dir/config/tg-runtime/.env")" = "$snapshot_runtime_sha"
test "$(file_sha "$app_dir/.env")" = "$snapshot_env_sha"
if grep -rqF "$session_two" "$app_dir"; then
  echo "Rejected session value persisted after auth-failure rollback" >&2
  exit 1
fi
test "$(log_count_of ' up -d --force-recreate web$')" -eq 2
assert_no_rollback_residue

# --- S5: candidate preflight failure never touches the live configuration ----
reset_logs
bundle_path="$(make_bundle "$valid_id" "$valid_hash" "$session_two")"
run_configurator MOCK_COMPOSE_CONFIG_FAIL=true
test "$run_status" -ne 0
grep -q 'candidate Compose config preflight failed' "$stderr_file"
# no recreate at all: neither apply nor rollback (APPLIED gate)
test "$(log_count_of ' up -d --force-recreate web')" -eq 0
test "$(file_sha "$app_dir/.env")" = "$snapshot_env_sha"
test "$(file_sha "$app_dir/.rr-telegram.compose.yml")" = "$snapshot_override_sha"
test "$(file_sha "$app_dir/config/tg-runtime/.env")" = "$snapshot_runtime_sha"
assert_no_rollback_residue

# --- S6: port-boundary violation triggers rollback ---------------------------
reset_logs
bundle_path="$(make_bundle "$valid_id" "$valid_hash" "$session_two")"
run_configurator MOCK_PUBLISHED_PORT=0.0.0.0:3000
test "$run_status" -ne 0
grep -q 'port check reported' "$stderr_file"
test "$(file_sha "$app_dir/config/tg-runtime/.env")" = "$snapshot_runtime_sha"
test "$(log_count_of ' up -d --force-recreate web$')" -eq 2
assert_no_rollback_residue

# --- S7: health failure triggers rollback ------------------------------------
reset_logs
printf '0' > "$temporary_dir/curlcount"
bundle_path="$(make_bundle "$valid_id" "$valid_hash" "$session_two")"
run_configurator MOCK_HEALTH_FAIL_TIMES=3 MOCK_CURL_COUNT_FILE="$temporary_dir/curlcount"
test "$run_status" -ne 0
grep -q 'health endpoint did not recover' "$stderr_file"
grep -q 'Rollback completed; previous configuration is live again' "$stderr_file"
test "$(file_sha "$app_dir/config/tg-runtime/.env")" = "$snapshot_runtime_sha"
assert_no_rollback_residue

# --- S8: an existing COMPOSE_FILE chain is preserved and extended ------------
printf 'PUBLIC_APP_ORIGIN=https://recruiter-radar.ru\nCOMPOSE_FILE=docker-compose.yml:custom.override.yml\n' > "$app_dir/.env"
printf 'services:\n  web:\n    labels:\n      custom: "true"\n' > "$app_dir/custom.override.yml"
rm -f "$app_dir/.rr-telegram.compose.yml" "$app_dir/config/tg-runtime/.env"
reset_logs
bundle_path="$(make_bundle "$valid_id" "$valid_hash" "$session_one")"
run_configurator
test "$run_status" -eq 0
grep -q '^COMPOSE_FILE=docker-compose.yml:custom.override.yml:.rr-telegram.compose.yml$' "$app_dir/.env"
preflight_args_line="$(grep -E ' config$' "$docker_log" | head -1)"
printf '%s' "$preflight_args_line" | grep -q -- "-f $app_dir/custom.override.yml"
printf '%s' "$preflight_args_line" | grep -qE -- "-f $app_dir/\.rr-telegram\.compose\.[A-Za-z0-9]+ "
assert_no_rollback_residue

# --- S9: rerun over an active telegram chain is idempotent (no duplicate) ----
reset_logs
bundle_path="$(make_bundle "$valid_id" "$valid_hash" "$session_two")"
run_configurator
test "$run_status" -eq 0
grep -q '^COMPOSE_FILE=docker-compose.yml:custom.override.yml:.rr-telegram.compose.yml$' "$app_dir/.env"
grep -q "^TELEGRAM_SESSION=$session_two$" "$app_dir/config/tg-runtime/.env"
assert_no_rollback_residue

echo "configure-telegram-runtime orchestration tests passed."
