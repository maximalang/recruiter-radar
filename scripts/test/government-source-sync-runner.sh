#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary_dir="$(mktemp -d)"
trap 'rm -rf -- "$temporary_dir"' EXIT

mkdir -p "$temporary_dir/app" "$temporary_dir/bin"
command_log="$temporary_dir/docker.log"
cat > "$temporary_dir/bin/fake-docker" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$RR_TEST_COMMAND_LOG"
exit 0
SH
chmod +x "$temporary_dir/bin/fake-docker"

export RR_APP_DIR="$temporary_dir/app"
export RR_DOCKER_BIN="$temporary_dir/bin/fake-docker"
export RR_TEST_COMMAND_LOG="$command_log"
export RR_GOVERNMENT_SOURCE_SYNC_LOCK="$temporary_dir/source-sync.lock"

bash "$repo_root/scripts/deploy/run-government-source-sync.sh" rosstat-open-data
grep -Fxq 'compose exec -T web sh -eu -c '"'"'' "$command_log" || grep -Fq 'compose exec -T web sh -eu -c' "$command_log"
grep -Fxq 'compose exec -T web node packages/db/scripts/sync-rosstat-open-data-snapshot.mjs' "$command_log"

if bash "$repo_root/scripts/deploy/run-government-source-sync.sh" unknown >"$temporary_dir/invalid.out" 2>&1; then
  echo 'Invalid source unexpectedly succeeded.' >&2
  exit 1
fi
grep -q '^Usage:' "$temporary_dir/invalid.out"
