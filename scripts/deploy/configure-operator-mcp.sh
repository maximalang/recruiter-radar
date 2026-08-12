#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
OPERATOR_ENV="$APP_DIR/.rr-operator.env"
OPERATOR_OVERRIDE="$APP_DIR/.rr-operator.compose.yml"
DB_PASSWORD_FILE="/var/lib/recruiter-radar-operator/db-password"
AGENT_INSTALL_DIR="/usr/local/lib/recruiter-radar-operator"
AGENT_INSTALL_PATH="$AGENT_INSTALL_DIR/rr-operator-agent.py"
AGENT_UNIT_PATH="/etc/systemd/system/rr-operator-agent.service"
AGENT_RUNTIME_DIR="/run/recruiter-radar-operator"
OPERATOR_GROUP="rr-operator"
DB_CONTAINER="recruiter-radar-db-1"
WEB_CONTAINER="recruiter-radar-web-1"
OPERATOR_CONTAINER="recruiter-radar-operator-1"
preflight_only=false

case "${1:-}" in
  "") ;;
  --preflight) preflight_only=true ;;
  *)
    echo "Usage: $0 [--preflight]" >&2
    exit 2
    ;;
esac

cd "$APP_DIR"

strip_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

read_env_value() {
  local key="$1"
  local source="$2"
  local value=""
  if [ -f "$source" ]; then
    value="$(sed -n "s/^${key}=//p" "$source" | tail -n 1)"
  fi
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
    for compose_file in "${compose_files[@]}"; do
      compose_args+=(-f "$compose_file")
    done
    return
  fi

  local base_compose=""
  local candidate
  for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    if [ -f "$candidate" ]; then
      base_compose="$candidate"
      break
    fi
  done
  if [ -z "$base_compose" ]; then
    echo "No Docker Compose file found in $APP_DIR" >&2
    exit 1
  fi
  compose_args+=(-f "$base_compose")

  local standard_override=""
  case "$base_compose" in
    compose.yaml) standard_override="compose.override.yaml" ;;
    compose.yml) standard_override="compose.override.yml" ;;
    docker-compose.yaml) standard_override="docker-compose.override.yaml" ;;
    docker-compose.yml) standard_override="docker-compose.override.yml" ;;
  esac
  if [ -n "$standard_override" ] && [ -f "$standard_override" ]; then
    compose_args+=(-f "$standard_override")
  fi

  if [ -f "$APP_DIR/.rr-notification-key.compose.yml" ]; then
    compose_args+=(-f "$APP_DIR/.rr-notification-key.compose.yml")
  fi
}

resolve_compose_args

mcp_enabled="${RR_MCP_ENABLED:-$(read_env_value RR_MCP_ENABLED "$ENV_FILE")}"
mcp_enabled="${mcp_enabled:-false}"
mutations_enabled="${RR_MCP_MUTATIONS_ENABLED:-$(read_env_value RR_MCP_MUTATIONS_ENABLED "$ENV_FILE")}"
mutations_enabled="${mutations_enabled:-false}"
oauth_issuer="${RR_MCP_OAUTH_ISSUER:-$(read_env_value RR_MCP_OAUTH_ISSUER "$ENV_FILE")}"
allowed_subjects="${RR_MCP_OAUTH_ALLOWED_SUBJECTS:-$(read_env_value RR_MCP_OAUTH_ALLOWED_SUBJECTS "$ENV_FILE")}"
deploy_sha="${RR_DEPLOY_SHA:-${DEPLOY_SHA:-$(read_env_value RR_DEPLOY_SHA "$ENV_FILE")}}"

case "$mcp_enabled" in true | false) ;; *) echo "RR_MCP_ENABLED must be true or false" >&2; exit 1 ;; esac
case "$mutations_enabled" in true | false) ;; *) echo "RR_MCP_MUTATIONS_ENABLED must be true or false" >&2; exit 1 ;; esac

if [ "$mcp_enabled" = "true" ]; then
  if [ -z "$oauth_issuer" ] || [ -z "$allowed_subjects" ]; then
    echo "OAuth issuer and immutable allowed subject are required before enabling operator MCP" >&2
    exit 1
  fi
  case "$oauth_issuer" in https://*) ;; *) echo "OAuth issuer must use HTTPS" >&2; exit 1 ;; esac
  if [[ "$oauth_issuer" =~ [[:space:]] ]] || [[ "$allowed_subjects" =~ [[:space:]] ]]; then
    echo "OAuth issuer/subject configuration must not contain whitespace" >&2
    exit 1
  fi
