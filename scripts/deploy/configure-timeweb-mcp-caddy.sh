#!/usr/bin/env bash
set -euo pipefail

config_path="${RR_CADDY_CONFIG_PATH:-/etc/caddy/Caddyfile}"
backup_path="${RR_CADDY_TIMEWEB_BACKUP_PATH:-/etc/caddy/Caddyfile.pre-timeweb-mcp}"
target_site_line='recruiter-radar.ru {'
begin_marker='    # BEGIN Recruiter Radar operator MCP (managed)'
end_marker='    # END Recruiter Radar operator MCP (managed)'
main_proxy_marker='    # Trust boundary: overwrite client X-Real-IP at the only public ingress.'

reload_caddy() {
  local can_systemd_reload
  can_systemd_reload="$(systemctl show caddy.service --property=CanReload --value 2>/dev/null || true)"
  if [ "$can_systemd_reload" = "yes" ]; then
    systemctl reload caddy.service
  else
    caddy reload --config "$config_path" --adapter caddyfile
  fi
}

[ -f "$config_path" ] || { echo "Caddyfile is missing at $config_path" >&2; exit 1; }
[ "$(grep -Fxc "$target_site_line" "$config_path" || true)" -eq 1 ] || {
  echo "Expected exactly one recruiter-radar.ru site block; refusing to guess." >&2
  exit 1
}

begin_count="$(grep -Fxc "$begin_marker" "$config_path" || true)"
end_count="$(grep -Fxc "$end_marker" "$config_path" || true)"
if [ "$begin_count" -ne "$end_count" ] || [ "$begin_count" -gt 1 ]; then
  echo "Malformed managed MCP Caddy block; refusing to modify it." >&2
  exit 1
fi

config_directory="$(dirname "$config_path")"
target_block="$(mktemp "$config_directory/Caddyfile.timeweb.target.XXXXXX")"
temporary_path="$(mktemp "$config_directory/Caddyfile.timeweb.XXXXXX")"
existing_block=""
cleanup() { rm -f "$target_block" "$temporary_path" ${existing_block:+"$existing_block"}; }
trap cleanup EXIT

cat > "$target_block" <<'CADDY_EOF'
    # BEGIN Recruiter Radar operator MCP (managed)
    # Legacy Recruiter Radar operational MCP is intentionally fail-closed at ingress.
    @rr_legacy_operator_mcp path /api/internal/mcp /api/internal/mcp/*
    respond @rr_legacy_operator_mcp 404

    # The Timeweb MCP bridge and its RFC 9728 resource metadata stay on the main
    # web runtime. Only the OAuth issuer is routed to the isolated auth service.
    @rr_timeweb_oauth path \
        /operator/oauth/auth \
        /operator/oauth/auth/* \
        /operator/oauth/token \
        /operator/oauth/token/revocation \
        /operator/oauth/jwks \
        /operator/oauth/reg \
        /operator/oauth/interaction/* \
        /operator/oauth/.well-known/openid-configuration \
        /.well-known/oauth-authorization-server/operator/oauth
    handle @rr_timeweb_oauth {
        header Cache-Control "no-store"
        reverse_proxy 127.0.0.1:3002 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-Proto https
            header_up Host recruiter-radar.ru
        }
    }
    # END Recruiter Radar operator MCP (managed)
CADDY_EOF

install_candidate() {
  local candidate="$1"
  caddy validate --config "$candidate" --adapter caddyfile
  cp "$config_path" "$backup_path"
  chmod --reference="$config_path" "$candidate"
  chown --reference="$config_path" "$candidate"
  mv "$candidate" "$config_path"
  temporary_path=""
  if ! reload_caddy; then
    cp "$backup_path" "$config_path"
    caddy validate --config "$config_path" --adapter caddyfile
    reload_caddy || true
    echo "Timeweb MCP Caddy reload failed; restored previous configuration." >&2
    exit 1
  fi
}

if [ "$begin_count" -eq 1 ]; then
  existing_block="$(mktemp "$config_directory/Caddyfile.timeweb.existing.XXXXXX")"
  awk -v begin="$begin_marker" -v end="$end_marker" '
    $0 == begin { capture = 1 }
    capture { print }
    $0 == end { capture = 0 }
  ' "$config_path" > "$existing_block"

  if cmp -s "$target_block" "$existing_block"; then
    caddy validate --config "$config_path" --adapter caddyfile
    echo "Caddy already exposes only Timeweb OAuth and fail-closes the legacy MCP path."
    exit 0
  fi

  # Refuse unrelated drift. The previous managed block must be recognizably the
  # Recruiter Radar operator contract before it can be migrated automatically.
  grep -Fq '@rr_operator_mcp path /api/internal/mcp' "$existing_block" || {
    echo "Managed MCP Caddy block is not the audited legacy contract; refusing to overwrite it." >&2
    exit 1
  }
  grep -Eq 'reverse_proxy (127\.0\.0\.1|localhost):3001' "$existing_block" || {
    echo "Legacy MCP block has an unexpected upstream; refusing to overwrite it." >&2
    exit 1
  }
  if grep -E 'reverse_proxy ' "$existing_block" | grep -Ev '(127\.0\.0\.1|localhost):300[12]' >/dev/null; then
    echo "Managed MCP block contains an unexpected reverse proxy target; refusing to overwrite it." >&2
    exit 1
  fi

  awk -v begin="$begin_marker" -v end="$end_marker" -v block="$target_block" '
    $0 == begin && !replaced {
      while ((getline line < block) > 0) print line
      close(block)
      replacing = 1
      replaced = 1
      next
    }
    replacing { if ($0 == end) replacing = 0; next }
    { print }
    END { if (!replaced || replacing) exit 42 }
  ' "$config_path" > "$temporary_path"
  install_candidate "$temporary_path"
  echo "Migrated legacy Recruiter Radar MCP ingress to the Timeweb OAuth boundary."
  exit 0
fi

[ "$(grep -Fxc "$main_proxy_marker" "$config_path" || true)" -eq 1 ] || {
  echo "Canonical Recruiter Radar public proxy boundary is missing; refusing to insert OAuth routing." >&2
  exit 1
}

awk -v target="$main_proxy_marker" -v block="$target_block" '
  $0 == target && !inserted {
    while ((getline line < block) > 0) print line
    close(block)
    inserted = 1
  }
  { print }
  END { if (!inserted) exit 42 }
' "$config_path" > "$temporary_path"
install_candidate "$temporary_path"
echo "Caddy now fail-closes legacy MCP and routes only OAuth to 127.0.0.1:3002."
