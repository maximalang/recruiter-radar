#!/usr/bin/env bash
set -euo pipefail

# Telegram production runtime configurator.
#
# Safety contract (QA t_3ed42af0 F3/F4):
#   1. Nothing live is mutated until the decoded credential bundle passed
#      format preflight and the current production state is backed up.
#   2. The candidate Compose configuration is validated (`compose config`)
#      BEFORE the active .env / override are swapped.
#   3. Every verification failure (port boundary, health, credential digest,
#      live Telegram authorization) restores the backed-up files and, when
#      the live Compose configuration had already been swapped, recreates
#      the web container from the restored state (rollback).
#   4. Credential verification never echoes secret values: the container
#      recomputes a canonical sha256 digest of its own injected environment
#      and only the digest crosses the process boundary. The production
#      image runs as non-root `nextjs` and the runtime env file is NOT
#      bind-mounted into the container (Compose `env_file` injects values),
#      so host-path lookups inside the container are impossible by design.
#   5. Secret-bearing files (credential bundle, rollback backups) are
#      destroyed as soon as they are no longer needed; backups survive only
#      when a rollback itself failed and manual recovery is required.

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
TELEGRAM_OVERRIDE="$APP_DIR/.rr-telegram.compose.yml"
RUNTIME_DIR="$APP_DIR/config/tg-runtime"
RUNTIME_ENV="$RUNTIME_DIR/.env"
HEALTH_URL="${RR_TELEGRAM_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_RETRIES="${RR_TELEGRAM_HEALTH_RETRIES:-30}"
HEALTH_INTERVAL_SECONDS="${RR_TELEGRAM_HEALTH_INTERVAL_SECONDS:-2}"
KEY_FILE=""
DEPLOYMENT_LOCK="${RR_DEPLOYMENT_LOCK:-/tmp/recruiter-radar-deployment.lock}"
ROLLBACK_DIR=""
ROLLBACK_STARTED=0
ROLLBACK_COMPLETED=0
VERIFY_PASSED=0
APPLIED=0
RUNTIME_DIR_CREATED=0
ENV_TMP=""
OVERRIDE_TMP=""
RUNTIME_TMP=""
LOCK_FD=9

