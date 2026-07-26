#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
entrypoint="$repo_root/apps/web/docker-entrypoint.sh"
temporary_dir="$(mktemp -d)"
mock_bin="$temporary_dir/bin"

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

mkdir -p "$mock_bin"
cat > "$mock_bin/node" <<'NODE_EOF'
#!/usr/bin/env sh
set -eu

printf '%s\n' "$1" >> "$MOCK_NODE_LOG"
case "$1" in
  packages/db/scripts/reconcile-payment-success-telemetry.mjs)
    if [ "${MOCK_RECONCILIATION_FAIL:-false}" = "true" ]; then
      exit 17
    fi
    ;;
esac
NODE_EOF
chmod +x "$mock_bin/node"

run_entrypoint() {
  PATH="$mock_bin:$PATH" \
    MOCK_NODE_LOG="$1" \
    MOCK_RECONCILIATION_FAIL="${2:-false}" \
    DATABASE_URL="postgres://example.invalid/recruiter_radar" \
    MIGRATE_ON_START=true \
    sh "$entrypoint"
}

success_log="$temporary_dir/success.log"
run_entrypoint "$success_log"
test "$(sed -n '1p' "$success_log")" = "packages/db/scripts/migrate.mjs"
test "$(sed -n '2p' "$success_log")" = "packages/db/scripts/reconcile-payment-success-telemetry.mjs"
test "$(sed -n '3p' "$success_log")" = "apps/web/server.js"

failure_log="$temporary_dir/failure.log"
run_entrypoint "$failure_log" true
test "$(sed -n '1p' "$failure_log")" = "packages/db/scripts/migrate.mjs"
test "$(sed -n '2p' "$failure_log")" = "packages/db/scripts/reconcile-payment-success-telemetry.mjs"
test "$(sed -n '3p' "$failure_log")" = "apps/web/server.js"

printf '%s\n' \
  '{"ok":true,"order":["migrations","reconciliation","application"],"reconciliationFailureBlockedStartup":false}'
