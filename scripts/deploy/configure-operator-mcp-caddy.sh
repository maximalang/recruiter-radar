#!/usr/bin/env bash
set -euo pipefail

config_path="${RR_CADDY_CONFIG_PATH:-/etc/caddy/Caddyfile}"
backup_path="${RR_CADDY_OPERATOR_BACKUP_PATH:-/etc/caddy/Caddyfile.pre-recruiter-radar-operator-mcp}"
target_site_line='recruiter-radar.ru {'
begin_marker='    # BEGIN Recruiter Radar operator MCP (managed)'
end_marker='    # END Recruiter Radar operator MCP (managed)'
main_proxy_marker='    # Trust boundary: overwrite client X-Real-IP at the only public ingress.'
enabled="${RR_MCP_ENABLED:-false}"

case "$enabled" in
  true | false) ;;
  *)
    echo "RR_MCP_ENABLED must be true or false." >&2
    exit 1
    ;;
esac

reload_caddy() {
  local can_systemd_reload
  can_systemd_reload="$(systemctl show caddy.service --property=CanReload --value 2>/dev/null || true)"
  if [ "$can_systemd_reload" = "yes" ]; then
    systemctl reload caddy.service
  else
    caddy reload --config "$config_path" --adapter caddyfile
  fi
}

if [ ! -f "$config_path" ]; then
  echo "Caddyfile is missing at $config_path" >&2
  exit 1
fi

site_count="$(grep -Fxc "$target_site_line" "$config_path" || true)"
if [ "$site_count" -ne 1 ]; then
  echo "Expected exactly one recruiter-radar.ru site block; refusing to guess." >&2
  exit 1
fi

begin_count="$(grep -Fxc "$begin_marker" "$config_path" || true)"
end_count="$(grep -Fxc "$end_marker" "$config_path" || true)"
if [ "$begin_count" -ne "$end_count" ] || [ "$begin_count" -gt 1 ]; then
  echo "Malformed managed operator MCP Caddy block; refusing to guess." >&2
  exit 1
fi

config_directory="$(dirname "$config_path")"
expected_block="$(mktemp "$config_directory/Caddyfile.operator.expected.XXXXXX")"
legacy_block="$(mktemp "$config_directory/Caddyfile.operator.legacy.XXXXXX")"
temporary_path="$(mktemp "$config_directory/Caddyfile.operator.XXXXXX")"
restore_temporary_path=""
cleanup() {
  rm -f "$expected_block" "$legacy_block" "$temporary_path"
  if [ -n "$restore_temporary_path" ]; then rm -f "$restore_temporary_path"; fi
}
trap cleanup EXIT

