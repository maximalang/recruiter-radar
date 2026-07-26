#!/usr/bin/env bash
set -euo pipefail

image="${SMOKE_IMAGE:?SMOKE_IMAGE is required}"
network="landing-events-smoke"
db_container="landing-events-smoke-db"
web_container="landing-events-smoke-web"
caddy_container="landing-events-smoke-caddy"
temporary_dir="$(mktemp -d)"

cleanup() {
  docker rm -f "$caddy_container" "$web_container" "$db_container" \
    >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

cat > "$temporary_dir/Caddyfile" <<'CADDY_EOF'
http://:8080 {
    reverse_proxy landing-events-smoke-web:3000 {
        # Trust boundary: overwrite any client-supplied X-Real-IP.
        header_up X-Real-IP {remote_host}
    }
}
CADDY_EOF

docker network create "$network" >/dev/null
docker run -d \
  --name "$db_container" \
  --network "$network" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=smoke \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$db_container" pg_isready -U postgres -d smoke \
    >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$db_container" pg_isready -U postgres -d smoke >/dev/null

docker run -d \
  --name "$web_container" \
  --network "$network" \
  -e DATABASE_URL=postgres://postgres:postgres@landing-events-smoke-db:5432/smoke \
  -e SESSION_SECRET=test-session-secret-at-least-32-chars-long \
  -e CRON_API_KEY=test-cron-api-key-at-least-32-chars \
  -e NEXT_PUBLIC_APP_URL=https://recruiter-radar.ru \
  -e PUBLIC_APP_ORIGIN=https://recruiter-radar.ru \
  -e LANDING_ANALYTICS_RATE_LIMIT_SALT=test-landing-rate-limit-salt-at-least-32-chars \
  -e MIGRATE_ON_START=true \
  "$image" >/dev/null

if [ -n "$(docker port "$web_container" 3000 2>/dev/null || true)" ]; then
  echo "Next.js must not publish port 3000 in the Caddy smoke topology" >&2
  exit 1
fi

docker run -d \
  --name "$caddy_container" \
  --network "$network" \
  -p 127.0.0.1:8080:8080 \
  -v "$temporary_dir/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine >/dev/null

for attempt in $(seq 1 60); do
  if curl --fail --silent \
    --header "Host: recruiter-radar.ru" \
    http://127.0.0.1:8080/api/health >/dev/null; then
    break
  fi
  if [ "$attempt" = "60" ]; then
    docker logs "$web_container"
    docker logs "$caddy_container"
    exit 1
  fi
  sleep 1
done

valid_payload='{"name":"landing_viewed","context":"landing"}'
dry_run_payload='{"name":"landing_viewed","context":"landing","dryRun":true}'
valid_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    --request POST \
    --header "Host: recruiter-radar.ru" \
    --header "Origin: https://recruiter-radar.ru" \
    --header "Content-Type: application/json" \
    --header "X-Real-IP: 192.0.2.10" \
    --data "$valid_payload" \
    http://127.0.0.1:8080/api/landing-events
)"
test "$valid_status" = "204"

event_count="$(
  docker exec "$db_container" psql -U postgres -d smoke -tAc \
    "SELECT COUNT(*) FROM product_telemetry_events WHERE event_name = 'landing_viewed' AND metadata->>'context' = 'landing'"
)"
test "$event_count" = "1"

for index in $(seq 1 29); do
  status="$(
    curl --silent --output /dev/null --write-out '%{http_code}' \
      --request POST \
      --header "Host: recruiter-radar.ru" \
      --header "Origin: https://recruiter-radar.ru" \
      --header "Content-Type: application/json" \
      --header "X-Real-IP: 198.51.100.${index}" \
      --data "$dry_run_payload" \
      http://127.0.0.1:8080/api/landing-events
  )"
  test "$status" = "204"
done

rate_limited_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    --request POST \
    --header "Host: recruiter-radar.ru" \
    --header "Origin: https://recruiter-radar.ru" \
    --header "Content-Type: application/json" \
    --header "X-Real-IP: 203.0.113.250" \
    --data "$dry_run_payload" \
    http://127.0.0.1:8080/api/landing-events
)"
test "$rate_limited_status" = "429"

forged_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    --request POST \
    --header "Host: attacker.example" \
    --header "Origin: https://attacker.example" \
    --header "Content-Type: application/json" \
    --data "$dry_run_payload" \
    http://127.0.0.1:8080/api/landing-events
)"
test "$forged_status" = "403"

if curl --fail --silent \
  --header "X-Real-IP: 203.0.113.77" \
  http://127.0.0.1:3000/api/landing-events >/dev/null 2>&1; then
  echo "Direct public-style access to Next.js unexpectedly succeeded" >&2
  exit 1
fi

printf '%s\n' \
  '{"ok":true,"proxyStatus":204,"forgedStatus":403,"rateLimitedStatus":429,"eventCount":1,"nodePortPublished":false}'
