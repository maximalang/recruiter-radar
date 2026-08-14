#!/usr/bin/env bash
set -euo pipefail

app_dir="${RR_APP_DIR:-/opt/recruiter-radar}"
docker_bin="${RR_DOCKER_BIN:-docker}"
runner="$app_dir/scripts/deploy/run-government-source-sync.sh"

test -d "$app_dir" || { echo "Recruiter Radar app directory is missing: $app_dir" >&2; exit 1; }
test -x "$runner" || { echo "Government source sync runner is not executable: $runner" >&2; exit 1; }
command -v "$docker_bin" >/dev/null 2>&1 || { echo 'Docker CLI is required.' >&2; exit 1; }

cd "$app_dir"

snapshot_root="$($docker_bin compose exec -T web sh -eu -c 'printf "%s\n" "${SOURCE_SNAPSHOT_ROOT:-}"')"
state_root="$($docker_bin compose exec -T web sh -eu -c 'printf "%s\n" "${SOURCE_RUNTIME_STATE_ROOT:-}"')"
test -n "$snapshot_root" || { echo 'SOURCE_SNAPSHOT_ROOT is not configured.' >&2; exit 1; }
test -n "$state_root" || { echo 'SOURCE_RUNTIME_STATE_ROOT is not configured.' >&2; exit 1; }

container_id="$($docker_bin compose ps -q web)"
test -n "$container_id" || { echo 'The production web container is not running.' >&2; exit 1; }
mounts="$($docker_bin inspect --format '{{range .Mounts}}{{println .Destination .RW}}{{end}}' "$container_id")"

assert_rw_mount_for() {
  local required_path="$1"
  local destination rw
  while read -r destination rw; do
    case "$required_path" in
      "$destination" | "$destination"/*)
        if [ "$rw" = 'true' ]; then return 0; fi
        ;;
    esac
  done <<< "$mounts"
  echo "No read-write persistent mount covers: $required_path" >&2
  return 1
}

assert_rw_mount_for "$snapshot_root"
assert_rw_mount_for "$state_root"

$docker_bin compose exec -T web \
  node packages/db/scripts/verify-source-runtime-image.mjs --filesystem --browser --database

$docker_bin compose exec -T web node --input-type=module -e '
  const key = process.env.INGEST_API_KEY?.trim();
  if (!key) throw new Error("INGEST_API_KEY is not configured.");
  const response = await fetch("http://127.0.0.1:3000/api/sources/status", {
    headers: { "x-api-key": key },
  });
  if (!response.ok) throw new Error(`Source status API returned HTTP ${response.status}.`);
  const body = await response.json();
  if (body?.summary?.total !== 27 || !Array.isArray(body.sources)) {
    throw new Error("Source status API did not return the 27-source registry.");
  }
  for (const route of ["source-refresh", "daily-radar"]) {
    const check = await fetch(`http://127.0.0.1:3000/api/cron/${route}`);
    if (!check.ok) throw new Error(`${route} health endpoint returned HTTP ${check.status}.`);
  }
  console.log(JSON.stringify({ check: "source-runtime-api", sources: body.sources.length, status: "passed" }));
'

# Source/daily/government clocks are repository-owned GitHub Actions schedules.
# A production host cannot prove that external scheduler activation is enabled,
# so never claim productionScheduled=true from host-local evidence alone.
printf '%s\n' '{"repositoryReady":true,"deploymentReady":true,"runtimeVerified":true,"productionScheduled":false,"scheduleAuthority":"github-actions","scheduleVerification":"external-after-merge"}'
