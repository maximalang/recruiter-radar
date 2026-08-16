#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${RR_APP_DIR:-/opt/recruiter-radar}"
ENV_FILE="$APP_DIR/.env"
TIMEWEB_OVERRIDE="$APP_DIR/.rr-timeweb-mcp.compose.yml"
NOTIFICATION_OVERRIDE="$APP_DIR/.rr-notification-key.compose.yml"
TOKEN_FILE="${RR_TIMEWEB_MCP_TOKEN_FILE:-/var/lib/recruiter-radar-timeweb/token}"
RUNTIME_DIR="${RR_TIMEWEB_RUNTIME_DIR:-/var/lib/recruiter-radar-timeweb/runtime}"
DISPATCHER="$APP_DIR/timeweb-mcp-runtime-dispatch.sh"
EXPECTED_ISSUER="https://recruiter-radar.ru/operator/oauth"
EXPECTED_SUBJECT="rr_owner"
runtime_user="${RR_TIMEWEB_RUNTIME_SSH_USER:-}"
runtime_port="${RR_TIMEWEB_RUNTIME_SSH_PORT:-22}"
preflight_only=false

case "${1:-}" in
  "") ;;
  --preflight) preflight_only=true ;;
  *) echo "Usage: $0 [--preflight]" >&2; exit 2 ;;
esac

cd "$APP_DIR"
[ -f "$ENV_FILE" ] || { echo "Production .env is missing" >&2; exit 1; }
[ -f "$TOKEN_FILE" ] || { echo "RR_TIMEWEB_MCP_TOKEN is not staged on the server" >&2; exit 1; }
[[ "$runtime_user" =~ ^[A-Za-z_][A-Za-z0-9._-]{0,63}$ ]] || { echo "RR_TIMEWEB_RUNTIME_SSH_USER is invalid" >&2; exit 1; }
[[ "$runtime_port" =~ ^[0-9]+$ ]] && [ "$runtime_port" -ge 1 ] && [ "$runtime_port" -le 65535 ] || { echo "RR_TIMEWEB_RUNTIME_SSH_PORT is invalid" >&2; exit 1; }

if [ "$preflight_only" = "false" ]; then
  [ -f "$DISPATCHER" ] || { echo "Timeweb runtime dispatcher is missing" >&2; exit 1; }
  bash -n "$DISPATCHER"
fi

token_bytes="$(wc -c < "$TOKEN_FILE" | tr -d '[:space:]')"
if ! [[ "$token_bytes" =~ ^[0-9]+$ ]] || [ "$token_bytes" -lt 16 ] || [ "$token_bytes" -gt 4096 ]; then
  echo "Staged Timeweb MCP token is missing or malformed" >&2
  exit 1
fi

strip_quotes() {
  local value="$1"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

compose_args=()
configured_compose_files="${COMPOSE_FILE:-}"
if [ -z "$configured_compose_files" ]; then
  configured_compose_files="$(sed -n 's/^COMPOSE_FILE=//p' "$ENV_FILE" | tail -n 1)"
  configured_compose_files="$(strip_quotes "$configured_compose_files")"
fi
if [ -n "$configured_compose_files" ]; then
  IFS=':' read -r -a compose_files <<< "$configured_compose_files"
  for compose_file in "${compose_files[@]}"; do
    if [ -n "$compose_file" ]; then compose_args+=(-f "$compose_file"); fi
  done
else
  base_compose=""
  for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    if [ -f "$candidate" ]; then base_compose="$candidate"; break; fi
  done
  [ -n "$base_compose" ] || { echo "No Docker Compose file found in $APP_DIR" >&2; exit 1; }
  compose_args+=(-f "$base_compose")
  case "$base_compose" in
    compose.yaml) standard_override="compose.override.yaml" ;;
    compose.yml) standard_override="compose.override.yml" ;;
    docker-compose.yaml) standard_override="docker-compose.override.yaml" ;;
    docker-compose.yml) standard_override="docker-compose.override.yml" ;;
  esac
  if [ -n "${standard_override:-}" ] && [ -f "$standard_override" ]; then compose_args+=(-f "$standard_override"); fi
