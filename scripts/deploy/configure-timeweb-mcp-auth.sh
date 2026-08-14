#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
AUTH_ENV="$APP_DIR/.rr-timeweb-auth.env"
AUTH_OVERRIDE="$APP_DIR/.rr-timeweb-auth.compose.yml"
AUTH_DB_PASSWORD_FILE="/var/lib/recruiter-radar-operator/auth-db-password"
AUTH_SECRET_DIR="/var/lib/recruiter-radar-operator/auth-secrets"
AUTH_JWKS_FILE="$AUTH_SECRET_DIR/jwks.json"
AUTH_COOKIE_KEYS_FILE="$AUTH_SECRET_DIR/cookie-keys.json"
DB_CONTAINER="recruiter-radar-db-1"
AUTH_CONTAINER="recruiter-radar-operator-auth-1"
EXPECTED_ISSUER="https://recruiter-radar.ru/operator/oauth"
EXPECTED_RESOURCE="https://recruiter-radar.ru/api/internal/timeweb-mcp"
EXPECTED_SUBJECT="rr_owner"
preflight_only=false

case "${1:-}" in
  "") ;;
  --preflight) preflight_only=true ;;
  *) echo "Usage: $0 [--preflight]" >&2; exit 2 ;;
esac

cd "$APP_DIR"
[ -f "$ENV_FILE" ] || { echo "Production .env is missing" >&2; exit 1; }

strip_quotes() {
  local value="$1"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}
read_env_value() {
  local key="$1" source="$2" value=""
  if [ -f "$source" ]; then value="$(sed -n "s/^${key}=//p" "$source" | tail -n 1)"; fi
  strip_quotes "$value"
}

resolve_compose_args() {
  compose_args=()
  local configured="${COMPOSE_FILE:-}"
  if [ -z "$configured" ]; then configured="$(read_env_value COMPOSE_FILE "$ENV_FILE")"; fi
  if [ -n "$configured" ]; then
    IFS=':' read -r -a files <<< "$configured"
    for file in "${files[@]}"; do
      if [ -n "$file" ]; then compose_args+=(-f "$file"); fi
    done
  else
    local base="" candidate override=""
    for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
      if [ -f "$candidate" ]; then base="$candidate"; break; fi
    done
    [ -n "$base" ] || { echo "No Docker Compose file found in $APP_DIR" >&2; exit 1; }
    compose_args+=(-f "$base")
    case "$base" in
      compose.yaml) override="compose.override.yaml" ;;
      compose.yml) override="compose.override.yml" ;;
      docker-compose.yaml) override="docker-compose.override.yaml" ;;
      docker-compose.yml) override="docker-compose.override.yml" ;;
    esac
    if [ -n "$override" ] && [ -f "$override" ]; then compose_args+=(-f "$override"); fi
  fi
  if [ -f "$APP_DIR/.rr-notification-key.compose.yml" ]; then
    compose_args+=(-f "$APP_DIR/.rr-notification-key.compose.yml")
  fi
  if [ -f "$APP_DIR/.rr-timeweb-mcp.compose.yml" ]; then
    compose_args+=(-f "$APP_DIR/.rr-timeweb-mcp.compose.yml")
  fi
}
resolve_compose_args

provider="${RR_OPERATOR_AUTH_PROVIDER:-local_oidc}"
issuer="${RR_MCP_OAUTH_ISSUER:-$EXPECTED_ISSUER}"
resource="${RR_TIMEWEB_MCP_RESOURCE:-$EXPECTED_RESOURCE}"
subjects="${RR_MCP_ALLOWED_SUBJECTS:-$EXPECTED_SUBJECT}"
auth_image="${RR_OPERATOR_AUTH_IMAGE:-}"
deploy_sha="${RR_DEPLOY_SHA:-${DEPLOY_SHA:-$(read_env_value RR_DEPLOY_SHA "$ENV_FILE")}}"
owner_hash_file="${RR_MCP_OWNER_PASSWORD_HASH_FILE:-}"

