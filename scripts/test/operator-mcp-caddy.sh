#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
operator_configurator="$repo_root/scripts/deploy/configure-operator-mcp-caddy.sh"
real_ip_configurator="$repo_root/scripts/deploy/configure-caddy-real-ip.sh"
temporary_dir="$(mktemp -d)"
mock_bin="$temporary_dir/bin"
trap 'rm -rf "$temporary_dir"' EXIT
mkdir -p "$mock_bin"

cat > "$mock_bin/caddy" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  validate) printf 'validate %s\n' "$*" >> "$MOCK_COMMAND_LOG" ;;
  reload) printf 'caddy-reload %s\n' "$*" >> "$MOCK_COMMAND_LOG" ;;
  *) exit 31 ;;
esac
EOF
cat > "$mock_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  show) printf 'yes\n' ;;
  reload) printf 'reload %s\n' "$*" >> "$MOCK_COMMAND_LOG" ;;
  *) exit 32 ;;
esac
EOF
chmod +x "$mock_bin/caddy" "$mock_bin/systemctl"

config="$temporary_dir/Caddyfile"
commands="$temporary_dir/commands.log"
: > "$commands"

write_base_config() {
  cat > "$config" <<'EOF'
recruiter-radar.ru {
    # Trust boundary: overwrite client X-Real-IP at the only public ingress.
    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto https
        header_up Host recruiter-radar.ru
    }
}
EOF
}