fi
if [ -f "$NOTIFICATION_OVERRIDE" ]; then compose_args+=(-f "$NOTIFICATION_OVERRIDE"); fi

umask 077
env_tmp="$(mktemp "$APP_DIR/.env.timeweb.XXXXXX")"
override_tmp="$(mktemp "$APP_DIR/.rr-timeweb-mcp.compose.XXXXXX")"
cleanup() { rm -f "$env_tmp" "$override_tmp"; }
trap cleanup EXIT

token="$(cat "$TOKEN_FILE")"
token="${token%$'\n'}"
[ -n "$token" ] || { echo "Staged Timeweb MCP token is empty" >&2; exit 1; }

awk \
  -v token_value="$token" \
  -v issuer_value="$EXPECTED_ISSUER" \
  -v subject_value="$EXPECTED_SUBJECT" \
  -v runtime_user_value="$runtime_user" \
  -v runtime_port_value="$runtime_port" '
  BEGIN { old_enabled=0; mutations=0; tw_enabled=0; tw_token=0; issuer=0; subjects=0; ssh_enabled=0; ssh_host=0; ssh_user=0; ssh_port=0; ssh_key=0; ssh_known=0 }
  /^RR_MCP_ENABLED=/ { if (!old_enabled) { print "RR_MCP_ENABLED=false"; old_enabled=1 }; next }
  /^RR_MCP_MUTATIONS_ENABLED=/ { if (!mutations) { print "RR_MCP_MUTATIONS_ENABLED=false"; mutations=1 }; next }
  /^RR_TIMEWEB_MCP_ENABLED=/ { if (!tw_enabled) { print "RR_TIMEWEB_MCP_ENABLED=true"; tw_enabled=1 }; next }
  /^RR_TIMEWEB_MCP_TOKEN=/ { if (!tw_token) { print "RR_TIMEWEB_MCP_TOKEN=" token_value; tw_token=1 }; next }
  /^RR_MCP_OAUTH_ISSUER=/ { if (!issuer) { print "RR_MCP_OAUTH_ISSUER=" issuer_value; issuer=1 }; next }
  /^RR_MCP_OAUTH_ALLOWED_SUBJECTS=/ { if (!subjects) { print "RR_MCP_OAUTH_ALLOWED_SUBJECTS=" subject_value; subjects=1 }; next }
  /^RR_TIMEWEB_RUNTIME_SSH_ENABLED=/ { if (!ssh_enabled) { print "RR_TIMEWEB_RUNTIME_SSH_ENABLED=true"; ssh_enabled=1 }; next }
  /^RR_TIMEWEB_RUNTIME_SSH_HOST=/ { if (!ssh_host) { print "RR_TIMEWEB_RUNTIME_SSH_HOST=rr-timeweb-host"; ssh_host=1 }; next }
  /^RR_TIMEWEB_RUNTIME_SSH_USER=/ { if (!ssh_user) { print "RR_TIMEWEB_RUNTIME_SSH_USER=" runtime_user_value; ssh_user=1 }; next }
  /^RR_TIMEWEB_RUNTIME_SSH_PORT=/ { if (!ssh_port) { print "RR_TIMEWEB_RUNTIME_SSH_PORT=" runtime_port_value; ssh_port=1 }; next }
  /^RR_TIMEWEB_RUNTIME_SSH_KEY_FILE=/ { if (!ssh_key) { print "RR_TIMEWEB_RUNTIME_SSH_KEY_FILE=/run/rr-timeweb-runtime/id_ed25519"; ssh_key=1 }; next }
  /^RR_TIMEWEB_RUNTIME_SSH_KNOWN_HOSTS_FILE=/ { if (!ssh_known) { print "RR_TIMEWEB_RUNTIME_SSH_KNOWN_HOSTS_FILE=/run/rr-timeweb-runtime/known_hosts"; ssh_known=1 }; next }
  { print }
  END {
    if (!old_enabled) print "RR_MCP_ENABLED=false"
    if (!mutations) print "RR_MCP_MUTATIONS_ENABLED=false"
    if (!tw_enabled) print "RR_TIMEWEB_MCP_ENABLED=true"
    if (!tw_token) print "RR_TIMEWEB_MCP_TOKEN=" token_value
    if (!issuer) print "RR_MCP_OAUTH_ISSUER=" issuer_value
    if (!subjects) print "RR_MCP_OAUTH_ALLOWED_SUBJECTS=" subject_value
    if (!ssh_enabled) print "RR_TIMEWEB_RUNTIME_SSH_ENABLED=true"
    if (!ssh_host) print "RR_TIMEWEB_RUNTIME_SSH_HOST=rr-timeweb-host"
    if (!ssh_user) print "RR_TIMEWEB_RUNTIME_SSH_USER=" runtime_user_value
    if (!ssh_port) print "RR_TIMEWEB_RUNTIME_SSH_PORT=" runtime_port_value
    if (!ssh_key) print "RR_TIMEWEB_RUNTIME_SSH_KEY_FILE=/run/rr-timeweb-runtime/id_ed25519"
    if (!ssh_known) print "RR_TIMEWEB_RUNTIME_SSH_KNOWN_HOSTS_FILE=/run/rr-timeweb-runtime/known_hosts"
  }
