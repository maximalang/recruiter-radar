#!/usr/bin/env bash
set -euo pipefail

# Production-shape test for scripts/deploy/configure-telegram-runtime.sh
# (QA t_3ed42af0 F3/F4). Real docker + compose, shaped like production:
#   - non-root container user uid/gid 1001 (nextjs), exactly like the runner
#     stage of apps/web/Dockerfile (USER nextjs);
#   - node:22-alpine base => busybox sh/sha256sum, like the production image;
#   - credentials are delivered ONLY through a Compose env_file override -
#     the runtime env file is never bind-mounted into the container;
#   - a stub `teleproto` module reproduces the client API surface the live
#     authorization check imports (no Telegram network calls).
#
# Assertions:
#   1. Regression proof for the old verification defect: the host runtime
#      path is NOT visible inside the web container (sha256sum on the host
#      path fails) and the container runs as uid 1001 - so any verification
#      based on host paths inside the container cannot work.
#   2. Success path: the configurator exits 0, the container's injected
#      environment matches the host runtime file digest-for-digest (canonical
#      form recomputed independently by this test), the session secret never
#      appears in configurator output, runtime env file mode is 0600, and the
#      health endpoint stays up.
#   3. Rollback path: a rejected new session (live auth failure) exits non-
#      zero, restores the previous runtime env and .env byte-for-byte, leaves
#      no trace of the rejected session on disk, and keeps the stack healthy.
#   4. Recovery proof: a subsequent run with a fresh valid session succeeds,
#      showing the rolled-back stack is fully operational.
#
# Orchestration-level failure matrix (preflight, port, health, digest
# mismatch, chain handling) is covered by configure-telegram-runtime.sh.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
configurator="$repo_root/scripts/deploy/configure-telegram-runtime.sh"

for cmd in docker curl sha256sum base64 flock stat; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "prodshape test requires '$cmd' (run it on a docker-enabled host)." >&2
    exit 1
  fi
done
docker info >/dev/null 2>&1 || { echo "docker daemon is not reachable." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 is required." >&2; exit 1; }

if curl -fsS -m 2 "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
  echo "Port 3000 on 127.0.0.1 is already serving; the prodshape test needs it free." >&2
  exit 1
fi

temporary_dir="$(mktemp -d)"
app_dir="$temporary_dir/app"
webimage_dir="$temporary_dir/webimage"
project_name="rrtgprodshape$$"
image_tag="rr-telegram-prodshape:$$"
stdout_file="$temporary_dir/stdout.log"
stderr_file="$temporary_dir/stderr.log"
snapshot_dir="$temporary_dir/snapshot"

cleanup() {
  COMPOSE_PROJECT_NAME="$project_name" docker compose -p "$project_name" -f "$app_dir/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm -f "$image_tag" >/dev/null 2>&1 || true
  rm -rf "$temporary_dir"
}
trap cleanup EXIT INT TERM

mkdir -p "$app_dir" "$webimage_dir/node_modules/teleproto" "$snapshot_dir"

# NTFS/git-bash does not enforce POSIX modes; probe once so the 0600
# assertion is only enforced where chmod actually sticks (Linux CI/WSL).
chmod_probe="$temporary_dir/chmod-probe"
: > "$chmod_probe"
chmod 600 "$chmod_probe" 2>/dev/null || true
chmod_enforced=false
probe_perms="$(stat -c '%a' "$chmod_probe" 2>/dev/null || stat -f '%Lp' "$chmod_probe" 2>/dev/null || echo unknown)"
if [ "$probe_perms" = "600" ]; then
  chmod_enforced=true
fi

# --- Production-shaped web image fixture -------------------------------------
cat > "$webimage_dir/Dockerfile" <<'IMG_EOF'
FROM node:22-alpine
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
WORKDIR /app
COPY node_modules/teleproto ./node_modules/teleproto
COPY server.mjs ./server.mjs
USER nextjs
EXPOSE 3000
CMD ["node", "server.mjs"]
IMG_EOF

cat > "$webimage_dir/server.mjs" <<'SRV_EOF'
import { createServer } from 'node:http';
const server = createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"status":"ok"}');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});
server.listen(3000, '0.0.0.0', () => {
  console.log('prodshape stub web listening on 3000');
});
SRV_EOF

cat > "$webimage_dir/node_modules/teleproto/package.json" <<'PKG_EOF'
{
  "name": "teleproto",
  "version": "0.0.0-prodshape-stub",
  "type": "module",
  "main": "index.js"
}
PKG_EOF

