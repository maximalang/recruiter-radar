#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
configurator="$repo_root/scripts/deploy/configure-notification-encryption.sh"
temporary_dir="$(mktemp -d)"
app_dir="$temporary_dir/app"
mock_bin="$temporary_dir/bin"
docker_log="$temporary_dir/docker.log"

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

mkdir -p "$app_dir" "$mock_bin"
printf 'services:\n  web:\n    image: recruiter-radar:latest\n' > "$app_dir/docker-compose.yml"

cat > "$mock_bin/docker" <<'DOCKER_EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"
case " $* " in
  *" config "*)
    if [ "${MOCK_COMPOSE_CONFIG_FAIL:-false}" = "true" ]; then
      exit 31
    fi
    ;;
  *" port web 3000 "*)
    printf '127.0.0.1:3000\n'
    ;;
esac
DOCKER_EOF
chmod +x "$mock_bin/docker"

write_env() {
  local salt="$1"
  local origin="$2"
  cat > "$app_dir/.env" <<ENV_EOF
NOTIFICATION_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
LANDING_ANALYTICS_RATE_LIMIT_SALT=$salt
PUBLIC_APP_ORIGIN=$origin
ENV_EOF
}

run_configurator() {
  PATH="$mock_bin:$PATH" \
    MOCK_DOCKER_LOG="$docker_log" \
    RR_APP_DIR="$app_dir" \
    bash "$configurator" "$@"
}

write_env "0123456789abcdef0123456789abcdef" "https://recruiter-radar.ru/"
: > "$docker_log"
run_configurator --preflight
grep -q ' config$' "$docker_log"
! grep -q ' up ' "$docker_log"
grep -q '^PUBLIC_APP_ORIGIN=https://recruiter-radar.ru/$' "$app_dir/.env"

: > "$docker_log"
run_configurator
grep -q '^PUBLIC_APP_ORIGIN=https://recruiter-radar.ru$' "$app_dir/.env"
config_line="$(grep -n ' config$' "$docker_log" | cut -d: -f1)"
up_line="$(grep -n ' up -d --force-recreate web$' "$docker_log" | cut -d: -f1)"
port_line="$(grep -n ' port web 3000$' "$docker_log" | cut -d: -f1)"
test "$config_line" -lt "$up_line"
test "$up_line" -lt "$port_line"

: > "$docker_log"
write_env "0123456789abcdef0123456789abcdef" "https://recruiter-radar.ru/"
printf 'sentinel override\n' > "$app_dir/.rr-notification-key.compose.yml"
set +e
MOCK_COMPOSE_CONFIG_FAIL=true run_configurator --preflight
preflight_status=$?
set -e
test "$preflight_status" = "31"
! grep -q ' up ' "$docker_log"
grep -q '^PUBLIC_APP_ORIGIN=https://recruiter-radar.ru/$' "$app_dir/.env"
grep -q '^sentinel override$' "$app_dir/.rr-notification-key.compose.yml"

write_env "too-short" "https://recruiter-radar.ru"
: > "$docker_log"
if run_configurator --preflight; then
  echo "Short analytics salt unexpectedly passed" >&2
  exit 1
fi
test ! -s "$docker_log"

write_env "0123456789abcdef0123456789abcdef" "http://recruiter-radar.ru"
: > "$docker_log"
if run_configurator --preflight; then
  echo "Non-HTTPS public origin unexpectedly passed" >&2
  exit 1
fi
test ! -s "$docker_log"

write_env "0123456789abcdef0123456789abcdef" "https://attacker.example"
: > "$docker_log"
if run_configurator --preflight; then
  echo "Non-canonical public origin unexpectedly passed" >&2
  exit 1
fi
test ! -s "$docker_log"

printf '%s\n' \
  '{"ok":true,"composeOrder":["config","up","runtime-validation"],"preflightFailureMutatedContainer":false}'
