#!/usr/bin/env bash
set -euo pipefail

diagnostics_dumped=false

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

network_exists() {
  docker network inspect "$1" >/dev/null 2>&1
}

dump_diagnostics_once() {
  if [ "$diagnostics_dumped" = "true" ]; then
    return
  fi
  diagnostics_dumped=true

  printf '%s\n' "=== Caddy landing smoke diagnostics ===" >&2
  docker version \
    --format 'docker-client={{.Client.Version}} docker-server={{.Server.Version}}' \
    >&2 || true
  docker info \
    --format 'docker-driver={{.Driver}} containers={{.Containers}} images={{.Images}}' \
    >&2 || true
  docker ps -a \
    --format 'container={{.Names}} status={{.Status}} image={{.Image}}' \
    >&2 || true
  docker network ls --format 'network={{.Name}} driver={{.Driver}}' >&2 || true

  for container in "$db_container" "$web_container" "$caddy_container"; do
    if container_exists "$container"; then
      docker inspect "$container" \
        --format 'container={{.Name}} status={{.State.Status}} exit={{.State.ExitCode}} error={{json .State.Error}} networks={{json .NetworkSettings.Networks}}' \
        >&2 || true
      printf '%s\n' "--- logs: $container ---" >&2
      docker logs --tail 200 "$container" >&2 || true
    else
      printf '%s\n' "container=$container status=not-created" >&2
    fi
  done

  if network_exists "$network"; then
    docker network inspect "$network" \
      --format 'network={{.Name}} driver={{.Driver}} containers={{json .Containers}}' \
      >&2 || true
  else
    printf '%s\n' "network=$network status=not-created" >&2
  fi
}

cleanup() {
  local container
  for container in "$caddy_container" "$web_container" "$db_container"; do
    if container_exists "$container"; then
      docker rm -f "$container" >/dev/null 2>&1 || true
    fi
  done
  if network_exists "$network"; then
    docker network rm "$network" >/dev/null 2>&1 || true
  fi
  if [ -n "${temporary_dir:-}" ] && [ -d "$temporary_dir" ]; then
    rm -rf "$temporary_dir"
  fi
}

finish() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    dump_diagnostics_once
  fi
  cleanup || true
  exit "$status"
}

retry_pull() {
  local image_name="$1"
  local attempts="${2:-5}"
  local delay_seconds="${3:-2}"
  local attempt

  for attempt in $(seq 1 "$attempts"); do
    if docker pull "$image_name"; then
      return 0
    fi
    printf 'Pull failed for %s (attempt %s/%s)\n' \
      "$image_name" "$attempt" "$attempts" >&2
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "$delay_seconds"
      delay_seconds=$((delay_seconds * 2))
    fi
  done
  return 1
}

wait_for_consecutive_successes() {
  local label="$1"
  local attempts="$2"
  local required_successes="$3"
  local delay_seconds="$4"
  shift 4
  local attempt
  local consecutive=0

  for attempt in $(seq 1 "$attempts"); do
    if "$@" >/dev/null 2>&1; then
      consecutive=$((consecutive + 1))
      if [ "$consecutive" -ge "$required_successes" ]; then
        return 0
      fi
    else
      consecutive=0
    fi
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "$delay_seconds"
    fi
  done

  printf 'Timed out waiting for %s after %s checks\n' \
    "$label" "$attempts" >&2
  dump_diagnostics_once
  return 1
}

postgres_ready() {
  docker exec "$db_container" pg_isready -U postgres -d smoke \
    && docker exec "$db_container" psql -U postgres -d smoke -tAc "SELECT 1" \
    | grep -qx '1'
}

web_ready() {
  docker exec "$web_container" node -e \
    "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
}

caddy_ready() {
  curl --fail --silent \
    --header "Host: recruiter-radar.ru" \
    "http://127.0.0.1:${caddy_port}/api/health"
}

main() {
image="${SMOKE_IMAGE:?SMOKE_IMAGE is required}"
postgres_image="${POSTGRES_SMOKE_IMAGE:-postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777}"
caddy_image="${CADDY_SMOKE_IMAGE:-caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648}"
raw_run_suffix="${RUN_SUFFIX:-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${RANDOM}}"
run_suffix="$(printf '%s' "$raw_run_suffix" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_.-' '-')"
network="landing-events-smoke-${run_suffix}"
db_container="landing-events-smoke-db-${run_suffix}"
web_container="landing-events-smoke-web-${run_suffix}"
caddy_container="landing-events-smoke-caddy-${run_suffix}"
temporary_dir="$(mktemp -d)"
caddy_port=""
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

retry_pull "$postgres_image"
retry_pull "$caddy_image"

cat > "$temporary_dir/Caddyfile" <<CADDY_EOF
http://:8080 {
    reverse_proxy ${web_container}:3000 {
        # Trust boundary: overwrite any client-supplied X-Real-IP.
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto https
        header_up Host recruiter-radar.ru
    }
}
CADDY_EOF

docker network create "$network" >/dev/null
docker run -d \
  --name "$db_container" \
  --network "$network" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=smoke \
  "$postgres_image" >/dev/null

# The official image briefly accepts connections on its init server before
# restarting PostgreSQL. Requiring consecutive real queries avoids racing that
# transient readiness window.
wait_for_consecutive_successes "stable PostgreSQL" 45 3 1 postgres_ready