cat > "$webimage_dir/node_modules/teleproto/index.js" <<'STUB_EOF'
// Stub of the MTProto client surface used by the live authorization check.
// Sessions whose saved string starts with INVALID are rejected, which lets
// the test drive the authorization-failure rollback path deterministically.
export class TelegramClient {
  #session;
  #apiId;
  #apiHash;
  constructor(session, apiId, apiHash, options) {
    this.#session = session;
    this.#apiId = apiId;
    this.#apiHash = apiHash;
    this.options = options ?? {};
  }
  async connect() {
    if (!this.#apiId || !this.#apiHash) {
      throw new Error('stub: missing apiId/apiHash');
    }
  }
  async checkAuthorization() {
    const raw = typeof this.#session?.save === 'function' ? this.#session.save() : String(this.#session ?? '');
    return !raw.startsWith('INVALID');
  }
  async disconnect() {}
}
class StringSession {
  #raw;
  constructor(raw) {
    this.#raw = raw ?? '';
  }
  save() {
    return this.#raw;
  }
}
export const sessions = { StringSession };
STUB_EOF

# --- Production-shaped app directory ------------------------------------------
# No `build:` key here on purpose: the image is pre-built with an explicit
# `docker build` below, so this compose file stays path-free and works even
# when the test runs against a daemon on another OS (docker.exe from git-bash).
cat > "$app_dir/docker-compose.yml" <<YML_EOF
services:
  web:
    image: $image_tag
    ports:
      - "127.0.0.1:3000:3000"
YML_EOF
printf 'PUBLIC_APP_ORIGIN=https://recruiter-radar.ru\n' > "$app_dir/.env"

run_configurator() { # $1=bundle path; captures stdout/stderr/status
  set +e
  env \
    COMPOSE_PROJECT_NAME="$project_name" \
    RR_APP_DIR="$app_dir" \
    RR_DEPLOYMENT_LOCK="$temporary_dir/deployment.lock" \
    RR_TELEGRAM_HEALTH_RETRIES=25 \
    bash "$configurator" --key-file "$1" \
    > "$stdout_file" 2> "$stderr_file"
  run_status=$?
  set -e
}

make_bundle() { # $1..$3 -> bundle path (stdout)
  local bundle_path="$temporary_dir/bundle-$RANDOM.b64"
  {
    printf 'TELEGRAM_API_ID=%s\n' "$1"
    printf 'TELEGRAM_API_HASH=%s\n' "$2"
    printf 'TELEGRAM_SESSION=%s\n' "$3"
  } | base64 -w0 > "$bundle_path"
  printf '%s' "$bundle_path"
}

compose_ctl() { # run docker compose against the CURRENT configured chain
  local ctl_args=(docker compose --env-file "$app_dir/.env" -p "$project_name" -f "$app_dir/docker-compose.yml")
  if [ -f "$app_dir/.rr-telegram.compose.yml" ]; then
    ctl_args+=(-f "$app_dir/.rr-telegram.compose.yml")
  fi
  "${ctl_args[@]}" "$@"
}

