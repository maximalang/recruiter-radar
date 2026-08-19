#!/usr/bin/env bash
set -euo pipefail

source_id="${1:-}"
case "$source_id" in
  fns-open-data|government-procurement|rosstat-open-data|rospatent-open-data|fedresurs) ;;
  *)
    echo 'Usage: run-government-source-sync.sh <fns-open-data|government-procurement|rosstat-open-data|rospatent-open-data|fedresurs>' >&2
    exit 64
    ;;
esac

app_dir="${RR_APP_DIR:-/opt/recruiter-radar}"
lock_path="${RR_GOVERNMENT_SOURCE_SYNC_LOCK:-/tmp/recruiter-radar-government-source-sync.lock}"
docker_bin="${RR_DOCKER_BIN:-docker}"

test -d "$app_dir" || { echo "Recruiter Radar app directory is missing: $app_dir" >&2; exit 1; }
command -v flock >/dev/null 2>&1 || { echo 'flock is required for government source sync.' >&2; exit 1; }
command -v "$docker_bin" >/dev/null 2>&1 || { echo 'Docker CLI is required for government source sync.' >&2; exit 1; }

cd "$app_dir"
exec 9> "$lock_path"
if ! flock -n 9; then
  echo 'Another government source sync is active; refusing overlap.' >&2
  exit 1
fi

"$docker_bin" compose exec -T web sh -eu -c '
  test -n "${SOURCE_SNAPSHOT_ROOT:-}" || { echo "SOURCE_SNAPSHOT_ROOT is required." >&2; exit 1; }
  test -n "${DATABASE_URL:-}" || { echo "DATABASE_URL is required." >&2; exit 1; }
  test -d "$SOURCE_SNAPSHOT_ROOT" || { echo "Snapshot root is not mounted." >&2; exit 1; }
' >/dev/null

"$docker_bin" compose exec -T web \
  node "packages/db/scripts/sync-${source_id}-snapshot.mjs"
