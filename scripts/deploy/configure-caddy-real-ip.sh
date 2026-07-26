#!/usr/bin/env sh
set -eu

config_path="/etc/caddy/Caddyfile"
backup_path="/etc/caddy/Caddyfile.pre-recruiter-radar-real-ip"
target_site_line="recruiter-radar.ru {"
expected_proxy_line="    reverse_proxy localhost:3000"
trust_boundary_comment="    # Trust boundary: overwrite client X-Real-IP at the only public ingress."

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

canonical_block_count="$(
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
      if ((getline real_ip) > 0 && real_ip == "        header_up X-Real-IP {remote_host}" &&
          (getline forwarded_proto) > 0 && forwarded_proto == "        header_up X-Forwarded-Proto https" &&
          (getline host) > 0 && host == "        header_up Host recruiter-radar.ru" &&
          (getline closing) > 0 && closing == "    }") {
        count += 1
      }
    }
    END { print count + 0 }
  ' "$config_path"
)"
if [ "$canonical_block_count" -gt 1 ]; then
  echo "Multiple managed Recruiter Radar proxy blocks found; refusing to guess." >&2
  exit 1
fi

bare_proxy_line_count="$(
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
braced_proxy_line_count="$(
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
      count += 1
    }
    END { print count + 0 }
  ' "$config_path"
)"
trust_boundary_comment_count="$(
  awk -v target_site_line="$target_site_line" -v trust_boundary_comment="$trust_boundary_comment" '
    $0 == target_site_line {
      in_target_site = 1
      next
    }
    in_target_site && $0 == "}" {
      in_target_site = 0
      next
    }
    in_target_site && $0 == trust_boundary_comment {
      count += 1
    }
    END { print count + 0 }
  ' "$config_path"
)"
if [ "$trust_boundary_comment_count" -gt 1 ]; then
  echo "Multiple Recruiter Radar trust-boundary comments found; refusing to guess." >&2
  exit 1
fi
if [ "$canonical_block_count" -eq 1 ] && [ "$trust_boundary_comment_count" -eq 1 ]; then
  if [ "$bare_proxy_line_count" -ne 0 ] || [ "$braced_proxy_line_count" -ne 1 ]; then
    echo "Multiple recruiter-radar.ru proxy blocks found; refusing to guess." >&2
    exit 1
  fi
  caddy validate --config "$config_path" --adapter caddyfile
  echo "Caddy already enforces the Recruiter Radar upstream trust boundary."
  exit 0
fi
if [ "$((bare_proxy_line_count + braced_proxy_line_count))" -ne 1 ]; then
  echo "Unexpected recruiter-radar.ru reverse_proxy layout; refusing an unsafe rewrite." >&2
  exit 1
fi

temporary_path="$(mktemp /etc/caddy/Caddyfile.recruiter-radar.XXXXXX)"
cleanup() {
  rm -f "$temporary_path"
}
trap cleanup EXIT

awk -v target_site_line="$target_site_line" \
    -v expected_proxy_line="$expected_proxy_line" \
    -v trust_boundary_comment="$trust_boundary_comment" '
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
  in_target_site && skip_proxy {
    if ($0 == "    }") {
      skip_proxy = 0
    }
    next
  }
  in_target_site && $0 == trust_boundary_comment {
    next
  }
  in_target_site && $0 == expected_proxy_line {
    print trust_boundary_comment
    print "    reverse_proxy localhost:3000 {"
    print "        header_up X-Real-IP {remote_host}"
    print "        header_up X-Forwarded-Proto https"
    print "        header_up Host recruiter-radar.ru"
    print "    }"
    next
  }
  in_target_site && $0 == expected_proxy_line " {" {
    print trust_boundary_comment
    print "    reverse_proxy localhost:3000 {"
    print "        header_up X-Real-IP {remote_host}"
    print "        header_up X-Forwarded-Proto https"
    print "        header_up Host recruiter-radar.ru"
    print "    }"
    skip_proxy = 1
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

echo "Caddy now enforces canonical Host, HTTPS forwarding, and trusted X-Real-IP."
