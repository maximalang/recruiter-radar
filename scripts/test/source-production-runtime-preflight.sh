#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary_dir="$(mktemp -d)"
trap 'rm -rf -- "$temporary_dir"' EXIT

mkdir -p "$temporary_dir/app/scripts/deploy" "$temporary_dir/bin"
cp "$repo_root/scripts/deploy/run-government-source-sync.sh" \
  "$temporary_dir/app/scripts/deploy/run-government-source-sync.sh"
chmod +x "$temporary_dir/app/scripts/deploy/run-government-source-sync.sh"

cat > "$temporary_dir/bin/fake-docker" <<'SH'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$RR_TEST_COMMAND_LOG"
case "$*" in
  'compose exec -T web sh -eu -c '*SOURCE_SNAPSHOT_ROOT*) printf '%s\n' '/srv/source-snapshots' ;;
  'compose exec -T web sh -eu -c '*SOURCE_RUNTIME_STATE_ROOT*) printf '%s\n' '/var/lib/recruiter-radar/source-state' ;;
  'compose ps -q web') printf '%s\n' 'web-container-id' ;;
  'inspect --format '*web-container-id) printf '%s\n' '/var/lib/recruiter-radar true' '/srv/source-snapshots true' ;;
esac
SH
chmod +x "$temporary_dir/bin/fake-docker"

export RR_APP_DIR="$temporary_dir/app"
export RR_DOCKER_BIN="$temporary_dir/bin/fake-docker"
export RR_TEST_COMMAND_LOG="$temporary_dir/docker.log"

bash "$repo_root/scripts/deploy/verify-source-production-runtime.sh" >"$temporary_dir/preflight.out"
grep -Fq 'verify-source-runtime-image.mjs --filesystem --browser --database' "$RR_TEST_COMMAND_LOG"
grep -Fq '/api/sources/status' "$RR_TEST_COMMAND_LOG"
grep -Fq 'for (const route of ["source-refresh", "daily-radar"])' "$RR_TEST_COMMAND_LOG"
grep -Fq '/api/cron/${route}' "$RR_TEST_COMMAND_LOG"
grep -Fq '"productionScheduled":false' "$temporary_dir/preflight.out"
grep -Fq '"scheduleAuthority":"github-actions"' "$temporary_dir/preflight.out"

cat > "$temporary_dir/bin/fake-docker" <<'SH'
#!/usr/bin/env bash
set -eu
case "$*" in
  'compose exec -T web sh -eu -c '*SOURCE_SNAPSHOT_ROOT*) printf '%s\n' '/srv/source-snapshots' ;;
  'compose exec -T web sh -eu -c '*SOURCE_RUNTIME_STATE_ROOT*) printf '%s\n' '/var/lib/recruiter-radar/source-state' ;;
  'compose ps -q web') printf '%s\n' 'web-container-id' ;;
  'inspect --format '*web-container-id) printf '%s\n' '/var/lib/recruiter-radar true' ;;
esac
SH
chmod +x "$temporary_dir/bin/fake-docker"
if bash "$repo_root/scripts/deploy/verify-source-production-runtime.sh" >"$temporary_dir/missing-mount.out" 2>&1; then
  echo 'Preflight unexpectedly accepted a missing snapshot mount.' >&2
  exit 1
fi
grep -q 'No read-write persistent mount covers: /srv/source-snapshots' "$temporary_dir/missing-mount.out"