fi

if [ "$mutations_enabled" = "true" ] && [ "$mcp_enabled" != "true" ]; then
  echo "RR_MCP_MUTATIONS_ENABLED cannot be true while MCP is disabled" >&2
  exit 1
fi
if [ -n "$deploy_sha" ] && ! [[ "$deploy_sha" =~ ^[A-Fa-f0-9]{40}$ ]]; then
  echo "RR_DEPLOY_SHA must be a full commit SHA" >&2
  exit 1
fi

if ! docker inspect "$WEB_CONTAINER" >/dev/null 2>&1; then
  echo "Production web container is not available; refusing operator bootstrap" >&2
  exit 1
fi
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "Production database container is not available; refusing operator bootstrap" >&2
  exit 1
fi

operator_image="$(docker inspect --format '{{.Config.Image}}' "$WEB_CONTAINER")"
if [ -z "$operator_image" ] || [[ "$operator_image" =~ [[:space:]] ]] || ! [[ "$operator_image" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]+$ ]]; then
  echo "Current web image reference is unsafe or empty; refusing operator bootstrap" >&2
  exit 1
fi

db_name="$(docker exec "$DB_CONTAINER" sh -ceu 'printf %s "${POSTGRES_DB:-postgres}"')"
if ! [[ "$db_name" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
  echo "Production database name is outside the supported identifier contract" >&2
  exit 1
fi

if ! getent group "$OPERATOR_GROUP" >/dev/null 2>&1; then
  if [ "$preflight_only" = "true" ]; then
    operator_gid="65001"
  else
    groupadd --system "$OPERATOR_GROUP"
    operator_gid="$(getent group "$OPERATOR_GROUP" | cut -d: -f3)"
  fi
else
  operator_gid="$(getent group "$OPERATOR_GROUP" | cut -d: -f3)"
fi
if ! [[ "$operator_gid" =~ ^[0-9]+$ ]]; then
  echo "Operator group GID is invalid" >&2
  exit 1
fi

umask 077
state_dir="$(dirname "$DB_PASSWORD_FILE")"
if [ "$preflight_only" = "true" ]; then
  db_password="$(printf 'a%.0s' {1..64})"
elif [ -f "$DB_PASSWORD_FILE" ]; then
  db_password="$(cat "$DB_PASSWORD_FILE")"
else
  install -d -m 0700 -o root -g root "$state_dir"
  db_password="$(openssl rand -hex 32)"
  printf '%s\n' "$db_password" > "$DB_PASSWORD_FILE"
  chmod 0600 "$DB_PASSWORD_FILE"
fi
if ! [[ "$db_password" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Operator database credential is malformed; refusing to continue" >&2
  exit 1
fi

operator_env_tmp="$(mktemp "$APP_DIR/.rr-operator.env.XXXXXX")"
override_tmp="$(mktemp "$APP_DIR/.rr-operator.compose.XXXXXX")"
unit_tmp="$(mktemp "$APP_DIR/.rr-operator-agent.service.XXXXXX")"
cleanup() {
  rm -f "$operator_env_tmp" "$override_tmp" "$unit_tmp"
}
trap cleanup EXIT

cat > "$operator_env_tmp" <<EOF
DATABASE_URL=postgresql://rr_operator_ro:${db_password}@db:5432/${db_name}
PUBLIC_APP_ORIGIN=https://recruiter-radar.ru
MIGRATE_ON_START=false
RR_OPERATOR_MODE=true
RR_MCP_ENABLED=${mcp_enabled}
RR_MCP_MUTATIONS_ENABLED=${mutations_enabled}
RR_MCP_OAUTH_ISSUER=${oauth_issuer}
RR_MCP_OAUTH_ALLOWED_SUBJECTS=${allowed_subjects}
RR_OPERATOR_AGENT_SOCKET=/run/recruiter-radar-operator/agent.sock
RR_DEPLOY_SHA=${deploy_sha}
EOF
chmod 0600 "$operator_env_tmp"

cat > "$override_tmp" <<EOF
services:
  operator:
    image: ${operator_image}
    restart: unless-stopped
    ports:
      - "127.0.0.1:3001:3000"
    env_file:
      - ${OPERATOR_ENV}
    environment:
      RR_OPERATOR_MODE: "true"
      MIGRATE_ON_START: "false"
    volumes:
      - ${AGENT_RUNTIME_DIR}:${AGENT_RUNTIME_DIR}:rw
    group_add:
      - "${operator_gid}"
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=32m
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
EOF
chmod 0600 "$override_tmp"

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

preflight_args=("${compose_args[@]}" -f "$override_tmp")
docker compose --env-file "$ENV_FILE" "${preflight_args[@]}" config >/dev/null
python3 -m py_compile "$APP_DIR/scripts/operator-mcp/rr-operator-agent.py"

if [ "$preflight_only" = "true" ]; then
  unset db_password
  echo "Operator MCP runtime preflight passed."
  exit 0
fi

# Create/update a fixed, non-inheriting PostgreSQL login. The password is hex
# generated locally and supplied only over stdin; it is never printed or placed
# in process argv. default_transaction_read_only makes accidental writes fail
# even if a future diagnostic query is incorrectly implemented.
{
  cat <<'SQL_HEAD'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rr_operator_ro') THEN
    CREATE ROLE rr_operator_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;
SQL_HEAD
  printf "ALTER ROLE rr_operator_ro PASSWORD '%s';\n" "$db_password"
  cat <<SQL_BODY
ALTER ROLE rr_operator_ro SET default_transaction_read_only = on;
REVOKE CREATE ON SCHEMA public FROM rr_operator_ro;
GRANT CONNECT ON DATABASE "${db_name}" TO rr_operator_ro;
GRANT USAGE ON SCHEMA public TO rr_operator_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rr_operator_ro;
DO \$\$
DECLARE owner_name text;
BEGIN
  FOR owner_name IN SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO rr_operator_ro',
      owner_name
    );
  END LOOP;
END
\$\$;
SQL_BODY
} | docker exec -i "$DB_CONTAINER" sh -ceu \
  'exec psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"' \
  >/dev/null
unset db_password

install -d -m 0755 -o root -g root "$AGENT_INSTALL_DIR"
install -m 0700 -o root -g root \
  "$APP_DIR/scripts/operator-mcp/rr-operator-agent.py" "$AGENT_INSTALL_PATH"
install -d -m 0770 -o root -g "$OPERATOR_GROUP" "$AGENT_RUNTIME_DIR"
install -m 0644 -o root -g root "$unit_tmp" "$AGENT_UNIT_PATH"
systemctl daemon-reload
systemctl enable --now rr-operator-agent.service
systemctl restart rr-operator-agent.service

mv "$operator_env_tmp" "$OPERATOR_ENV"
operator_env_tmp=""
mv "$override_tmp" "$OPERATOR_OVERRIDE"
override_tmp=""
chmod 0600 "$OPERATOR_ENV" "$OPERATOR_OVERRIDE"

operator_compose_args=("${compose_args[@]}" -f "$OPERATOR_OVERRIDE")
docker compose "${operator_compose_args[@]}" up -d --force-recreate operator

published_operator_port="$(docker compose "${operator_compose_args[@]}" port operator 3000)"
if [ "$published_operator_port" != "127.0.0.1:3001" ]; then
  echo "Operator port boundary is invalid: expected 127.0.0.1:3001" >&2
  exit 1
fi

for _ in $(seq 1 30); do
  operator_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$OPERATOR_CONTAINER" 2>/dev/null || true)"
  if [ "$operator_health" = "healthy" ] || [ "$operator_health" = "running" ]; then
    break
  fi
  sleep 1
done
operator_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$OPERATOR_CONTAINER")"
if [ "$operator_health" != "healthy" ] && [ "$operator_health" != "running" ]; then
  echo "Operator service failed its startup health contract" >&2
  exit 1
fi

if [ "$mcp_enabled" = "false" ]; then
  status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST http://127.0.0.1:3001/api/internal/mcp \
    -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')"
  if [ "$status" != "404" ]; then
    echo "Disabled operator MCP did not fail dark on loopback" >&2
    exit 1
  fi
fi

systemctl is-active --quiet rr-operator-agent.service
trap - EXIT
rm -f "$unit_tmp"
echo "Operator MCP runtime configured with isolated DB role, loopback service and allowlisted host agent."
