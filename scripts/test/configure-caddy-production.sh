#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
configurator="$repo_root/scripts/deploy/configure-caddy-real-ip.sh"
temporary_dir="$(mktemp -d)"
mock_bin="$temporary_dir/bin"

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

mkdir -p "$mock_bin"

cat > "$mock_bin/caddy" <<'CADDY_EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'validate %s\n' "$*" >> "$MOCK_COMMAND_LOG"
count="$(grep -c '^validate ' "$MOCK_COMMAND_LOG")"
if [ "${MOCK_CADDY_VALIDATE_FAIL_ON_CALL:-0}" = "$count" ]; then
  exit 21
fi
CADDY_EOF

cat > "$mock_bin/systemctl" <<'SYSTEMCTL_EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'reload %s\n' "$*" >> "$MOCK_COMMAND_LOG"
count="$(grep -c '^reload ' "$MOCK_COMMAND_LOG")"
if [ "${MOCK_SYSTEMCTL_FAIL_ON_CALL:-0}" = "$count" ]; then
  exit 33
fi
SYSTEMCTL_EOF

chmod +x "$mock_bin/caddy" "$mock_bin/systemctl"

canonical_proxy_block() {
  cat <<'CADDY_EOF'
    # Trust boundary: overwrite client X-Real-IP at the only public ingress.
    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto https
        header_up Host recruiter-radar.ru
    }
CADDY_EOF
}

write_site() {
  local config_path="$1"
  local proxy_contents="$2"
  cat > "$config_path" <<CADDY_EOF
unrelated.example {
    respond "untouched"
}

recruiter-radar.ru {
$proxy_contents
}
CADDY_EOF
}

run_configurator() {
  local scenario_dir="$1"
  shift
  : > "$scenario_dir/commands.log"
  local status=0
  PATH="$mock_bin:$PATH" \
    MOCK_COMMAND_LOG="$scenario_dir/commands.log" \
    RR_CADDY_CONFIG_PATH="$scenario_dir/Caddyfile" \
    RR_CADDY_BACKUP_PATH="$scenario_dir/Caddyfile.backup" \
    "$@" \
    sh "$configurator" \
      > "$scenario_dir/stdout.log" \
      2> "$scenario_dir/stderr.log" || status=$?
  if [ "$status" -ne 0 ]; then
    cat "$scenario_dir/stderr.log" >&2
  fi
  return "$status"
}

new_scenario() {
  local name="$1"
  local scenario_dir="$temporary_dir/$name"
  mkdir -p "$scenario_dir"
  printf '%s' "$scenario_dir"
}

assert_canonical() {
  local config_path="$1"
  grep -Fq 'header_up X-Real-IP {remote_host}' "$config_path"
  grep -Fq 'header_up X-Forwarded-Proto https' "$config_path"
  grep -Fq 'header_up Host recruiter-radar.ru' "$config_path"
  test "$(grep -Fc 'reverse_proxy localhost:3000' "$config_path")" = "1"
}

bare_dir="$(new_scenario bare)"
write_site "$bare_dir/Caddyfile" '    reverse_proxy localhost:3000'
cp "$bare_dir/Caddyfile" "$bare_dir/original"
run_configurator "$bare_dir" env
assert_canonical "$bare_dir/Caddyfile"
cmp "$bare_dir/original" "$bare_dir/Caddyfile.backup"
test "$(grep -c '^reload ' "$bare_dir/commands.log")" = "1"

canonical_dir="$(new_scenario canonical)"
write_site "$canonical_dir/Caddyfile" "$(canonical_proxy_block)"
cp "$canonical_dir/Caddyfile" "$canonical_dir/original"
run_configurator "$canonical_dir" env
cmp "$canonical_dir/original" "$canonical_dir/Caddyfile"
test "$(grep -c '^reload ' "$canonical_dir/commands.log" || true)" = "0"
test "$(grep -c '^validate ' "$canonical_dir/commands.log")" = "1"

legacy_dir="$(new_scenario legacy)"
write_site "$legacy_dir/Caddyfile" '    # Trust boundary: overwrite client X-Real-IP at the only public ingress.
    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
    }'
cp "$legacy_dir/Caddyfile" "$legacy_dir/original"
run_configurator "$legacy_dir" env
assert_canonical "$legacy_dir/Caddyfile"
cmp "$legacy_dir/original" "$legacy_dir/Caddyfile.backup"
test "$(grep -c '^reload ' "$legacy_dir/commands.log")" = "1"

unknown_dir="$(new_scenario unknown)"
write_site "$unknown_dir/Caddyfile" '    reverse_proxy localhost:3000 {
        flush_interval -1
    }'
cp "$unknown_dir/Caddyfile" "$unknown_dir/original"
set +e
run_configurator "$unknown_dir" env
unknown_status=$?
set -e
test "$unknown_status" -ne 0
cmp "$unknown_dir/original" "$unknown_dir/Caddyfile"
test "$(grep -c '^reload ' "$unknown_dir/commands.log" || true)" = "0"
grep -Fq \
  'Unknown reverse_proxy directives found; refusing an unsafe Caddyfile rewrite.' \
  "$unknown_dir/stderr.log"

