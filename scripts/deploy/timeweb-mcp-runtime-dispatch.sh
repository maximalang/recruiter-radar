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

web_revision() {
  local container image_id tags revision
  container="$(container_for_service web)"
  image_id="$(docker inspect --format '{{.Image}}' "$container")"
  tags="$(docker image inspect --format '{{join .RepoTags "\n"}}' "$image_id")"
  revision="$(printf '%s\n' "$tags" | sed -nE 's#^recruiter-radar:([0-9a-f]{40})$#\1#p' | head -n 1)"
  printf '%s' "$revision"
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
    printf '%s\n' '--- cpu ---'
    logical_cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || printf unknown)"
    printf 'logical_cpus=%s\n' "$logical_cpus"
    cpu_model="$(awk -F: '/^[[:space:]]*model name[[:space:]]*:/{ sub(/^[[:space:]]+/, "", $2); print $2; exit }' /proc/cpuinfo 2>/dev/null || true)"
    if [ -n "$cpu_model" ]; then printf 'model=%s\n' "$cpu_model"; fi
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
    revision="$(web_revision)"
    for service in web postgres redis n8n; do
      container="$(container_for_service "$service")"
      image_id="$(docker inspect --format '{{.Image}}' "$container")"
      image="$(docker inspect --format '{{.Config.Image}}' "$container")"
      status="$(docker inspect --format '{{.State.Status}}' "$container")"
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")"
      service_revision=""
      if [ "$service" = web ]; then service_revision="$revision"; fi
      printf '{"service":"%s","container":"%s","image":"%s","image_id":"%s","revision":"%s","status":"%s","health":"%s"}\n' \
        "$service" "$container" "$image" "$image_id" "$service_revision" "$status" "$health"
    done
    ;;
  *)
    printf '%s\n' 'action_not_allowed' >&2
    exit 126
    ;;
esac
