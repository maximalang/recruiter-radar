#!/usr/bin/env bash
set -Eeuo pipefail

sha="${1:?usage: deploy-agent-world-preview.sh <40-char-agent-world-sha>}"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]]

preview_dir=/opt/agent-world-preview
image_archive="$preview_dir/web-${sha}.tar.gz"
network=agent-world-preview-net
db_container=agent-world-preview-db
web_container=agent-world-preview-web
db_volume=agent-world-preview-postgres-data
image="agent-world-preview-web:${sha}"
secret_file="$preview_dir/secrets.env"
web_env="$preview_dir/web.env"
caddy_config=/etc/caddy/Caddyfile
caddy_begin='# BEGIN Agent World Preview (managed)'
caddy_end='# END Agent World Preview (managed)'
owner_password_hash='scrypt-v1$32768$8$1$VY98vE1S4yVPhSkLVvhb7g$ioPyf_XxtntzCAHBqc1c4gZ_gmqduAT4q5_hTvXOg4U'
mutation_started=false

remove_managed_caddy_block() {
  if [ ! -f "$caddy_config" ]; then
    return 0
  fi
  local temporary
  temporary="$(mktemp /etc/caddy/Caddyfile.agent-world-cleanup.XXXXXX)"
  awk -v begin="$caddy_begin" -v end="$caddy_end" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' "$caddy_config" > "$temporary"
  chmod --reference="$caddy_config" "$temporary"
  chown --reference="$caddy_config" "$temporary"
  if caddy validate --config "$temporary" --adapter caddyfile >/dev/null 2>&1; then
    mv "$temporary" "$caddy_config"
    systemctl reload caddy.service >/dev/null 2>&1 || true
  else
    rm -f "$temporary"
  fi
}

