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

run_operator() {
  PATH="$mock_bin:$PATH" MOCK_COMMAND_LOG="$commands" RR_CADDY_CONFIG_PATH="$config" \
    RR_CADDY_OPERATOR_BACKUP_PATH="$temporary_dir/operator.backup" bash "$operator_configurator"
}
run_real_ip() {
  PATH="$mock_bin:$PATH" MOCK_COMMAND_LOG="$commands" RR_CADDY_CONFIG_PATH="$config" \
    RR_CADDY_BACKUP_PATH="$temporary_dir/real-ip.backup" sh "$real_ip_configurator"
}

cp "$config" "$temporary_dir/original"
run_operator >/dev/null

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

: > "$commands"
cp "$config" "$temporary_dir/with-operator"
run_real_ip >/dev/null
cmp "$temporary_dir/with-operator" "$config"
test "$(grep -c '^reload ' "$commands" || true)" = "0"

: > "$commands"
run_operator >/dev/null
test "$(grep -c '^reload ' "$commands" || true)" = "0"
test "$(grep -c '^validate ' "$commands")" = "1"

sed -i 's/reverse_proxy 127.0.0.1:3001/reverse_proxy 127.0.0.1:3999/' "$config"
cp "$config" "$temporary_dir/tampered"
set +e
run_operator >/dev/null 2> "$temporary_dir/tampered.err"
status=$?
set -e
test "$status" -ne 0
cmp "$temporary_dir/tampered" "$config"
grep -Fq 'differs from the audited contract' "$temporary_dir/tampered.err"

printf '%s\n' '{"ok":true,"operatorCaddyBoundary":"validated"}'