[ "$provider" = local_oidc ] || { echo "RR_OPERATOR_AUTH_PROVIDER must be local_oidc" >&2; exit 1; }
[ "$issuer" = "$EXPECTED_ISSUER" ] || { echo "OAuth issuer mismatch" >&2; exit 1; }
[ "$resource" = "$EXPECTED_RESOURCE" ] || { echo "Timeweb MCP resource mismatch" >&2; exit 1; }
[ "$subjects" = "$EXPECTED_SUBJECT" ] || { echo "OAuth owner subject must be rr_owner" >&2; exit 1; }
[[ "$deploy_sha" =~ ^[A-Fa-f0-9]{40}$ ]] || { echo "RR_DEPLOY_SHA must be a full commit SHA" >&2; exit 1; }
[ -n "$auth_image" ] && [[ "$auth_image" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]+$ ]] || { echo "RR_OPERATOR_AUTH_IMAGE is required and must be safe" >&2; exit 1; }
[ -n "$owner_hash_file" ] && [ -f "$owner_hash_file" ] || { echo "Owner password hash file is required" >&2; exit 1; }
owner_hash="$(cat "$owner_hash_file")"
[[ "$owner_hash" == \$argon2id\$* ]] || { echo "Owner password hash must be Argon2id" >&2; exit 1; }
[ "${#owner_hash}" -le 512 ] || { echo "Owner password hash is unexpectedly long" >&2; exit 1; }

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || { echo "Production database container is unavailable" >&2; exit 1; }
if [ "$preflight_only" != true ]; then docker image inspect "$auth_image" >/dev/null 2>&1 || { echo "Timeweb OAuth image is unavailable" >&2; exit 1; }; fi