usage() {
  cat <<'USAGE'
Usage: configure-telegram-runtime.sh --key-file /path/to/telegram-env.b64

--key-file   base64(w0) file containing exactly three lines:
             TELEGRAM_API_ID=<digits>
             TELEGRAM_API_HASH=<32 lowercase hex>
             TELEGRAM_SESSION=<single-line base64/base64url session string>

The script atomically updates the Compose Telegram runtime configuration and
live-verifies that the web container can connect and authorize with Telegram.
Every mutation is backed up first; if any verification fails, the previous
configuration is restored and the stack is recreated from the restored files.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --key-file)
      [ $# -ge 2 ] || { echo "Error: --key-file requires a value." >&2; exit 2; }
      KEY_FILE="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument '$1'." >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$KEY_FILE" ]; then
  echo "Error: --key-file is required." >&2
  usage >&2
  exit 2
fi

if [ ! -d "$APP_DIR" ]; then
  echo "Error: app directory $APP_DIR does not exist." >&2
  exit 1
fi

if [ ! -f "$KEY_FILE" ]; then
  echo "Error: key file '$KEY_FILE' does not exist." >&2
  exit 1
fi

for cmd in docker base64 flock sha256sum awk sed grep curl mktemp seq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command '$cmd' is not available." >&2
    exit 1
  fi
done

# Serialize with deploys/rollbacks/refreshes on the same host (flock(1) is
# atomic across SSH sessions; mkdir races are not). Same lock path as
# deploy.yml / recover-deployment.sh / run-government-source-sync.sh.
exec {LOCK_FD}>>"$DEPLOYMENT_LOCK"
if ! flock -w 20 "$LOCK_FD"; then
  echo '{"telegramRuntimeConfigured":false,"reason":"deployment-lock-timeout"}'
  exit 1
fi

strip_quotes() {
  local value="$1"
  if [ "${value:0:1}" = '"' ] && [ "${value: -1}" = '"' ]; then
    value="${value:1:${#value}-2}"
  elif [ "${value:0:1}" = "'" ] && [ "${value: -1}" = "'" ]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

read_env_value() {
  local name="$1" file="$2" raw=""
  [ -f "$file" ] || return 0
  raw="$(sed -n "s/^${name}=//p" "$file" | tail -1)"
  strip_quotes "$raw"
}

destroy_secret_file() {
  local target="$1"
  if [ -z "$target" ] || [ ! -f "$target" ]; then
    return 0
  fi
  if command -v shred >/dev/null 2>&1; then
    shred -u -- "$target" 2>/dev/null || rm -f -- "$target"
  else
    rm -f -- "$target"
  fi
}

cleanup() {
  destroy_secret_file "$KEY_FILE"
  if [ -n "$ENV_TMP" ]; then rm -f -- "$ENV_TMP" 2>/dev/null || true; fi
  if [ -n "$OVERRIDE_TMP" ]; then rm -f -- "$OVERRIDE_TMP" 2>/dev/null || true; fi
  if [ -n "$RUNTIME_TMP" ]; then rm -f -- "$RUNTIME_TMP" 2>/dev/null || true; fi
  if [ -n "$ROLLBACK_DIR" ] && [ -d "$ROLLBACK_DIR" ]; then
    if [ "$VERIFY_PASSED" = 1 ] || [ "$ROLLBACK_COMPLETED" = 1 ]; then
      # Backed-up production .env and runtime credentials are secrets:
      # destroy them as soon as they are no longer needed.
      destroy_secret_file "$ROLLBACK_DIR/env"
      destroy_secret_file "$ROLLBACK_DIR/runtime-env"
      rm -rf -- "$ROLLBACK_DIR" 2>/dev/null || true
    else
      chmod 700 "$ROLLBACK_DIR" 2>/dev/null || true
      echo "Rollback backups preserved for manual recovery in $ROLLBACK_DIR" >&2
    fi
  fi
  return 0
}
trap cleanup EXIT

wait_for_health() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      printf '{"telegramHealthVerified":true,"attempts":%s}\n' "$attempt"
      return 0
    fi
    sleep "$HEALTH_INTERVAL_SECONDS"
  done
  printf '{"telegramHealthVerified":false}\n'
  return 1
}

backup_file() { # $1=live path, $2=backup base name
  if [ -f "$1" ]; then
    cp -p -- "$1" "$ROLLBACK_DIR/$2"
    chmod 600 "$ROLLBACK_DIR/$2" 2>/dev/null || true
    printf 'present\n' > "$ROLLBACK_DIR/$2.flag"
  else
    printf 'absent\n' > "$ROLLBACK_DIR/$2.flag"
  fi
}

restore_file() { # $1=live path, $2=backup base name
  if [ ! -f "$ROLLBACK_DIR/$2.flag" ]; then
    echo "Rollback metadata for '$2' is missing; cannot restore safely." >&2
    return 1
  fi
  if [ "$(cat "$ROLLBACK_DIR/$2.flag")" = "present" ]; then
    cp -p -- "$ROLLBACK_DIR/$2" "$1"
    chmod 600 "$1" 2>/dev/null || true
  else
    rm -f -- "$1"
  fi
}

compose_args=()

resolve_compose_chain() { # $1=env file to read COMPOSE_FILE from (may be empty)
  local chain="" entry
  compose_args=()
  if [ -n "${1:-}" ] && [ -f "${1:-}" ]; then
    chain="$(read_env_value COMPOSE_FILE "${1:-}")"
  fi
  if [ -n "$chain" ]; then
    local IFS=':'
    for entry in $chain; do
      compose_args+=(-f "$APP_DIR/$entry")
    done
    return 0
  fi
  local candidate
  for candidate in compose.yaml docker-compose.yml docker-compose.yaml; do
    if [ -f "$APP_DIR/$candidate" ]; then
      compose_args+=(-f "$APP_DIR/$candidate")
      break
    fi
  done
  if [ -f "$APP_DIR/compose.override.yml" ]; then
    compose_args+=(-f "$APP_DIR/compose.override.yml")
  fi
}

rollback() { # $1=reason
  local reason="${1:-verification failure}"
  if [ "$ROLLBACK_STARTED" = 1 ]; then
    return 0
  fi
  ROLLBACK_STARTED=1
  echo "Telegram runtime configuration failed ($reason); restoring previous production state." >&2
  if [ -z "$ROLLBACK_DIR" ] || [ ! -d "$ROLLBACK_DIR" ]; then
    echo "CRITICAL: rollback directory is unavailable; manual recovery required." >&2
    return 1
  fi
  local restore_failed=0
  restore_file "$ENV_FILE" env || restore_failed=1
  restore_file "$TELEGRAM_OVERRIDE" override || restore_failed=1
  restore_file "$RUNTIME_ENV" runtime-env || restore_failed=1
  if [ "$RUNTIME_DIR_CREATED" = 1 ] && [ -d "$RUNTIME_DIR" ]; then
    rmdir "$RUNTIME_DIR" 2>/dev/null || true
  fi
  if [ "$restore_failed" = 1 ]; then
    echo "CRITICAL: file restore failed; backups preserved in $ROLLBACK_DIR." >&2
    return 1
  fi
  if [ "$APPLIED" != 1 ]; then
    # Live Compose configuration was never swapped: the running container
    # still matches the restored disk state, so no recreate is needed.
    echo "Rollback completed before the live configuration was applied; containers untouched." >&2
    ROLLBACK_COMPLETED=1
    return 0
  fi
  resolve_compose_chain "$ENV_FILE"
  if [ "${#compose_args[@]}" -eq 0 ]; then
    echo "WARNING: no Compose chain resolvable after restore; leaving containers untouched." >&2
    ROLLBACK_COMPLETED=1
    return 0
  fi
  if docker compose --env-file "$ENV_FILE" "${compose_args[@]}" up -d --force-recreate web >&2; then
    if wait_for_health >&2; then
      echo "Rollback completed; previous configuration is live again." >&2
      ROLLBACK_COMPLETED=1
      return 0
    fi
    echo "CRITICAL: health check failed after rollback; manual recovery required (backups in $ROLLBACK_DIR)." >&2
    return 1
  fi
  echo "CRITICAL: Compose recreate failed during rollback; backups preserved in $ROLLBACK_DIR." >&2
  return 1
}

on_interrupt() {
  trap - INT TERM
  echo "Caught interrupt; attempting rollback before exit." >&2
  rollback 'interrupted' || true
  exit 130
}

fail_with_rollback() { # $1=reason
  rollback "$1" || true
  exit 1
}

# --- Decode and preflight the credential bundle (before ANY mutation) -------

decoded_bundle="$(base64 -d "$KEY_FILE")"

telegram_api_id="$(printf '%s\n' "$decoded_bundle" | sed -n 's/^TELEGRAM_API_ID=//p' | tail -1)"
telegram_api_hash="$(printf '%s\n' "$decoded_bundle" | sed -n 's/^TELEGRAM_API_HASH=//p' | tail -1)"
telegram_session="$(printf '%s\n' "$decoded_bundle" | sed -n 's/^TELEGRAM_SESSION=//p' | tail -1)"

if [ -z "$telegram_api_id" ]; then
  echo "Error: TELEGRAM_API_ID is missing or empty in the bundle." >&2
  exit 1
fi
if ! printf '%s' "$telegram_api_id" | grep -Eq '^[0-9]+$'; then
  echo "Error: TELEGRAM_API_ID must be numeric." >&2
  exit 1
fi

if [ -z "$telegram_api_hash" ]; then
  echo "Error: TELEGRAM_API_HASH is missing or empty in the bundle." >&2
  exit 1
fi
if ! printf '%s' "$telegram_api_hash" | grep -Eq '^[a-f0-9]{32}$'; then
  echo "Error: TELEGRAM_API_HASH must be 32 lowercase hex characters." >&2
  exit 1
fi

if [ -z "$telegram_session" ]; then
  echo "Error: TELEGRAM_SESSION is missing or empty in the bundle." >&2
  exit 1
fi
# Compose env_file parsing must stay unambiguous: reject whitespace, quotes
# and any character outside the base64/base64url alphabet a StringSession
# save() can produce.
if ! printf '%s' "$telegram_session" | grep -Eq '^[A-Za-z0-9+/=_-]+$'; then
  echo "Error: TELEGRAM_SESSION contains characters outside the expected single-line base64/base64url alphabet." >&2
  exit 1
fi
if [ "${#telegram_session}" -lt 16 ]; then
  echo "Error: TELEGRAM_SESSION is too short to be a valid saved session string." >&2
  exit 1
fi

# The bundle is fully decoded and validated: destroy it immediately to
# minimize the credential lifetime on this host.
destroy_secret_file "$KEY_FILE"
KEY_FILE=''
unset decoded_bundle

# --- Resolve the candidate Compose chain (no mutation yet) ------------------

current_chain="$(read_env_value COMPOSE_FILE "$ENV_FILE")"
if [ -n "$current_chain" ]; then
  IFS=':' read -r -a current_files <<< "$current_chain"
else
  current_files=()
  for candidate in compose.yaml docker-compose.yml docker-compose.yaml; do
    if [ -f "$APP_DIR/$candidate" ]; then
      current_files=("$candidate")
      break
    fi
  done
  if [ -f "$APP_DIR/compose.override.yml" ]; then
    current_files+=(compose.override.yml)
  fi
fi

if [ "${#current_files[@]}" -eq 0 ]; then
  echo "Error: cannot resolve any Compose file in $APP_DIR." >&2
  exit 1
fi

configured_compose_files=()
telegram_override_present=0
for entry in ${current_files[@]+"${current_files[@]}"}; do
  if [ "$entry" = ".rr-telegram.compose.yml" ]; then
    telegram_override_present=1
  fi
  configured_compose_files+=("$entry")
done
if [ "$telegram_override_present" != 1 ]; then
  configured_compose_files+=(".rr-telegram.compose.yml")
fi
new_chain="$(IFS=:; echo "${configured_compose_files[*]}")"

# --- Back up the live state before any mutation (F4) ------------------------

ROLLBACK_DIR="$(mktemp -d "$APP_DIR/.rr-telegram-rollback.XXXXXX")"
chmod 700 "$ROLLBACK_DIR"
backup_file "$ENV_FILE" env
backup_file "$TELEGRAM_OVERRIDE" override
if [ ! -d "$RUNTIME_DIR" ]; then
  RUNTIME_DIR_CREATED=1
fi
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
backup_file "$RUNTIME_ENV" runtime-env

trap on_interrupt INT TERM

# --- Write candidate files aside --------------------------------------------

ENV_TMP="$(mktemp "$APP_DIR/.rr-telegram.env.XXXXXX")"
OVERRIDE_TMP="$(mktemp "$APP_DIR/.rr-telegram.compose.XXXXXX")"
RUNTIME_TMP="$(mktemp "$APP_DIR/.rr-telegram.runtime.XXXXXX")"
chmod 600 "$ENV_TMP" "$OVERRIDE_TMP" "$RUNTIME_TMP"

cat > "$ENV_TMP" <<EOF
$(if [ -f "$ENV_FILE" ]; then
  sed '/^COMPOSE_FILE=/d' "$ENV_FILE"
else
  :
fi)
COMPOSE_FILE=$new_chain
EOF

cat > "$OVERRIDE_TMP" <<'EOF'
# Recruiter Radar - Telegram MTProto runtime credentials (generated).
# Values are injected via Compose env_file only; the file itself is NOT
# bind-mounted into the container. Runtime verification therefore compares
# a canonical sha256 digest of the container's injected environment against
# the host file digest, without echoing secret values.
services:
  web:
    env_file:
      - config/tg-runtime/.env
EOF

cat > "$RUNTIME_TMP" <<EOF
TELEGRAM_API_ID=$telegram_api_id
TELEGRAM_API_HASH=$telegram_api_hash
TELEGRAM_SESSION=$telegram_session
EOF

# --- Staged application with preflight and rollback --------------------------

# 1) Runtime credential file first: the Compose `config` preflight resolves
#    the override's env_file reference. The running container is unaffected
#    until it is recreated below.
mv -- "$RUNTIME_TMP" "$RUNTIME_ENV"
RUNTIME_TMP=''
chmod 600 "$RUNTIME_ENV"

# 2) Candidate preflight (F4): validate the exact candidate configuration
#    BEFORE the active .env / override are swapped.
preflight_args=()
for entry in "${configured_compose_files[@]}"; do
  if [ "$entry" = ".rr-telegram.compose.yml" ]; then
    preflight_args+=(-f "$OVERRIDE_TMP")
  else
    preflight_args+=(-f "$APP_DIR/$entry")
  fi
done
if ! docker compose --env-file "$ENV_TMP" "${preflight_args[@]}" config >/dev/null; then
  fail_with_rollback 'candidate Compose config preflight failed'
fi

# 3) Swap the active configuration.
mv -- "$ENV_TMP" "$ENV_FILE"
ENV_TMP=''
mv -- "$OVERRIDE_TMP" "$TELEGRAM_OVERRIDE"
OVERRIDE_TMP=''
chmod 600 "$ENV_FILE" "$TELEGRAM_OVERRIDE"
APPLIED=1

# 4) Apply to the live stack.
resolve_compose_chain "$ENV_FILE"
if [ "${#compose_args[@]}" -eq 0 ]; then
  fail_with_rollback 'no Compose chain resolvable after applying the new configuration'
fi
if ! docker compose --env-file "$ENV_FILE" "${compose_args[@]}" config >/dev/null; then
  fail_with_rollback 'applied Compose config validation failed'
fi
if ! docker compose --env-file "$ENV_FILE" "${compose_args[@]}" up -d --force-recreate web; then
  fail_with_rollback 'Compose recreate failed'
fi

# --- Verification battery (any failure triggers rollback) -------------------

# V1: web port must stay loopback-bound.
published="$(docker compose --env-file "$ENV_FILE" "${compose_args[@]}" port web 3000 || true)"
if [ "$published" != "127.0.0.1:3000" ]; then
  fail_with_rollback "port check reported '$published' instead of 127.0.0.1:3000"
fi

# V2: health endpoint must recover.
if ! wait_for_health >/dev/null; then
  fail_with_rollback 'health endpoint did not recover'
fi

# V3 (F3): credential digest agreement between the host runtime file and the
# environment Compose actually injected into the web container. The container
# recomputes the canonical digest internally; only the digest is printed, so
# secret values never cross the process boundary. Canonical form matches the
# runtime env file byte-for-byte (three KEY=VALUE lines, trailing newline).
host_sha="$(sha256sum -- "$RUNTIME_ENV" | awk '{print $1}')"
container_sha=""
if ! container_sha="$(docker compose --env-file "$ENV_FILE" "${compose_args[@]}" exec -T web sh -c \
  'printf "TELEGRAM_API_ID=%s\nTELEGRAM_API_HASH=%s\nTELEGRAM_SESSION=%s\n" "${TELEGRAM_API_ID-}" "${TELEGRAM_API_HASH-}" "${TELEGRAM_SESSION-}" | sha256sum' \
  | awk '{print $1}')"; then
  container_sha=""
fi
if [ -z "$container_sha" ] || [ "$host_sha" != "$container_sha" ]; then
  fail_with_rollback 'runtime credential digest mismatch between host file and web container environment'
fi

# V4: live MTProto authorization from inside the web runtime.
if ! docker compose --env-file "$ENV_FILE" "${compose_args[@]}" exec -T web node --input-type=module -e '
  const apiId = process.env.TELEGRAM_API_ID?.trim() || "";
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() || "";
  const session = process.env.TELEGRAM_SESSION?.trim() || "";
  if (!apiId || !apiHash || !session) throw new Error("Telegram credentials are not available in the web runtime.");
  const { TelegramClient, sessions } = await import("teleproto");
  const client = new TelegramClient(new sessions.StringSession(session), Number(apiId), apiHash, { connectionRetries: 1, autoReconnect: false });
  try {
    await client.connect();
    const authorized = await client.checkAuthorization();
    if (!authorized) throw new Error("Telegram session is not authorized.");
    console.log(JSON.stringify({ telegramAuthorized: true, apiId: Number(apiId), apiHashLength: apiHash.length }));
  } finally {
    await client.disconnect().catch(() => {});
  }
'; then
  fail_with_rollback 'live Telegram authorization check failed'
fi

# --- Success -----------------------------------------------------------------

trap - INT TERM
VERIFY_PASSED=1
printf '{"telegramRuntimeConfigured":true,"envFile":"%s","composeOverride":"%s","runtimeEnv":"%s","composeFile":"%s"}\n' \
  "$ENV_FILE" "$TELEGRAM_OVERRIDE" "$RUNTIME_ENV" "$new_chain"