cat > "$expected_block" <<'CADDY_EOF'
    # BEGIN Recruiter Radar operator MCP (managed)
    @rr_operator_mcp path /api/internal/mcp /api/internal/mcp/* /.well-known/oauth-protected-resource /.well-known/oauth-protected-resource/*
    handle @rr_operator_mcp {
        reverse_proxy 127.0.0.1:3001 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-Proto https
            header_up Host recruiter-radar.ru
        }
    }

    # OAuth issuer has a path component. Expose only the endpoints required by the private MCP client.
    @rr_operator_oauth path \
        /operator/oauth/auth \
        /operator/oauth/auth/* \
        /operator/oauth/token \
        /operator/oauth/token/revocation \
        /operator/oauth/jwks \
        /operator/oauth/reg \
        /operator/oauth/interaction/* \
        /operator/oauth/.well-known/openid-configuration \
        /.well-known/oauth-authorization-server/operator/oauth
    handle @rr_operator_oauth {
        header Cache-Control "no-store"
        reverse_proxy 127.0.0.1:3002 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-Proto https
            header_up Host recruiter-radar.ru
        }
    }
    # END Recruiter Radar operator MCP (managed)
CADDY_EOF

# Exact previous production contract. It is the only managed block that may be
# migrated automatically. Anything else is treated as configuration drift.
cat > "$legacy_block" <<'CADDY_EOF'
    # BEGIN Recruiter Radar operator MCP (managed)
    @rr_operator_mcp path /api/internal/mcp /api/internal/mcp/* /.well-known/oauth-protected-resource /.well-known/oauth-protected-resource/*
    handle @rr_operator_mcp {
        # Same ingress trust boundary as the public app; never preserve client-supplied forwarding headers.
        reverse_proxy localhost:3001 {
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

  set +e
  reload_caddy
  reload_status=$?
  set -e
  if [ "$reload_status" -ne 0 ]; then
    set +e
    restore_status=0
    restored_validation_status=1
    restored_reload_status=1
    restore_installed=false
    restore_temporary_path="$(mktemp "$config_directory/Caddyfile.operator.restore.XXXXXX")" || restore_status=$?
    if [ "$restore_status" -eq 0 ]; then cp "$backup_path" "$restore_temporary_path" || restore_status=$?; fi
    if [ "$restore_status" -eq 0 ]; then chmod --reference="$backup_path" "$restore_temporary_path" || restore_status=$?; fi
    if [ "$restore_status" -eq 0 ]; then chown --reference="$backup_path" "$restore_temporary_path" || restore_status=$?; fi
    if [ "$restore_status" -eq 0 ]; then
      caddy validate --config "$restore_temporary_path" --adapter caddyfile
      restored_validation_status=$?
    fi
    if [ "$restore_status" -eq 0 ] && [ "$restored_validation_status" -eq 0 ]; then
      mv "$restore_temporary_path" "$config_path"
      restore_status=$?
      if [ "$restore_status" -eq 0 ]; then restore_temporary_path=""; restore_installed=true; fi
    fi
    if [ "$restore_installed" = "true" ]; then reload_caddy; restored_reload_status=$?; fi
    set -e

    if [ "$restore_status" -ne 0 ]; then
      echo "Previous Caddyfile could not be restored atomically." >&2
    elif [ "$restored_validation_status" -ne 0 ]; then
      echo "Restored Caddyfile failed validation; reload was not attempted." >&2
    elif [ "$restored_reload_status" -ne 0 ]; then
      echo "The restored Caddyfile could not be reloaded." >&2
    fi
    echo "Operator MCP Caddy reload failed; previous configuration restore was attempted." >&2
    exit "$reload_status"
  fi
}

if [ "$begin_count" -eq 1 ]; then
  existing_block="$(mktemp "$config_directory/Caddyfile.operator.existing.XXXXXX")"
  awk -v begin="$begin_marker" -v end="$end_marker" '
    $0 == begin { capture = 1 }
    capture { print }
    $0 == end { capture = 0 }
  ' "$config_path" > "$existing_block"

  if cmp -s "$expected_block" "$existing_block"; then
    rm -f "$existing_block"
    caddy validate --config "$config_path" --adapter caddyfile
    echo "Caddy already routes the bounded MCP and OAuth paths to loopback services."
    exit 0
  fi

  if cmp -s "$legacy_block" "$existing_block"; then
    rm -f "$existing_block"
    if [ "$enabled" = "false" ]; then
      caddy validate --config "$config_path" --adapter caddyfile
      echo "Operator MCP is fail-dark; preserving the exact audited legacy MCP-only Caddy block without exposing OAuth routes."
      exit 0
    fi

    awk -v begin="$begin_marker" -v end="$end_marker" -v block="$expected_block" '
      $0 == begin && !replaced {
        while ((getline line < block) > 0) print line
        close(block)
        replacing = 1
        replaced = 1
        next
      }
      replacing {
        if ($0 == end) replacing = 0
        next
      }
      { print }
      END { if (!replaced || replacing) exit 42 }
    ' "$config_path" > "$temporary_path"
    install_candidate "$temporary_path"
    echo "Migrated the exact audited legacy MCP-only Caddy block to the local OAuth contract."
    exit 0
  fi

  rm -f "$existing_block"
  echo "Managed operator MCP Caddy block differs from the audited current and legacy contracts; refusing to overwrite it." >&2
  exit 1
fi

# With no owner credential, do not create a public OAuth routing surface on a
# fresh host. The MCP route itself remains fail-dark in the application.
if [ "$enabled" = "false" ]; then
  caddy validate --config "$config_path" --adapter caddyfile
  echo "Operator MCP is fail-dark; no managed Caddy block was installed."
  exit 0
fi

main_marker_count="$(grep -Fxc "$main_proxy_marker" "$config_path" || true)"
if [ "$main_marker_count" -ne 1 ]; then
  echo "Canonical Recruiter Radar public proxy boundary is missing; run configure-caddy-real-ip.sh first." >&2
  exit 1
fi

awk -v target="$main_proxy_marker" -v block="$expected_block" '
  $0 == target && !inserted {
    while ((getline line < block) > 0) print line
    close(block)
    inserted = 1
  }
  { print }
  END { if (!inserted) exit 42 }
' "$config_path" > "$temporary_path"

install_candidate "$temporary_path"
echo "Caddy now routes MCP to 127.0.0.1:3001 and only required OAuth paths to 127.0.0.1:3002."
