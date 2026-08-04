#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-http://127.0.0.1:3000}"
server_pid="${2:-}"
log_file="${3:-/tmp/landing-server.log}"
ready_html="${4:-/tmp/landing-ready.html}"
static_asset="/brand/recruiter-radar-mark-brand15.svg"
deploy_anchor='data-deploy-anchor="recruiter-radar-landing-v3"'

if [[ -z "$server_pid" || ! "$server_pid" =~ ^[0-9]+$ ]]; then
  echo "A valid standalone server PID is required." >&2
  exit 2
fi

for _ in $(seq 1 90); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Standalone server exited before its static surface became ready." >&2
    cat "$log_file" >&2 || true
    exit 1
  fi

  if curl --connect-timeout 2 --max-time 5 -fsS -o /dev/null "${base_url}${static_asset}"; then
    break
  fi

  sleep 2
done

if ! curl --connect-timeout 5 --max-time 180 -fsS -o "$ready_html" "${base_url}/"; then
  echo "Standalone server did not render the landing page within 180 seconds." >&2
  cat "$log_file" >&2 || true
  exit 1
fi

if ! grep -q "$deploy_anchor" "$ready_html"; then
  echo "Landing page responded without the required deploy anchor." >&2
  cat "$log_file" >&2 || true
  exit 1
fi

echo "Standalone landing is ready."
