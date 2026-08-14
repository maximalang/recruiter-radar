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

cat > "$temporary_dir/bin/fake-crontab" <<SH
#!/usr/bin/env bash
test "\${1:-}" = '-l'
printf '%s\n' \
  '5 0 * * * $temporary_dir/app/scripts/deploy/run-government-source-sync.sh government-procurement' \
  '15 1 * * 0 $temporary_dir/app/scripts/deploy/run-government-source-sync.sh rosstat-open-data'
SH
chmod +x "$temporary_dir/bin/fake-crontab"

export RR_APP_DIR="$temporary_dir/app"
export RR_DOCKER_BIN="$temporary_dir/bin/fake-docker"
export RR_CRONTAB_BIN="$temporary_dir/bin/fake-crontab"
export RR_TEST_COMMAND_LOG="$temporary_dir/docker.log"

bash "$repo_root/scripts/deploy/verify-source-production-runtime.sh"
grep -Fq 'verify-source-runtime-image.mjs --filesystem --browser --database' "$RR_TEST_COMMAND_LOG"
grep -Fq '/api/sources/status' "$RR_TEST_COMMAND_LOG"

cat > "$temporary_dir/bin/fake-crontab" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '5 0 * * * /wrong/path government-procurement'
SH
chmod +x "$temporary_dir/bin/fake-crontab"
if bash "$repo_root/scripts/deploy/verify-source-production-runtime.sh" >"$temporary_dir/missing-cron.out" 2>&1; then
  echo 'Preflight unexpectedly accepted a missing production cron entry.' >&2
  exit 1
fi
grep -q 'government-procurement cron entry is missing' "$temporary_dir/missing-cron.out"
