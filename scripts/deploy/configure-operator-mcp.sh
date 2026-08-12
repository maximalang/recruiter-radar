#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
OPERATOR_ENV="$APP_DIR/.rr-operator.env"
AUTH_ENV="$APP_DIR/.rr-operator-auth.env"
OPERATOR_OVERRIDE="$APP_DIR/.rr-operator.compose.yml"
DB_PASSWORD_FILE="/var/lib/recruiter-radar-operator/db-password"
AUTH_DB_PASSWORD_FILE="/var/lib/recruiter-radar-operator/auth-db-password"
AUTH_SECRET_DIR="/var/lib/recruiter-radar-operator/auth-secrets"
AUTH_JWKS_FILE="$AUTH_SECRET_DIR/jwks.json"
AUTH_COOKIE_KEYS_FILE="$AUTH_SECRET_DIR/cookie-keys.json"
AGENT_INSTALL_DIR="/usr/local/lib/recruiter-radar-operator"
AGENT_INSTALL_PATH="$AGENT_INSTALL_DIR/rr-operator-agent.py"
AGENT_UNIT_PATH="/etc/systemd/system/rr-operator-agent.service"
AGENT_RUNTIME_DIR="/run/recruiter-radar-operator"
OPERATOR_GROUP="rr-operator"
AUTH_GROUP="rr-operator-auth"
DB_CONTAINER="recruiter-radar-db-1"
WEB_CONTAINER="recruiter-radar-web-1"
OPERATOR_CONTAINER="recruiter-radar-operator-1"
AUTH_CONTAINER="recruiter-radar-operator-auth-1"
EXPECTED_ISSUER="https://recruiter-radar.ru/operator/oauth"
EXPECTED_RESOURCE="https://recruiter-radar.ru/api/internal/mcp"
EXPECTED_SUBJECT="rr_owner"
preflight_only=false

case "${1:-}" in
  "") ;;
  --preflight) preflight_only=true ;;
  *) echo "Usage: $0 [--preflight]" >&2; exit 2 ;;
esac

cd "$APP_DIR"

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
  local configured_compose_files="${COMPOSE_FILE:-}"
  if [ -z "$configured_compose_files" ] && [ -f "$ENV_FILE" ]; then
    configured_compose_files="$(read_env_value COMPOSE_FILE "$ENV_FILE")"
  fi
  if [ -n "$configured_compose_files" ]; then
    local compose_file
    IFS=':' read -r -a compose_files <<< "$configured_compose_files"
    for compose_file in "${compose_files[@]}"; do compose_args+=(-f "$compose_file"); done
    return
  fi
  local base_compose="" candidate standard_override=""
  for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    if [ -f "$candidate" ]; then base_compose="$candidate"; break; fi
  done
  if [ -z "$base_compose" ]; then echo "No Docker Compose file found in $APP_DIR" >&2; exit 1; fi
  compose_args+=(-f "$base_compose")
  case "$base_compose" in
    compose.yaml) standard_override="compose.override.yaml" ;;
    compose.yml) standard_override="compose.override.yml" ;;
    docker-compose.yaml) standard_override="docker-compose.override.yaml" ;;
    docker-compose.yml) standard_override="docker-compose.override.yml" ;;
  esac
  if [ -n "$standard_override" ] && [ -f "$standard_override" ]; then compose_args+=(-f "$standard_override"); fi
  if [ -f "$APP_DIR/.rr-notification-key.compose.yml" ]; then compose_args+=(-f "$APP_DIR/.rr-notification-key.compose.yml"); fi
}

resolve_compose_args

provider="${RR_OPERATOR_AUTH_PROVIDER:-$(read_env_value RR_OPERATOR_AUTH_PROVIDER "$ENV_FILE")}"
mcp_enabled="${RR_MCP_ENABLED:-$(read_env_value RR_MCP_ENABLED "$ENV_FILE")}"; mcp_enabled="${mcp_enabled:-false}"
mutations_enabled="${RR_MCP_MUTATIONS_ENABLED:-$(read_env_value RR_MCP_MUTATIONS_ENABLED "$ENV_FILE")}"; mutations_enabled="${mutations_enabled:-false}"
oauth_issuer="${RR_MCP_OAUTH_ISSUER:-$(read_env_value RR_MCP_OAUTH_ISSUER "$ENV_FILE")}"
resource="${RR_MCP_RESOURCE:-$(read_env_value RR_MCP_RESOURCE "$ENV_FILE")}"
allowed_subjects="${RR_MCP_ALLOWED_SUBJECTS:-$(read_env_value RR_MCP_ALLOWED_SUBJECTS "$ENV_FILE")}"
deploy_sha="${RR_DEPLOY_SHA:-${DEPLOY_SHA:-$(read_env_value RR_DEPLOY_SHA "$ENV_FILE")}}"
auth_image="${RR_OPERATOR_AUTH_IMAGE:-}"
owner_hash_file="${RR_MCP_OWNER_PASSWORD_HASH_FILE:-}"

