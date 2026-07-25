#!/usr/bin/env sh
set -eu

config_path="/etc/caddy/Caddyfile"
backup_path="/etc/caddy/Caddyfile.pre-recruiter-radar-real-ip"
target_site_line="recruiter-radar.ru {"
expected_proxy_line="    reverse_proxy localhost:3000"

if [ ! -f "$config_path" ]; then
  echo "Caddyfile is missing at $config_path" >&2
  exit 1
fi

site_block_count="$(
  awk -v target_site_line="$target_site_line" '
    $0 == target_site_line {
      count += 1
    }
    END { print count + 0 }
  ' "$config_path"
)"
if [ "$site_block_count" -ne 1 ]; then
  echo "Expected exactly one recruiter-radar.ru site block; refusing to guess." >&2
  exit 1
fi

managed_block_count="$(
  awk -v target_site_line="$target_site_line" -v expected_proxy_line="$expected_proxy_line" '
    $0 == target_site_line {
      in_target_site = 1
      next
    }
    in_target_site && $0 == "}" {
      in_target_site = 0
      next
    }
    in_target_site && $0 == expected_proxy_line " {" {
      if ((getline header) > 0 && header == "        header_up X-Real-IP {remote_host}") {
        if ((getline closing) > 0 && closing == "    }") {
          count += 1
        }
      }
    }
    END { print count + 0 }
  ' "$config_path"
)"
if [ "$managed_block_count" -gt 1 ]; then
  echo "Multiple managed Recruiter Radar proxy blocks found; refusing to guess." >&2
  exit 1
fi

proxy_line_count="$(
  awk -v target_site_line="$target_site_line" -v expected_proxy_line="$expected_proxy_line" '
    $0 == target_site_line {
      in_target_site = 1
      next
    }
    in_target_site && $0 == "}" {
      in_target_site = 0
      next
    }
    in_target_site && $0 == expected_proxy_line {
      count += 1
    }
    END { print count + 0 }
  ' "$config_path"
)"
if [ "$managed_block_count" -eq 1 ]; then
  if [ "$proxy_line_count" -ne 0 ]; then
    echo "Multiple recruiter-radar.ru proxy blocks found; refusing to guess." >&2
    exit 1
  fi
  caddy validate --config "$config_path" --adapter caddyfile
  echo "Caddy already overwrites X-Real-IP for Recruiter Radar."
  exit 0
fi
if [ "$proxy_line_count" -ne 1 ]; then
  echo "Unexpected recruiter-radar.ru reverse_proxy layout; refusing an unsafe rewrite." >&2
  exit 1
fi

temporary_path="$(mktemp /etc/caddy/Caddyfile.recruiter-radar.XXXXXX)"
cleanup() {
  rm -f "$temporary_path"
}
trap cleanup EXIT

awk -v target_site_line="$target_site_line" -v expected_proxy_line="$expected_proxy_line" '
  $0 == target_site_line {
    in_target_site = 1
    print
    next
  }
  in_target_site && $0 == "}" {
    in_target_site = 0
    print
    next
  }
  in_target_site && $0 == expected_proxy_line {
    print "    reverse_proxy localhost:3000 {"
    print "        header_up X-Real-IP {remote_host}"
    print "    }"
    next
  }
  { print }
' "$config_path" > "$temporary_path"

caddy validate --config "$temporary_path" --adapter caddyfile
cp "$config_path" "$backup_path"
chmod --reference="$config_path" "$temporary_path"
chown --reference="$config_path" "$temporary_path"
mv "$temporary_path" "$config_path"

if ! systemctl reload caddy; then
  cp "$backup_path" "$config_path"
  systemctl reload caddy
  echo "Caddy reload failed; the previous configuration was restored." >&2
  exit 1
fi

echo "Caddy now overwrites X-Real-IP from the direct client address."