rollback_preview() {
  local status=$?
  if [ "$mutation_started" = true ]; then
    echo "Preview deployment failed; removing only Agent World preview runtime." >&2
    remove_managed_caddy_block || true
    docker rm -f "$web_container" >/dev/null 2>&1 || true
    docker rm -f "$db_container" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap rollback_preview ERR

exec 9>/tmp/agent-world-preview.lock
flock -w 120 9

install -d -m 0700 "$preview_dir"
test -f "$image_archive"
test -f "$caddy_config"
test "$(docker inspect --format '{{.State.Health.Status}}' recruiter-radar-web-1)" = healthy
test "$(docker inspect --format '{{.State.Health.Status}}' recruiter-radar-db-1)" = healthy
curl -fsS http://127.0.0.1:3000/api/health >/dev/null

free_mb="$(free -m | awk '/^Mem:/ {print $7}')"
disk_mb="$(df -Pm / | awk 'NR == 2 {print $4}')"
if [ "$free_mb" -lt 420 ]; then
  echo "Insufficient available memory for bounded preview: ${free_mb} MB" >&2
  exit 1
fi
if [ "$disk_mb" -lt 2500 ]; then
  echo "Insufficient disk for preview: ${disk_mb} MB" >&2
  exit 1
fi

if [ ! -f "$secret_file" ]; then
  umask 077
  db_password="$(openssl rand -hex 24)"
  csrf_secret="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  master_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  test "${#csrf_secret}" -eq 43
  test "${#master_key}" -eq 43
  cat > "$secret_file" <<SECRETS
DB_PASSWORD=$db_password
CSRF_SECRET=$csrf_secret
MASTER_KEY=$master_key
SECRETS
  chmod 600 "$secret_file"
fi
# shellcheck disable=SC1090
. "$secret_file"
test -n "$DB_PASSWORD"
test "${#CSRF_SECRET}" -eq 43
test "${#MASTER_KEY}" -eq 43

umask 077
cat > "$web_env" <<ENV
DATABASE_URL=postgresql://agent_world:${DB_PASSWORD}@${db_container}:5432/agent_world
AGENT_WORLD_DATABASE_TLS=disable
AGENT_WORLD_DATABASE_PLAINTEXT_ACK=private-network
AGENT_WORLD_OWNER_PASSWORD_HASH=${owner_password_hash}
AGENT_WORLD_CSRF_SECRET=${CSRF_SECRET}
AGENT_WORLD_SECRET_MASTER_KEY=${MASTER_KEY}
AGENT_WORLD_SECRET_KEY_VERSION=1
AGENT_WORLD_INSTANCE_ID=agent-world-preview
AGENT_WORLD_SCHEDULE_POLL_MS=60000
AGENT_WORLD_MISSION_HANDOFF_POLL_MS=15000
NODE_OPTIONS=--max-old-space-size=224
HOSTNAME=0.0.0.0
PORT=3000
ENV
chmod 600 "$web_env"

docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null
docker volume inspect "$db_volume" >/dev/null 2>&1 || docker volume create "$db_volume" >/dev/null
mutation_started=true

if ! docker container inspect "$db_container" >/dev/null 2>&1; then
  docker run -d \
    --name "$db_container" \
    --restart unless-stopped \
    --network "$network" \
    --memory 192m \
    --memory-swap 384m \
    --cpus 0.25 \
    --pids-limit 128 \
    --security-opt no-new-privileges:true \
    --health-cmd 'pg_isready -U agent_world -d agent_world' \
    --health-interval 5s \
    --health-timeout 3s \
    --health-retries 12 \
    --health-start-period 15s \
    -e POSTGRES_DB=agent_world \
    -e POSTGRES_USER=agent_world \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -v "$db_volume:/var/lib/postgresql" \
    pgvector/pgvector:0.8.6-pg18-bookworm@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a \
    -c shared_buffers=32MB \
    -c max_connections=20 \
    -c work_mem=2MB \
    -c maintenance_work_mem=16MB >/dev/null
else
  docker start "$db_container" >/dev/null 2>&1 || true
fi

for attempt in $(seq 1 30); do
  if [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$db_container")" = healthy ]; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    docker logs --tail 100 "$db_container" >&2 || true
    exit 1
  fi
  sleep 2
done

gzip -dc "$image_archive" | docker load >/dev/null
docker image inspect "$image" >/dev/null

docker rm -f "$web_container" >/dev/null 2>&1 || true
docker run -d \
  --name "$web_container" \
  --restart unless-stopped \
  --network "$network" \
  -p 127.0.0.1:3100:3000 \
  --env-file "$web_env" \
  --memory 384m \
  --memory-swap 768m \
  --cpus 0.45 \
  --pids-limit 256 \
  --read-only \
  --tmpfs /tmp:size=64m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  "$image" >/dev/null

for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3100/api/health/ready >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    docker logs --tail 200 "$web_container" >&2 || true
    exit 1
  fi
  sleep 2
done

caddy_tmp="$(mktemp /etc/caddy/Caddyfile.agent-world-preview.XXXXXX)"
awk -v begin="$caddy_begin" -v end="$caddy_end" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "$caddy_config" > "$caddy_tmp"
cat >> "$caddy_tmp" <<'CADDY'

# BEGIN Agent World Preview (managed)
https://recruiter-radar.ru:8443 {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3100 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto https
        header_up Host {host}
    }
}
# END Agent World Preview (managed)
CADDY
chmod --reference="$caddy_config" "$caddy_tmp"
chown --reference="$caddy_config" "$caddy_tmp"
caddy validate --config "$caddy_tmp" --adapter caddyfile
mv "$caddy_tmp" "$caddy_config"
systemctl reload caddy.service

curl -fsS http://127.0.0.1:3100/api/health/ready >/dev/null
for attempt in $(seq 1 20); do
  if curl -kfsS --resolve recruiter-radar.ru:8443:127.0.0.1 \
    https://recruiter-radar.ru:8443/api/health/ready >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 20 ]; then
    exit 1
  fi
  sleep 2
done

# Protect the existing production service from resource starvation.
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
sleep 15
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
available_after="$(free -m | awk '/^Mem:/ {print $7}')"
if [ "$available_after" -lt 80 ]; then
  echo "Preview leaves too little available RAM: ${available_after} MB" >&2
  exit 1
fi

docker inspect --format '{{.Name}} memory={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} cpus={{.HostConfig.NanoCpus}}' \
  "$db_container" "$web_container"
docker ps --filter 'name=agent-world-preview' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
free -m
df -h /

rm -f "$image_archive"
docker image prune -f >/dev/null 2>&1 || true
mutation_started=false
echo 'AGENT_WORLD_PREVIEW_LOCAL_READY'