case "$mcp_enabled" in true | false) ;; *) echo "RR_MCP_ENABLED must be true or false" >&2; exit 1 ;; esac
case "$mutations_enabled" in true | false) ;; *) echo "RR_MCP_MUTATIONS_ENABLED must be true or false" >&2; exit 1 ;; esac
if [ "$mutations_enabled" = "true" ] && [ "$mcp_enabled" != "true" ]; then
  echo "RR_MCP_MUTATIONS_ENABLED cannot be true while MCP is disabled" >&2; exit 1
fi
if [ -n "$deploy_sha" ] && ! [[ "$deploy_sha" =~ ^[A-Fa-f0-9]{40}$ ]]; then echo "RR_DEPLOY_SHA must be a full commit SHA" >&2; exit 1; fi

if [ "$mcp_enabled" = "true" ]; then
  [ "$provider" = "local_oidc" ] || { echo "RR_OPERATOR_AUTH_PROVIDER must be local_oidc" >&2; exit 1; }
  [ "$oauth_issuer" = "$EXPECTED_ISSUER" ] || { echo "OAuth issuer mismatch" >&2; exit 1; }
  [ "$resource" = "$EXPECTED_RESOURCE" ] || { echo "MCP resource mismatch" >&2; exit 1; }
  [ "$allowed_subjects" = "$EXPECTED_SUBJECT" ] || { echo "Operator subject must be rr_owner" >&2; exit 1; }
  [ -n "$auth_image" ] || { echo "RR_OPERATOR_AUTH_IMAGE is required" >&2; exit 1; }
  [ -n "$owner_hash_file" ] && [ -f "$owner_hash_file" ] || { echo "Owner password hash file is required" >&2; exit 1; }
fi

owner_password_hash=""
if [ "$mcp_enabled" = "true" ]; then
  owner_password_hash="$(cat "$owner_hash_file")"
  [[ "$owner_password_hash" == \$argon2id\$* ]] || { echo "Owner password hash must be Argon2id" >&2; exit 1; }
  [ "${#owner_password_hash}" -le 512 ] || { echo "Owner password hash is unexpectedly long" >&2; exit 1; }
fi

if ! docker inspect "$WEB_CONTAINER" >/dev/null 2>&1; then echo "Production web container is unavailable" >&2; exit 1; fi
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then echo "Production database container is unavailable" >&2; exit 1; fi
operator_image="$(docker inspect --format '{{.Config.Image}}' "$WEB_CONTAINER")"
if [ -z "$operator_image" ] || [[ "$operator_image" =~ [[:space:]] ]] || ! [[ "$operator_image" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]+$ ]]; then
  echo "Current web image reference is unsafe or empty" >&2; exit 1
fi
if [ "$mcp_enabled" = "true" ] && (! [[ "$auth_image" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]+$ ]] || ! docker image inspect "$auth_image" >/dev/null 2>&1); then
  echo "Operator auth image is unavailable or unsafe" >&2; exit 1
fi