' "$ENV_FILE" > "$env_tmp"
chmod 600 "$env_tmp"
unset token

cat > "$override_tmp" <<'COMPOSE_EOF'
services:
  web:
    environment:
      RR_MCP_ENABLED: "false"
      RR_MCP_MUTATIONS_ENABLED: "false"
      RR_TIMEWEB_MCP_ENABLED: "true"
      RR_TIMEWEB_MCP_TOKEN: ${RR_TIMEWEB_MCP_TOKEN:?RR_TIMEWEB_MCP_TOKEN is required}
      RR_MCP_OAUTH_ISSUER: https://recruiter-radar.ru/operator/oauth
      RR_MCP_OAUTH_ALLOWED_SUBJECTS: rr_owner
      RR_TIMEWEB_RUNTIME_SSH_ENABLED: "true"
      RR_TIMEWEB_RUNTIME_SSH_HOST: rr-timeweb-host
      RR_TIMEWEB_RUNTIME_SSH_USER: ${RR_TIMEWEB_RUNTIME_SSH_USER:?RR_TIMEWEB_RUNTIME_SSH_USER is required}
      RR_TIMEWEB_RUNTIME_SSH_PORT: ${RR_TIMEWEB_RUNTIME_SSH_PORT:?RR_TIMEWEB_RUNTIME_SSH_PORT is required}
      RR_TIMEWEB_RUNTIME_SSH_KEY_FILE: /run/rr-timeweb-runtime/id_ed25519
      RR_TIMEWEB_RUNTIME_SSH_KNOWN_HOSTS_FILE: /run/rr-timeweb-runtime/known_hosts
    extra_hosts:
      - "rr-timeweb-host:host-gateway"
    volumes:
      - /var/lib/recruiter-radar-timeweb/runtime/id_ed25519:/run/rr-timeweb-runtime/id_ed25519:ro
      - /var/lib/recruiter-radar-timeweb/runtime/known_hosts:/run/rr-timeweb-runtime/known_hosts:ro
COMPOSE_EOF
chmod 600 "$override_tmp"

preflight_args=("${compose_args[@]}" -f "$override_tmp")
docker compose --env-file "$env_tmp" "${preflight_args[@]}" config >/dev/null

if [ "$preflight_only" = "true" ]; then
  echo "Timeweb MCP runtime preflight passed."
  exit 0
fi