db_name="$(docker exec "$DB_CONTAINER" sh -ceu 'printf %s "${POSTGRES_DB:-postgres}"')"
[[ "$db_name" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || { echo "Unsupported production database name" >&2; exit 1; }

umask 077
state_dir="$(dirname "$AUTH_DB_PASSWORD_FILE")"
if [ -f "$AUTH_DB_PASSWORD_FILE" ]; then
  auth_db_password="$(cat "$AUTH_DB_PASSWORD_FILE")"
elif [ "$preflight_only" = true ]; then
  auth_db_password="$(printf 'a%.0s' {1..64})"
else
  install -d -m 0700 -o root -g root "$state_dir"
  auth_db_password="$(openssl rand -hex 32)"
  printf '%s\n' "$auth_db_password" > "$AUTH_DB_PASSWORD_FILE"
  chmod 0600 "$AUTH_DB_PASSWORD_FILE"
fi
[[ "$auth_db_password" =~ ^[a-f0-9]{64}$ ]] || { echo "OAuth database credential is malformed" >&2; exit 1; }

if getent group rr-operator-auth >/dev/null 2>&1; then
  auth_gid="$(getent group rr-operator-auth | cut -d: -f3)"
elif [ "$preflight_only" = true ]; then
  auth_gid=65002
else
  groupadd --system rr-operator-auth
  auth_gid="$(getent group rr-operator-auth | cut -d: -f3)"
fi
[[ "$auth_gid" =~ ^[0-9]+$ ]] || { echo "OAuth group GID is invalid" >&2; exit 1; }

if [ "$preflight_only" != true ]; then
  install -d -m 0750 -o root -g "$auth_gid" "$AUTH_SECRET_DIR"
  if [ ! -s "$AUTH_JWKS_FILE" ]; then
    node - "$AUTH_JWKS_FILE" <<'NODE'
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const path = process.argv[2];
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
fs.writeFileSync(path, JSON.stringify({ keys: [{ ...jwk, kid: `rr-timeweb-${Date.now()}`, alg: 'ES256', use: 'sig' }] }), { mode: 0o640 });
NODE
  fi
  if [ ! -s "$AUTH_COOKIE_KEYS_FILE" ]; then
    node - "$AUTH_COOKIE_KEYS_FILE" <<'NODE'
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], JSON.stringify([randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')]), { mode: 0o640 });
NODE
  fi
  chown root:"$auth_gid" "$AUTH_JWKS_FILE" "$AUTH_COOKIE_KEYS_FILE"
  chmod 0640 "$AUTH_JWKS_FILE" "$AUTH_COOKIE_KEYS_FILE"
fi

auth_env_tmp="$(mktemp "$APP_DIR/.rr-timeweb-auth.env.XXXXXX")"
override_tmp="$(mktemp "$APP_DIR/.rr-timeweb-auth.compose.XXXXXX")"
cleanup() { rm -f "$auth_env_tmp" "$override_tmp"; }
trap cleanup EXIT

cat > "$auth_env_tmp" <<EOF
NODE_ENV=production
RR_OPERATOR_AUTH_PROVIDER=local_oidc
RR_MCP_OAUTH_ISSUER=${EXPECTED_ISSUER}
RR_TIMEWEB_MCP_RESOURCE=${EXPECTED_RESOURCE}
RR_MCP_ALLOWED_SUBJECTS=${EXPECTED_SUBJECT}
RR_MCP_OWNER_PASSWORD_HASH='${owner_hash}'
RR_MCP_AUTH_DATABASE_URL=postgresql://rr_operator_auth:${auth_db_password}@db:5432/${db_name}
RR_MCP_OAUTH_JWKS_FILE=/run/secrets/rr-operator-auth/jwks.json
RR_MCP_OAUTH_COOKIE_KEYS_FILE=/run/secrets/rr-operator-auth/cookie-keys.json
EOF
chmod 0600 "$auth_env_tmp"

write_override() {
  local target="$1" env_path="$2"
  cat > "$target" <<EOF
services:
  operator-auth:
    image: ${auth_image}
    restart: unless-stopped
    ports:
      - "127.0.0.1:3002:3002"
    env_file:
      - ${env_path}
    volumes:
      - ${AUTH_SECRET_DIR}:/run/secrets/rr-operator-auth:ro
    group_add:
      - "${auth_gid}"
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=16m
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
EOF
  chmod 0600 "$target"
}
write_override "$override_tmp" "$auth_env_tmp"
preflight_args=("${compose_args[@]}" -f "$override_tmp")
docker compose --env-file "$ENV_FILE" "${preflight_args[@]}" config >/dev/null

if [ "$preflight_only" = true ]; then
  unset owner_hash auth_db_password
  echo "Timeweb OAuth runtime preflight passed."
  exit 0
fi

{
  cat <<'SQL_HEAD'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rr_operator_auth') THEN
    CREATE ROLE rr_operator_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE rr_operator_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
ALTER ROLE rr_operator_auth SET statement_timeout = '5s';
SQL_HEAD
  printf "ALTER ROLE rr_operator_auth PASSWORD '%s';\n" "$auth_db_password"
  cat <<'SQL_BODY'
CREATE SCHEMA IF NOT EXISTS operator_auth;
CREATE TABLE IF NOT EXISTS operator_auth.oidc_store (
  model text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
  expires_at timestamptz, consumed_at timestamptz, grant_id text, user_code text, uid text,
  PRIMARY KEY (model, id)
);
CREATE INDEX IF NOT EXISTS oidc_store_grant_idx ON operator_auth.oidc_store(model, grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS oidc_store_user_code_idx ON operator_auth.oidc_store(model, user_code) WHERE user_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS oidc_store_uid_idx ON operator_auth.oidc_store(model, uid) WHERE uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS oidc_store_expires_idx ON operator_auth.oidc_store(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS operator_auth.login_throttle (
  throttle_key text PRIMARY KEY, failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA operator_auth TO rr_operator_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA operator_auth TO rr_operator_auth;
SQL_BODY
} | docker exec -i "$DB_CONTAINER" sh -ceu 'exec psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"' >/dev/null

mv "$auth_env_tmp" "$AUTH_ENV"; auth_env_tmp=""
write_override "$override_tmp" "$AUTH_ENV"
mv "$override_tmp" "$AUTH_OVERRIDE"; override_tmp=""
trap - EXIT

runtime_args=("${compose_args[@]}" -f "$AUTH_OVERRIDE")
docker compose --env-file "$ENV_FILE" "${runtime_args[@]}" up -d --force-recreate operator-auth

wait_for_auth_health() {
  local attempt state
  for attempt in $(seq 1 45); do
    if curl -fsS --max-time 2 http://127.0.0.1:3002/healthz >/dev/null 2>&1; then
      return 0
    fi
    state="$(docker inspect -f '{{.State.Status}}' "$AUTH_CONTAINER" 2>/dev/null || true)"
    if [ "$state" = "exited" ] || [ "$state" = "dead" ]; then
      break
    fi
    sleep 1
  done
  echo "Timeweb OAuth service did not become ready" >&2
  docker inspect -f 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$AUTH_CONTAINER" >&2 2>/dev/null || true
  return 1
}
wait_for_auth_health

docker exec "$AUTH_CONTAINER" node -e '
  if (process.env.RR_OPERATOR_AUTH_PROVIDER !== "local_oidc") process.exit(1);
  if (process.env.RR_MCP_OAUTH_ISSUER !== "https://recruiter-radar.ru/operator/oauth") process.exit(1);
  if (process.env.RR_TIMEWEB_MCP_RESOURCE !== "https://recruiter-radar.ru/api/internal/timeweb-mcp") process.exit(1);
  if (process.env.RR_MCP_ALLOWED_SUBJECTS !== "rr_owner") process.exit(1);
  if ((process.env.RR_MCP_OWNER_PASSWORD_HASH || "").startsWith("$argon2id$") !== true) process.exit(1);
'

# Remove the legacy operational MCP runtime and host agent only after the new
# OAuth service has passed readiness and its runtime contract is verified.
docker rm -f recruiter-radar-operator-1 >/dev/null 2>&1 || true
if systemctl list-unit-files rr-operator-agent.service >/dev/null 2>&1; then
  systemctl disable --now rr-operator-agent.service >/dev/null 2>&1 || true
fi

unset owner_hash auth_db_password

echo "Timeweb OAuth service is active; legacy operator runtime is stopped."