wait_health() {
  # shellcheck disable=SC2034  # attempt only drives the bounded retry loop
  for attempt in $(seq 1 30); do
    if curl -fsS -m 2 "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

valid_id="2468135"
valid_hash="fedcba9876543210fedcba9876543210"
session_good="BQECAtKx1wAAES7n0FhHcHJvZHNoYXBlLXNlc3Npb24tZ29vZA=="
session_bad="INVALIDprodshaperollbacksessionAAAAAAAAAAAAAAA="
session_fresh="BQECAtKx1wAAES7n0FhHcHJvZHNoYXBlLXNlc3Npb24tbmV3ZA=="

# --- Build image and bootstrap the pre-telegram stack --------------------------
docker build -q -t "$image_tag" "$webimage_dir" >/dev/null
COMPOSE_PROJECT_NAME="$project_name" docker compose -p "$project_name" -f "$app_dir/docker-compose.yml" up -d >/dev/null
wait_health || { echo "bootstrap web container never became healthy" >&2; exit 1; }

# --- Scenario 1: successful production-shaped configuration ---------------------
bundle="$(make_bundle "$valid_id" "$valid_hash" "$session_good")"
run_configurator "$bundle"
if [ "$run_status" -ne 0 ]; then
  echo "Configurator failed on the success scenario (status $run_status):" >&2
  cat "$stderr_file" >&2
  exit 1
fi
grep -q '"telegramRuntimeConfigured":true' "$stdout_file"

# F3 regression proof: the host runtime path is not visible inside the
# non-root web container, so host-path verification cannot work by design.
set +e
compose_ctl exec -T web sha256sum /opt/recruiter-radar/config/tg-runtime/.env >/dev/null 2>&1
hostpath_status=$?
set -e
test "$hostpath_status" -ne 0
uid_inside="$(compose_ctl exec -T web id -u | tr -d '[:space:]')"
test "$uid_inside" = "1001"

# Runtime env file: mode 0600 (where the filesystem enforces POSIX modes;
# NTFS/git-bash does not, so probe once), canonical content.
if [ "$chmod_enforced" = true ]; then
  perms="$(stat -c '%a' "$app_dir/config/tg-runtime/.env" 2>/dev/null || stat -f '%Lp' "$app_dir/config/tg-runtime/.env")"
  test "$perms" = "600"
fi
grep -q "^TELEGRAM_SESSION=$session_good$" "$app_dir/config/tg-runtime/.env"

# Independent digest check: host file vs canonical reconstruction from the
# environment Compose injected into the container (values never printed).
host_sha="$(sha256sum "$app_dir/config/tg-runtime/.env" | awk '{print $1}')"
# shellcheck disable=SC2016  # expanded by the CONTAINER shell, not the host
container_sha="$(compose_ctl exec -T web sh -c \
  'printf "TELEGRAM_API_ID=%s\nTELEGRAM_API_HASH=%s\nTELEGRAM_SESSION=%s\n" "${TELEGRAM_API_ID-}" "${TELEGRAM_API_HASH-}" "${TELEGRAM_SESSION-}" | sha256sum' \
  | awk '{print $1}')"
if [ "$host_sha" != "$container_sha" ]; then
  echo "Host/container digest mismatch on the success path ($host_sha != $container_sha)" >&2
  exit 1
fi

# Secret hygiene: session value never appears in configurator output.
if grep -qF "$session_good" "$stdout_file" "$stderr_file"; then
  echo "Session secret leaked into configurator output" >&2
  exit 1
fi
wait_health || { echo "health endpoint died after successful configuration" >&2; exit 1; }

cp -p "$app_dir/config/tg-runtime/.env" "$snapshot_dir/runtime-env"
cp -p "$app_dir/.env" "$snapshot_dir/env"
cp -p "$app_dir/.rr-telegram.compose.yml" "$snapshot_dir/override"

# --- Scenario 2: live auth failure rolls the applied configuration back --------
bundle="$(make_bundle "$valid_id" "$valid_hash" "$session_bad")"
run_configurator "$bundle"
test "$run_status" -ne 0
grep -q 'live Telegram authorization check failed' "$stderr_file"
grep -q 'Rollback completed; previous configuration is live again' "$stderr_file"

# Previous live state restored byte-for-byte.
for pair in "config/tg-runtime/.env:runtime-env" ".env:env" ".rr-telegram.compose.yml:override"; do
  live="${pair%%:*}"
  snap="${pair##*:}"
  if ! cmp -s "$app_dir/$live" "$snapshot_dir/$snap"; then
    echo "Rollback did not restore $live byte-for-byte" >&2
    exit 1
  fi
done

# The rejected session left no trace on disk, and no residue remains. Only
# temporary-suffixed candidates and rollback dirs count as residue; the final
# .rr-telegram.compose.yml override must survive the rollback.
if grep -rqF "$session_bad" "$app_dir"; then
  echo "Rejected session persisted on disk after rollback" >&2
  exit 1
fi
residue="$(find "$app_dir" -maxdepth 1 \( -name '.rr-telegram-rollback.*' -o -name '.rr-telegram.env.*' -o -name '.rr-telegram.runtime.*' -o -name '.rr-telegram.compose.??????' -o -name '.rr-telegram.compose.???????' \) | wc -l)"
if [ "$residue" -ne 0 ]; then
  echo "Temporary/rollback residue left after rollback:" >&2
  find "$app_dir" -maxdepth 1 >&2
  exit 1
fi

# Stack is healthy again with the PREVIOUS (working) configuration.
wait_health || { echo "health endpoint did not recover after rollback" >&2; exit 1; }
# shellcheck disable=SC2016  # expanded by the CONTAINER shell, not the host
container_sha_after_rollback="$(compose_ctl exec -T web sh -c \
  'printf "TELEGRAM_API_ID=%s\nTELEGRAM_API_HASH=%s\nTELEGRAM_SESSION=%s\n" "${TELEGRAM_API_ID-}" "${TELEGRAM_API_HASH-}" "${TELEGRAM_SESSION-}" | sha256sum' \
  | awk '{print $1}')"
test "$container_sha_after_rollback" = "$host_sha"

# --- Scenario 3: recovery - a fresh valid session succeeds after rollback -------
bundle="$(make_bundle "$valid_id" "$valid_hash" "$session_fresh")"
run_configurator "$bundle"
if [ "$run_status" -ne 0 ]; then
  echo "Configurator failed after a rolled-back run (status $run_status):" >&2
  cat "$stderr_file" >&2
  exit 1
fi
grep -q "^TELEGRAM_SESSION=$session_fresh$" "$app_dir/config/tg-runtime/.env"
if grep -rqF "$session_good" "$app_dir" || grep -rqF "$session_bad" "$app_dir"; then
  echo "Superseded session material persisted after a successful rotation" >&2
  exit 1
fi
wait_health || { echo "health endpoint died after rotation" >&2; exit 1; }

echo "configure-telegram-runtime production-shape tests passed."