db_name="$(docker exec "$DB_CONTAINER" sh -ceu 'printf %s "${POSTGRES_DB:-postgres}"')"
[[ "$db_name" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || { echo "Unsupported production database name" >&2; exit 1; }

ensure_group_gid() {
  local name="$1" fallback="$2"
  if ! getent group "$name" >/dev/null 2>&1; then
    if [ "$preflight_only" = "true" ]; then printf '%s' "$fallback"; return; fi
    groupadd --system "$name"
  fi
  getent group "$name" | cut -d: -f3
}
operator_gid="$(ensure_group_gid "$OPERATOR_GROUP" 65001)"
auth_gid="$(ensure_group_gid "$AUTH_GROUP" 65002)"
[[ "$operator_gid" =~ ^[0-9]+$ && "$auth_gid" =~ ^[0-9]+$ ]] || { echo "Operator group GID is invalid" >&2; exit 1; }

umask 077
state_dir="$(dirname "$DB_PASSWORD_FILE")"
read_or_create_password() {
  local path="$1"
  if [ "$preflight_only" = "true" ]; then printf 'a%.0s' {1..64}; return; fi
  if [ -f "$path" ]; then cat "$path"; return; fi
  install -d -m 0700 -o root -g root "$state_dir"
  local generated; generated="$(openssl rand -hex 32)"
  printf '%s\n' "$generated" > "$path"; chmod 0600 "$path"; printf '%s' "$generated"
}
db_password="$(read_or_create_password "$DB_PASSWORD_FILE")"
auth_db_password="$(read_or_create_password "$AUTH_DB_PASSWORD_FILE")"
[[ "$db_password" =~ ^[a-f0-9]{64}$ && "$auth_db_password" =~ ^[a-f0-9]{64}$ ]] || { echo "Generated database credential is malformed" >&2; exit 1; }

operator_env_tmp="$(mktemp "$APP_DIR/.rr-operator.env.XXXXXX")"
auth_env_tmp="$(mktemp "$APP_DIR/.rr-operator-auth.env.XXXXXX")"
override_tmp="$(mktemp "$APP_DIR/.rr-operator.compose.XXXXXX")"
preflight_override_tmp="$(mktemp "$APP_DIR/.rr-operator.preflight.compose.XXXXXX")"
unit_tmp="$(mktemp "$APP_DIR/.rr-operator-agent.service.XXXXXX")"
cleanup() { rm -f "$operator_env_tmp" "$auth_env_tmp" "$override_tmp" "$preflight_override_tmp" "$unit_tmp"; }
trap cleanup EXIT

cat > "$operator_env_tmp" <<EOF
DATABASE_URL=postgresql://rr_operator_ro:${db_password}@db:5432/${db_name}
PUBLIC_APP_ORIGIN=https://recruiter-radar.ru
MIGRATE_ON_START=false
RR_OPERATOR_MODE=true
RR_MCP_ENABLED=${mcp_enabled}
RR_MCP_MUTATIONS_ENABLED=${mutations_enabled}
RR_MCP_OAUTH_ISSUER=${oauth_issuer}
RR_MCP_ALLOWED_SUBJECTS=${allowed_subjects}
RR_OPERATOR_AGENT_SOCKET=/run/recruiter-radar-operator/agent.sock
RR_DEPLOY_SHA=${deploy_sha}
EOF
chmod 0600 "$operator_env_tmp"

cat > "$auth_env_tmp" <<EOF
NODE_ENV=production
RR_OPERATOR_AUTH_PROVIDER=local_oidc
RR_MCP_OAUTH_ISSUER=${EXPECTED_ISSUER}
RR_MCP_RESOURCE=${EXPECTED_RESOURCE}
RR_MCP_ALLOWED_SUBJECTS=${EXPECTED_SUBJECT}
RR_MCP_OWNER_PASSWORD_HASH=${owner_password_hash}
RR_MCP_AUTH_DATABASE_URL=postgresql://rr_operator_auth:${auth_db_password}@db:5432/${db_name}
RR_MCP_OAUTH_JWKS_FILE=/run/secrets/rr-operator-auth/jwks.json
RR_MCP_OAUTH_COOKIE_KEYS_FILE=/run/secrets/rr-operator-auth/cookie-keys.json
EOF
chmod 0600 "$auth_env_tmp"

write_operator_override() {
  local target="$1" operator_env_path="$2" auth_env_path="$3"
  cat > "$target" <<EOF
services:
  operator:
    image: ${operator_image}
    restart: unless-stopped
    ports:
      - "127.0.0.1:3001:3000"
    env_file:
      - ${operator_env_path}
    environment:
      RR_OPERATOR_MODE: "true"
      MIGRATE_ON_START: "false"
    volumes:
      - ${AGENT_RUNTIME_DIR}:${AGENT_RUNTIME_DIR}:ro
    group_add:
      - "${operator_gid}"
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=32m
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
  operator-auth:
    image: ${auth_image:-operator-auth-disabled}
    restart: unless-stopped
    ports:
      - "127.0.0.1:3002:3002"
    env_file:
      - ${auth_env_path}
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
write_operator_override "$preflight_override_tmp" "$operator_env_tmp" "$auth_env_tmp"
write_operator_override "$override_tmp" "$OPERATOR_ENV" "$AUTH_ENV"

cat > "$unit_tmp" <<EOF
[Unit]
Description=Recruiter Radar allowlisted operator host agent
After=docker.service caddy.service
Requires=docker.service

[Service]
Type=simple
User=root
Group=root
ExecStart=/usr/bin/python3 ${AGENT_INSTALL_PATH}
Environment=RR_OPERATOR_MUTATIONS_ENABLED=${mutations_enabled}
Environment=PYTHONDONTWRITEBYTECODE=1
Restart=on-failure
RestartSec=2
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
RestrictNamespaces=yes
RestrictAddressFamilies=AF_UNIX
ReadWritePaths=${AGENT_RUNTIME_DIR} ${state_dir}
ReadOnlyPaths=/etc/caddy

[Install]
WantedBy=multi-user.target
EOF
chmod 0600 "$unit_tmp"

preflight_args=("${compose_args[@]}" -f "$preflight_override_tmp")
docker compose --env-file "$ENV_FILE" "${preflight_args[@]}" config >/dev/null
python3 -m py_compile "$APP_DIR/scripts/operator-mcp/rr-operator-agent.py"
if [ "$preflight_only" = "true" ]; then
  unset db_password auth_db_password owner_password_hash
  echo "Operator MCP local OAuth runtime preflight passed."
  exit 0
fi

# Product diagnostics role: read-only public schema only.
{
  cat <<'SQL_HEAD'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rr_operator_ro') THEN
    CREATE ROLE rr_operator_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE rr_operator_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
ALTER ROLE rr_operator_ro SET default_transaction_read_only = on;
ALTER ROLE rr_operator_ro SET statement_timeout = '5s';
SQL_HEAD
  printf "ALTER ROLE rr_operator_ro PASSWORD '%s';\n" "$db_password"
  cat <<SQL_BODY
REVOKE ALL PRIVILEGES ON DATABASE "${db_name}" FROM rr_operator_ro;
GRANT CONNECT ON DATABASE "${db_name}" TO rr_operator_ro;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM rr_operator_ro;
GRANT USAGE ON SCHEMA public TO rr_operator_ro;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM rr_operator_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rr_operator_ro;
DO \$\$ DECLARE owner_name text; BEGIN
  FOR owner_name IN SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO rr_operator_ro', owner_name);
  END LOOP;
END \$\$;
SQL_BODY
} | docker exec -i "$DB_CONTAINER" sh -ceu 'exec psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"' >/dev/null

# OAuth role: no product-table grants; write authority is confined to operator_auth.
{
  cat <<'SQL_HEAD'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rr_operator_auth') THEN
    CREATE ROLE rr_operator_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE rr_operator_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
ALTER ROLE rr_operator_auth SET statement_timeout = '5s';
ALTER ROLE rr_operator_auth SET search_path = operator_auth;
SQL_HEAD
  printf "ALTER ROLE rr_operator_auth PASSWORD '%s';\n" "$auth_db_password"
  cat <<SQL_BODY
REVOKE ALL PRIVILEGES ON DATABASE "${db_name}" FROM rr_operator_auth;
GRANT CONNECT ON DATABASE "${db_name}" TO rr_operator_auth;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM rr_operator_auth;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM rr_operator_auth;
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'operator_auth') THEN
    EXECUTE 'CREATE SCHEMA operator_auth AUTHORIZATION rr_operator_auth';
  END IF;
END \$\$;
ALTER SCHEMA operator_auth OWNER TO rr_operator_auth;
REVOKE ALL ON SCHEMA operator_auth FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA operator_auth TO rr_operator_auth;
SET ROLE rr_operator_auth;
CREATE TABLE IF NOT EXISTS operator_auth.oidc_store (
  model text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz,
  consumed_at timestamptz,
  grant_id text,
  user_code text,
  uid text,
  PRIMARY KEY (model, id)
);
CREATE INDEX IF NOT EXISTS oidc_store_grant_idx ON operator_auth.oidc_store(model, grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS oidc_store_user_code_idx ON operator_auth.oidc_store(model, user_code) WHERE user_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS oidc_store_uid_idx ON operator_auth.oidc_store(model, uid) WHERE uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS oidc_store_expires_idx ON operator_auth.oidc_store(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS operator_auth.login_throttle (
  throttle_key text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
RESET ROLE;
DO \$\$ BEGIN
  IF has_schema_privilege('rr_operator_auth', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'rr_operator_auth unexpectedly has CREATE on public schema';
  END IF;
END \$\$;
SQL_BODY
} | docker exec -i "$DB_CONTAINER" sh -ceu 'exec psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"' >/dev/null
unset db_password auth_db_password

install -d -m 0755 -o root -g root "$AGENT_INSTALL_DIR"
install -m 0700 -o root -g root "$APP_DIR/scripts/operator-mcp/rr-operator-agent.py" "$AGENT_INSTALL_PATH"
install -d -m 0770 -o root -g "$OPERATOR_GROUP" "$AGENT_RUNTIME_DIR"
install -m 0644 -o root -g root "$unit_tmp" "$AGENT_UNIT_PATH"
systemctl daemon-reload
systemctl enable --now rr-operator-agent.service
systemctl restart rr-operator-agent.service

if [ "$mcp_enabled" = "true" ]; then
  install -d -m 0750 -o root -g "$AUTH_GROUP" "$AUTH_SECRET_DIR"
  if [ ! -s "$AUTH_JWKS_FILE" ]; then
    jwks_tmp="$(mktemp "$AUTH_SECRET_DIR/jwks.XXXXXX")"
    docker run --rm --entrypoint node "$auth_image" -e '
      const { generateKeyPairSync, randomUUID } = require("node:crypto");
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const jwk = privateKey.export({ format: "jwk" });
      process.stdout.write(JSON.stringify({keys:[{...jwk,kid:`rr-${randomUUID()}`,alg:"ES256",use:"sig"}]}));
    ' > "$jwks_tmp"
    install -m 0640 -o root -g "$AUTH_GROUP" "$jwks_tmp" "$AUTH_JWKS_FILE"
    rm -f "$jwks_tmp"
  fi
  if [ ! -s "$AUTH_COOKIE_KEYS_FILE" ]; then
    cookie_tmp="$(mktemp "$AUTH_SECRET_DIR/cookies.XXXXXX")"
    printf '["%s","%s"]\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$cookie_tmp"
    install -m 0640 -o root -g "$AUTH_GROUP" "$cookie_tmp" "$AUTH_COOKIE_KEYS_FILE"
    rm -f "$cookie_tmp"
  fi
fi

mv "$operator_env_tmp" "$OPERATOR_ENV"; operator_env_tmp=""
mv "$auth_env_tmp" "$AUTH_ENV"; auth_env_tmp=""
mv "$override_tmp" "$OPERATOR_OVERRIDE"; override_tmp=""
chmod 0600 "$OPERATOR_ENV" "$AUTH_ENV" "$OPERATOR_OVERRIDE"
unset owner_password_hash

operator_compose_args=("${compose_args[@]}" -f "$OPERATOR_OVERRIDE")
if [ "$mcp_enabled" = "true" ]; then
  docker compose "${operator_compose_args[@]}" up -d --force-recreate operator operator-auth
else
  docker compose "${operator_compose_args[@]}" up -d --force-recreate operator
  docker compose "${operator_compose_args[@]}" rm -sf operator-auth >/dev/null 2>&1 || true
fi

published_operator_port="$(docker compose "${operator_compose_args[@]}" port operator 3000)"
[ "$published_operator_port" = "127.0.0.1:3001" ] || { echo "Operator port boundary is invalid" >&2; exit 1; }
if [ "$mcp_enabled" = "true" ]; then
  published_auth_port="$(docker compose "${operator_compose_args[@]}" port operator-auth 3002)"
  [ "$published_auth_port" = "127.0.0.1:3002" ] || { echo "Operator auth port boundary is invalid" >&2; exit 1; }
fi

for _ in $(seq 1 30); do
  operator_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$OPERATOR_CONTAINER" 2>/dev/null || true)"
  [ "$operator_health" = "healthy" ] || [ "$operator_health" = "running" ] && break
  sleep 1
done
operator_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$OPERATOR_CONTAINER")"
[ "$operator_health" = "healthy" ] || [ "$operator_health" = "running" ] || { echo "Operator service failed startup" >&2; exit 1; }

if [ "$mcp_enabled" = "true" ]; then
  for _ in $(seq 1 30); do
    auth_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$AUTH_CONTAINER" 2>/dev/null || true)"
    [ "$auth_health" = "healthy" ] && break
    sleep 1
  done
  auth_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$AUTH_CONTAINER")"
  [ "$auth_health" = "healthy" ] || { echo "Operator auth service failed health check" >&2; exit 1; }
else
  status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3001/api/internal/mcp -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')"
  [ "$status" = "404" ] || { echo "Disabled operator MCP did not fail dark" >&2; exit 1; }
fi

systemctl is-active --quiet rr-operator-agent.service
trap - EXIT
rm -f "$preflight_override_tmp" "$unit_tmp"
echo "Operator MCP configured with isolated read-only resource server, local OAuth service, isolated OAuth schema and bounded host agent."