unknown_transport_dir="$(new_scenario unknown-transport)"
write_site "$unknown_transport_dir/Caddyfile" '    reverse_proxy localhost:3000 {
        transport http {
            dial_timeout 5s
        }
    }'
cp "$unknown_transport_dir/Caddyfile" "$unknown_transport_dir/original"
set +e
run_configurator "$unknown_transport_dir" env
unknown_transport_status=$?
set -e
test "$unknown_transport_status" -ne 0
cmp "$unknown_transport_dir/original" "$unknown_transport_dir/Caddyfile"
test "$(grep -c '^reload ' "$unknown_transport_dir/commands.log" || true)" = "0"

unknown_commentless_legacy_dir="$(new_scenario unknown-commentless-legacy)"
write_site "$unknown_commentless_legacy_dir/Caddyfile" '    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
    }'
cp \
  "$unknown_commentless_legacy_dir/Caddyfile" \
  "$unknown_commentless_legacy_dir/original"
set +e
run_configurator "$unknown_commentless_legacy_dir" env
unknown_commentless_legacy_status=$?
set -e
test "$unknown_commentless_legacy_status" -ne 0
cmp \
  "$unknown_commentless_legacy_dir/original" \
  "$unknown_commentless_legacy_dir/Caddyfile"
test \
  "$(grep -c '^reload ' "$unknown_commentless_legacy_dir/commands.log" || true)" \
  = "0"

unknown_additional_proxy_dir="$(new_scenario unknown-additional-proxy)"
write_site "$unknown_additional_proxy_dir/Caddyfile" '    reverse_proxy localhost:3000
    reverse_proxy /internal other-upstream:8080'
cp \
  "$unknown_additional_proxy_dir/Caddyfile" \
  "$unknown_additional_proxy_dir/original"
set +e
run_configurator "$unknown_additional_proxy_dir" env
unknown_additional_proxy_status=$?
set -e
test "$unknown_additional_proxy_status" -ne 0
cmp \
  "$unknown_additional_proxy_dir/original" \
  "$unknown_additional_proxy_dir/Caddyfile"
test \
  "$(grep -c '^reload ' "$unknown_additional_proxy_dir/commands.log" || true)" \
  = "0"

unknown_import_dir="$(new_scenario unknown-import)"
write_site "$unknown_import_dir/Caddyfile" '    import proxy-snippet
    reverse_proxy localhost:3000'
cp "$unknown_import_dir/Caddyfile" "$unknown_import_dir/original"
set +e
run_configurator "$unknown_import_dir" env
unknown_import_status=$?
set -e
test "$unknown_import_status" -ne 0
cmp "$unknown_import_dir/original" "$unknown_import_dir/Caddyfile"
test "$(grep -c '^reload ' "$unknown_import_dir/commands.log" || true)" = "0"

multiple_dir="$(new_scenario multiple)"
write_site "$multiple_dir/Caddyfile" '    reverse_proxy localhost:3000
    reverse_proxy localhost:3000'
cp "$multiple_dir/Caddyfile" "$multiple_dir/original"
set +e
run_configurator "$multiple_dir" env
multiple_status=$?
set -e
test "$multiple_status" -ne 0
cmp "$multiple_dir/original" "$multiple_dir/Caddyfile"
test "$(grep -c '^reload ' "$multiple_dir/commands.log" || true)" = "0"

validation_dir="$(new_scenario validation)"
write_site "$validation_dir/Caddyfile" '    reverse_proxy localhost:3000'
cp "$validation_dir/Caddyfile" "$validation_dir/original"
printf 'existing backup\n' > "$validation_dir/Caddyfile.backup"
cp "$validation_dir/Caddyfile.backup" "$validation_dir/backup.original"
set +e
run_configurator "$validation_dir" \
  env MOCK_CADDY_VALIDATE_FAIL_ON_CALL=1
validation_status=$?
set -e
test "$validation_status" = "21"
cmp "$validation_dir/original" "$validation_dir/Caddyfile"
cmp "$validation_dir/backup.original" "$validation_dir/Caddyfile.backup"
test "$(grep -c '^reload ' "$validation_dir/commands.log" || true)" = "0"

reload_dir="$(new_scenario reload)"
write_site "$reload_dir/Caddyfile" '    reverse_proxy localhost:3000'
cp "$reload_dir/Caddyfile" "$reload_dir/original"
set +e
run_configurator "$reload_dir" \
  env MOCK_SYSTEMCTL_FAIL_ON_CALL=1
reload_status=$?
set -e
test "$reload_status" = "33"
cmp "$reload_dir/original" "$reload_dir/Caddyfile"
cmp "$reload_dir/original" "$reload_dir/Caddyfile.backup"
test "$(grep -c '^validate ' "$reload_dir/commands.log")" = "2"
test "$(grep -c '^reload ' "$reload_dir/commands.log")" = "2"

printf '%s\n' \
  '{"ok":true,"scenarios":["bare","canonical","legacy","unknown","multiple","validation-failure","reload-failure"]}'
