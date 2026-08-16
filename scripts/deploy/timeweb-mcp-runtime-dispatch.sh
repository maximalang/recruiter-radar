#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/opt/recruiter-radar
cd "$ROOT"
ACTION="${SSH_ORIGINAL_COMMAND:-}"

container_for_service() {
  case "$1" in
    web) printf '%s\n' recruiter-radar-web-1 ;;
    postgres) printf '%s\n' recruiter-radar-db-1 ;;
    redis) printf '%s\n' recruiter-radar-redis-1 ;;
    n8n) printf '%s\n' recruiter-radar-n8n-1 ;;
    *) return 126 ;;
  esac
}

safe_container_state() {
  local service="$1" container
  container="$(container_for_service "$service")"
  docker inspect --format \
    '{"service":"'"$service"'","container":"{{.Name}}","image":"{{.Config.Image}}","image_id":"{{.Image}}","status":"{{.State.Status}}","health":"{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}"}' \
    "$container"
}

case "$ACTION" in
  docker_ps)
    exec docker ps --format '{{json .}}'
    ;;
  docker_compose_ps)
    exec docker compose ps --format json
    ;;
  docker_logs:web|docker_logs:postgres|docker_logs:redis|docker_logs:n8n)
    service="${ACTION#docker_logs:}"
    container="$(container_for_service "$service")"
    exec docker logs --tail 200 "$container"
    ;;
  docker_health)
    for service in web postgres redis n8n; do safe_container_state "$service"; done
    ;;
  system_info)
    uname -a
    printf '%s\n' '--- /etc/os-release ---'
    cat /etc/os-release
    ;;
  disk_usage)
    exec df -h
    ;;
  memory_usage)
    exec free -m
    ;;
  process_list)
    exec ps aux
    ;;
  git_rev_parse)
    exec git -C "$ROOT" rev-parse HEAD
    ;;
  git_status)
    exec git -C "$ROOT" status --short --branch
    ;;
  deployment_info)
    for service in web postgres redis n8n; do
      container="$(container_for_service "$service")"
      docker inspect --format \
        '{"service":"'"$service"'","container":"{{.Name}}","image":"{{.Config.Image}}","image_id":"{{.Image}}","revision":"{{index .Config.Labels "org.opencontainers.image.revision"}}","status":"{{.State.Status}}","health":"{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}"}' \
        "$container"
    done
    ;;
  *)
    printf '%s\n' 'action_not_allowed' >&2
    exit 126
    ;;
esac