chmod 700 "$DISPATCHER"
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
if [ ! -s "$RUNTIME_DIR/id_ed25519" ]; then
  ssh-keygen -q -t ed25519 -N '' -C rr-timeweb-mcp-runtime -f "$RUNTIME_DIR/id_ed25519"
fi
chmod 600 "$RUNTIME_DIR/id_ed25519"
chmod 644 "$RUNTIME_DIR/id_ed25519.pub"
chown 1001:1001 "$RUNTIME_DIR/id_ed25519"

host_key_line="$(awk 'NF >= 2 { print $1 " " $2; exit }' /etc/ssh/ssh_host_ed25519_key.pub)"
[ -n "$host_key_line" ] || { echo "SSH host ed25519 public key is unavailable" >&2; exit 1; }
printf 'rr-timeweb-host %s\n[rr-timeweb-host]:%s %s\n' "$host_key_line" "$runtime_port" "$host_key_line" > "$RUNTIME_DIR/known_hosts"
chmod 644 "$RUNTIME_DIR/known_hosts"

runtime_home="$(getent passwd "$runtime_user" | awk -F: 'NR == 1 { print $6 }')"
runtime_group="$(id -gn "$runtime_user")"
[ -n "$runtime_home" ] || { echo "Runtime SSH user does not exist" >&2; exit 1; }
mkdir -p "$runtime_home/.ssh"
chmod 700 "$runtime_home/.ssh"
authorized_keys="$runtime_home/.ssh/authorized_keys"
touch "$authorized_keys"
chmod 600 "$authorized_keys"
chown "$runtime_user:$runtime_group" "$runtime_home/.ssh" "$authorized_keys"
filtered_keys="$(mktemp "$runtime_home/.ssh/authorized_keys.XXXXXX")"
grep -v 'rr-timeweb-mcp-runtime$' "$authorized_keys" > "$filtered_keys" || true
runtime_pub="$(cat "$RUNTIME_DIR/id_ed25519.pub")"
printf 'restrict,command="%s/timeweb-mcp-runtime-dispatch.sh" %s\n' "$APP_DIR" "$runtime_pub" >> "$filtered_keys"
chown "$runtime_user:$runtime_group" "$filtered_keys"
mv "$filtered_keys" "$authorized_keys"
chmod 600 "$authorized_keys"

mv "$env_tmp" "$ENV_FILE"; env_tmp=""
mv "$override_tmp" "$TIMEWEB_OVERRIDE"; override_tmp=""
trap - EXIT

runtime_args=("${compose_args[@]}" -f "$TIMEWEB_OVERRIDE")
docker compose --env-file "$ENV_FILE" "${runtime_args[@]}" up -d --force-recreate web

docker compose --env-file "$ENV_FILE" "${runtime_args[@]}" exec -T web node -e '
  if (process.env.RR_MCP_ENABLED !== "false") process.exit(1);
  if (process.env.RR_MCP_MUTATIONS_ENABLED !== "false") process.exit(1);
  if (process.env.RR_TIMEWEB_MCP_ENABLED !== "true") process.exit(1);
  if ((process.env.RR_TIMEWEB_MCP_TOKEN || "").trim().length < 16) process.exit(1);
  if (process.env.RR_MCP_OAUTH_ISSUER !== "https://recruiter-radar.ru/operator/oauth") process.exit(1);
  if (process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS !== "rr_owner") process.exit(1);
  if (process.env.RR_TIMEWEB_RUNTIME_SSH_ENABLED !== "true") process.exit(1);
  console.log("Timeweb MCP runtime boundary is valid");
'

docker compose --env-file "$ENV_FILE" "${runtime_args[@]}" exec -T web \
  /usr/bin/ssh -T -p "$runtime_port" \
  -i /run/rr-timeweb-runtime/id_ed25519 \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/run/rr-timeweb-runtime/known_hosts -o ConnectTimeout=5 \
  "$runtime_user@rr-timeweb-host" docker_ps >/dev/null

echo "Timeweb MCP restricted runtime SSH verified."