write_legacy_config() {
  cat > "$config" <<'EOF'
recruiter-radar.ru {
    # BEGIN Recruiter Radar operator MCP (managed)
    @rr_operator_mcp path /api/internal/mcp /api/internal/mcp/* /.well-known/oauth-protected-resource /.well-known/oauth-protected-resource/*
    handle @rr_operator_mcp {
        # Same ingress trust boundary as the public app; never preserve client-supplied forwarding headers.
        reverse_proxy localhost:3001 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-Proto https
            header_up Host recruiter-radar.ru
        }
    }
    # END Recruiter Radar operator MCP (managed)
    # Trust boundary: overwrite client X-Real-IP at the only public ingress.
    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto https
        header_up Host recruiter-radar.ru
    }
}
EOF
}

run_operator() {
  local enabled="${1:-true}"
  PATH="$mock_bin:$PATH" MOCK_COMMAND_LOG="$commands" RR_CADDY_CONFIG_PATH="$config" \
    RR_CADDY_OPERATOR_BACKUP_PATH="$temporary_dir/operator.backup" RR_MCP_ENABLED="$enabled" \
    bash "$operator_configurator"
}
run_real_ip() {
  PATH="$mock_bin:$PATH" MOCK_COMMAND_LOG="$commands" RR_CADDY_CONFIG_PATH="$config" \
    RR_CADDY_BACKUP_PATH="$temporary_dir/real-ip.backup" sh "$real_ip_configurator"
}

# Fresh fail-dark hosts must not gain an OAuth routing surface.
write_base_config
cp "$config" "$temporary_dir/original"
: > "$commands"
run_operator false >/dev/null
cmp "$temporary_dir/original" "$config"
test "$(grep -c '^reload ' "$commands" || true)" = "0"
test "$(grep -c '^validate ' "$commands")" = "1"
! grep -Fq '# BEGIN Recruiter Radar operator MCP (managed)' "$config"
! grep -Fq '/operator/oauth/' "$config"

# Enabling on a fresh host installs the exact current MCP + local OAuth contract.
: > "$commands"
run_operator true >/dev/null

grep -Fq '# BEGIN Recruiter Radar operator MCP (managed)' "$config"
grep -Fq '@rr_operator_mcp path /api/internal/mcp /api/internal/mcp/* /.well-known/oauth-protected-resource /.well-known/oauth-protected-resource/*' "$config"
grep -Fq 'reverse_proxy 127.0.0.1:3001 {' "$config"
grep -Fq '@rr_operator_oauth path \' "$config"
grep -Fq '/operator/oauth/auth/* \' "$config"
grep -Fq '/operator/oauth/token \' "$config"
grep -Fq '/operator/oauth/token/revocation \' "$config"
grep -Fq '/operator/oauth/jwks \' "$config"
grep -Fq '/operator/oauth/reg \' "$config"
grep -Fq '/operator/oauth/interaction/* \' "$config"
grep -Fq '/operator/oauth/.well-known/openid-configuration \' "$config"
grep -Fq '/.well-known/oauth-authorization-server/operator/oauth' "$config"
grep -Fq 'reverse_proxy 127.0.0.1:3002 {' "$config"
grep -Fq 'reverse_proxy localhost:3000 {' "$config"
test "$(grep -Fc 'reverse_proxy 127.0.0.1:3001' "$config")" = "1"
test "$(grep -Fc 'reverse_proxy 127.0.0.1:3002' "$config")" = "1"
test "$(grep -Fc 'reverse_proxy localhost:3000' "$config")" = "1"
! grep -Fq '/operator/*' "$config"
! grep -Fq 'reverse_proxy 127.0.0.1:3002' <(sed -n '/# END Recruiter Radar operator MCP/,$p' "$config")
cmp "$temporary_dir/original" "$temporary_dir/operator.backup"
test "$(grep -c '^reload ' "$commands")" = "1"

# The general real-IP configurator must preserve the managed operator block.
: > "$commands"
cp "$config" "$temporary_dir/with-operator"
run_real_ip >/dev/null
cmp "$temporary_dir/with-operator" "$config"
test "$(grep -c '^reload ' "$commands" || true)" = "0"

# Current contract is idempotent.
: > "$commands"
run_operator true >/dev/null
test "$(grep -c '^reload ' "$commands" || true)" = "0"
test "$(grep -c '^validate ' "$commands")" = "1"

# Drift in the current contract must still fail closed.
sed -i 's/reverse_proxy 127.0.0.1:3001/reverse_proxy 127.0.0.1:3999/' "$config"
cp "$config" "$temporary_dir/tampered-current"
set +e
run_operator true >/dev/null 2> "$temporary_dir/tampered-current.err"
status=$?
set -e
test "$status" -ne 0
cmp "$temporary_dir/tampered-current" "$config"
grep -Fq 'differs from the audited current and legacy contracts' "$temporary_dir/tampered-current.err"

# Exact previous production contract is safe to preserve while fail-dark.
write_legacy_config
cp "$config" "$temporary_dir/legacy-original"
: > "$commands"
run_operator false >/dev/null
cmp "$temporary_dir/legacy-original" "$config"
test "$(grep -c '^reload ' "$commands" || true)" = "0"
test "$(grep -c '^validate ' "$commands")" = "1"
grep -Fq 'reverse_proxy localhost:3001 {' "$config"
! grep -Fq '@rr_operator_oauth' "$config"

# The same exact legacy contract may be atomically upgraded once OAuth is enabled.
: > "$commands"
run_operator true >/dev/null
cmp "$temporary_dir/legacy-original" "$temporary_dir/operator.backup"
test "$(grep -c '^reload ' "$commands")" = "1"
grep -Fq 'reverse_proxy 127.0.0.1:3001 {' "$config"
grep -Fq 'reverse_proxy 127.0.0.1:3002 {' "$config"
grep -Fq '@rr_operator_oauth path \' "$config"
! grep -Fq 'reverse_proxy localhost:3001 {' "$config"

# Migrated current contract is idempotent.
: > "$commands"
run_operator true >/dev/null
test "$(grep -c '^reload ' "$commands" || true)" = "0"
test "$(grep -c '^validate ' "$commands")" = "1"

# A legacy-looking block with any drift is not eligible for automatic migration.
write_legacy_config
sed -i 's/reverse_proxy localhost:3001/reverse_proxy localhost:3999/' "$config"
cp "$config" "$temporary_dir/tampered-legacy"
set +e
run_operator true >/dev/null 2> "$temporary_dir/tampered-legacy.err"
status=$?
set -e
test "$status" -ne 0
cmp "$temporary_dir/tampered-legacy" "$config"
grep -Fq 'differs from the audited current and legacy contracts' "$temporary_dir/tampered-legacy.err"

# Invalid rollout state must fail before touching Caddy.
write_base_config
cp "$config" "$temporary_dir/invalid-enabled"
set +e
run_operator maybe >/dev/null 2> "$temporary_dir/invalid-enabled.err"
status=$?
set -e
test "$status" -ne 0
cmp "$temporary_dir/invalid-enabled" "$config"
grep -Fq 'RR_MCP_ENABLED must be true or false' "$temporary_dir/invalid-enabled.err"

printf '%s\n' '{"ok":true,"operatorCaddyBoundary":"validated","legacyMigration":"validated","failDark":"validated"}'