docker run -d \
  --name "$web_container" \
  --network "$network" \
  -e DATABASE_URL="postgres://postgres:postgres@${db_container}:5432/smoke" \
  -e SESSION_SECRET=test-session-secret-at-least-32-chars-long \
  -e CRON_API_KEY=test-cron-api-key-at-least-32-chars \
  -e NEXT_PUBLIC_APP_URL=https://recruiter-radar.ru \
  -e PUBLIC_APP_ORIGIN=https://recruiter-radar.ru \
  -e LANDING_ANALYTICS_RATE_LIMIT_SALT=test-landing-rate-limit-salt-at-least-32-chars \
  -e MIGRATE_ON_START=true \
  "$image" >/dev/null

wait_for_consecutive_successes "Next.js health" 60 2 1 web_ready

if [ -n "$(docker port "$web_container" 3000 2>/dev/null || true)" ]; then
  echo "Next.js must not publish port 3000 in the Caddy smoke topology" >&2
  exit 1
fi

docker run -d \
  --name "$caddy_container" \
  --network "$network" \
  -p 127.0.0.1::8080 \
  -v "$temporary_dir/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$caddy_image" >/dev/null
caddy_port="$(docker port "$caddy_container" 8080/tcp)"
caddy_port="${caddy_port##*:}"
test -n "$caddy_port"

wait_for_consecutive_successes "Caddy proxy health" 30 2 1 caddy_ready

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
    "http://127.0.0.1:${caddy_port}/api/landing-events"
)"
test "$valid_status" = "204"

event_count="$(
  docker exec "$db_container" psql -U postgres -d smoke -tAc \
    "SELECT COUNT(*) FROM product_telemetry_events WHERE event_name = 'landing_viewed' AND metadata->>'context' = 'landing'"
)"
test "$event_count" = "1"

dry_run_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    --request POST \
    --header "Host: recruiter-radar.ru" \
    --header "Origin: https://recruiter-radar.ru" \
    --header "Content-Type: application/json" \
    --data "$dry_run_payload" \
    "http://127.0.0.1:${caddy_port}/api/landing-events"
)"
test "$dry_run_status" = "204"

unknown_event_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    --request POST \
    --header "Host: recruiter-radar.ru" \
    --header "Origin: https://recruiter-radar.ru" \
    --header "Content-Type: application/json" \
    --data '{"name":"unknown_event","context":"landing"}' \
    "http://127.0.0.1:${caddy_port}/api/landing-events"
)"
test "$unknown_event_status" = "400"

forbidden_field_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    --request POST \
    --header "Host: recruiter-radar.ru" \
    --header "Origin: https://recruiter-radar.ru" \
    --header "Content-Type: application/json" \
    --data '{"name":"landing_viewed","context":"landing","email":"private@example.test"}' \
    "http://127.0.0.1:${caddy_port}/api/landing-events"
)"
test "$forbidden_field_status" = "400"

event_count_after_rejected_and_dry_run="$(
  docker exec "$db_container" psql -U postgres -d smoke -tAc \
    "SELECT COUNT(*) FROM product_telemetry_events WHERE event_name = 'landing_viewed'"
)"
test "$event_count_after_rejected_and_dry_run" = "1"

unsafe_metadata_count="$(
  docker exec "$db_container" psql -U postgres -d smoke -tAc \
    "SELECT COUNT(*) FROM product_telemetry_events WHERE metadata ?| ARRAY['email', 'profile', 'order', 'ip', 'x-real-ip', 'x-forwarded-for']"
)"
test "$unsafe_metadata_count" = "0"

for index in $(seq 1 26); do
  status="$(
    curl --silent --output /dev/null --write-out '%{http_code}' \
      --request POST \
      --header "Host: recruiter-radar.ru" \
      --header "Origin: https://recruiter-radar.ru" \
      --header "Content-Type: application/json" \
      --header "X-Real-IP: 198.51.100.${index}" \
      --header "X-Forwarded-For: 203.0.113.${index}" \
      --data "$dry_run_payload" \
      "http://127.0.0.1:${caddy_port}/api/landing-events"
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
    "http://127.0.0.1:${caddy_port}/api/landing-events"
)"
test "$rate_limited_status" = "429"

forged_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    --request POST \
    --header "Host: attacker.example" \
    --header "Origin: https://attacker.example" \
    --header "Content-Type: application/json" \
    --data "$dry_run_payload" \
    "http://127.0.0.1:${caddy_port}/api/landing-events"
)"
test "$forged_status" = "403"

if curl --fail --silent \
  --header "X-Real-IP: 203.0.113.77" \
  http://127.0.0.1:3000/api/landing-events >/dev/null 2>&1; then
  echo "Direct public-style access to Next.js unexpectedly succeeded" >&2
  exit 1
fi

printf '%s\n' \
  '{"ok":true,"proxyStatus":204,"dryRunStatus":204,"unknownEventStatus":400,"forbiddenFieldStatus":400,"forgedStatus":403,"rateLimitedStatus":429,"eventCount":1,"unsafeMetadataCount":0,"nodePortPublished":false}'
}

if [ "${LANDING_SMOKE_LIB_ONLY:-false}" != "true" ]; then
  main "$@"
fi
