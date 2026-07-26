#!/usr/bin/env sh
set -eu

config_path="${RR_CADDY_CONFIG_PATH:-/etc/caddy/Caddyfile}"
backup_path="${RR_CADDY_BACKUP_PATH:-/etc/caddy/Caddyfile.pre-recruiter-radar-real-ip}"
target_site_line="recruiter-radar.ru {"
expected_proxy_line="    reverse_proxy localhost:3000"
trust_boundary_comment="    # Trust boundary: overwrite client X-Real-IP at the only public ingress."
real_ip_header="        header_up X-Real-IP {remote_host}"
forwarded_proto_header="        header_up X-Forwarded-Proto https"
host_header="        header_up Host recruiter-radar.ru"

if [ ! -f "$config_path" ]; then
  echo "Caddyfile is missing at $config_path" >&2
  exit 1
fi

site_block_count="$(
  awk -v target_site_line="$target_site_line" '
    $0 == target_site_line { count += 1 }
    END { print count + 0 }
  ' "$config_path"
)"
if [ "$site_block_count" -ne 1 ]; then
  echo "Expected exactly one recruiter-radar.ru site block; refusing to guess." >&2
  exit 1
fi

proxy_layout="$(
  awk \
    -v target_site_line="$target_site_line" \
    -v expected_proxy_line="$expected_proxy_line" \
    -v trust_boundary_comment="$trust_boundary_comment" \
    -v real_ip_header="$real_ip_header" \
    -v forwarded_proto_header="$forwarded_proto_header" \
    -v host_header="$host_header" '
    $0 == target_site_line {
      in_target_site = 1
      target_closed = 0
      next
    }
    in_target_site && $0 == "}" {
      in_target_site = 0
      target_closed = 1
      next
    }
    in_target_site {
      lines[++line_count] = $0
    }
    END {
      if (!target_closed) {
        print "ambiguous"
        exit
      }

      proxy_count = 0
      proxy_index = 0
      comment_count = 0
      for (line_index = 1; line_index <= line_count; line_index += 1) {
        if (lines[line_index] ~ /^[[:space:]]*import([[:space:]]|$)/) {
          print "unknown"
          exit
        }
        if (lines[line_index] == trust_boundary_comment) {
          comment_count += 1
        }
        if (lines[line_index] == expected_proxy_line ||
            lines[line_index] == expected_proxy_line " {") {
          proxy_count += 1
          proxy_index = line_index
          continue
        }
        if (lines[line_index] ~ /^[[:space:]]*reverse_proxy([[:space:]]|$)/) {
          print "unknown"
          exit
        }
      }

      if (proxy_count > 1) {
        print "multiple"
        exit
      }
      if (proxy_count != 1 || comment_count > 1) {
        print "ambiguous"
        exit
      }

      if (lines[proxy_index] == expected_proxy_line) {
        if (comment_count != 0) {
          print "unknown"
          exit
        }
        print "bare"
        exit
      }

      comment_is_managed = proxy_index > 1 && \
        lines[proxy_index - 1] == trust_boundary_comment
      if (comment_count != comment_is_managed) {
        print "unknown"
        exit
      }

      if (comment_is_managed &&
          lines[proxy_index + 1] == real_ip_header &&
          lines[proxy_index + 2] == forwarded_proto_header &&
          lines[proxy_index + 3] == host_header &&
          lines[proxy_index + 4] == "    }") {
        print "canonical"
        exit
      }

      if (comment_is_managed &&
          lines[proxy_index + 1] == real_ip_header &&
          lines[proxy_index + 2] == "    }") {
        print "legacy"
        exit
      }

      print "unknown"
    }
  ' "$config_path"
)"

case "$proxy_layout" in
  canonical)
    caddy validate --config "$config_path" --adapter caddyfile
    echo "Caddy already enforces the Recruiter Radar upstream trust boundary."
    exit 0
    ;;
  bare | legacy)
    ;;
  multiple)
    echo "Multiple recruiter-radar.ru reverse_proxy blocks found; refusing to guess." >&2
    exit 1
    ;;
  unknown)
    echo "Unknown reverse_proxy directives found; refusing an unsafe Caddyfile rewrite." >&2
    exit 1
    ;;
  *)
    echo "Unexpected recruiter-radar.ru reverse_proxy layout; refusing an unsafe rewrite." >&2
    exit 1
    ;;
esac

config_directory="$(dirname "$config_path")"
temporary_path="$(mktemp "$config_directory/Caddyfile.recruiter-radar.XXXXXX")"
restore_temporary_path=""
cleanup() {
  rm -f "$temporary_path"
  if [ -n "$restore_temporary_path" ]; then
    rm -f "$restore_temporary_path"
  fi
}
trap cleanup EXIT

awk \
  -v target_site_line="$target_site_line" \
  -v expected_proxy_line="$expected_proxy_line" \
  -v trust_boundary_comment="$trust_boundary_comment" \
  -v real_ip_header="$real_ip_header" \
  -v forwarded_proto_header="$forwarded_proto_header" \
  -v host_header="$host_header" \
  -v proxy_layout="$proxy_layout" '
  function print_canonical_proxy() {
    print trust_boundary_comment
    print expected_proxy_line " {"
    print real_ip_header
    print forwarded_proto_header
    print host_header
    print "    }"
  }

  $0 == target_site_line {
    in_target_site = 1
    print
    next
  }
  in_target_site && skip_legacy_proxy {
    if ($0 == "    }") {
      skip_legacy_proxy = 0
    }
    next
  }
  in_target_site && $0 == "}" {
    in_target_site = 0
    print
    next
  }
  in_target_site &&
    proxy_layout == "legacy" &&
    $0 == trust_boundary_comment {
    next
  }
  in_target_site &&
    proxy_layout == "bare" &&
    $0 == expected_proxy_line {
    print_canonical_proxy()
    next
  }
  in_target_site &&
    proxy_layout == "legacy" &&
    $0 == expected_proxy_line " {" {
    print_canonical_proxy()
    skip_legacy_proxy = 1
    next
  }
  { print }
' "$config_path" > "$temporary_path"

caddy validate --config "$temporary_path" --adapter caddyfile
cp "$config_path" "$backup_path"
chmod --reference="$config_path" "$temporary_path"
chown --reference="$config_path" "$temporary_path"
mv "$temporary_path" "$config_path"
temporary_path=""

set +e
systemctl reload caddy
reload_status=$?
set -e
if [ "$reload_status" -ne 0 ]; then
  set +e
  restore_status=0
  restored_validation_status=1
  restored_reload_status=1
  restore_installed=false

  restore_temporary_path="$(
    mktemp "$config_directory/Caddyfile.restore.XXXXXX"
  )" || restore_status=$?
  if [ "$restore_status" -eq 0 ]; then
    cp "$backup_path" "$restore_temporary_path" || restore_status=$?
  fi
  if [ "$restore_status" -eq 0 ]; then
    chmod --reference="$backup_path" "$restore_temporary_path" ||
      restore_status=$?
  fi
  if [ "$restore_status" -eq 0 ]; then
    chown --reference="$backup_path" "$restore_temporary_path" ||
      restore_status=$?
  fi
  if [ "$restore_status" -eq 0 ]; then
    caddy validate --config "$restore_temporary_path" --adapter caddyfile
    restored_validation_status=$?
  fi
  if [ "$restore_status" -eq 0 ] &&
    [ "$restored_validation_status" -eq 0 ]; then
    mv "$restore_temporary_path" "$config_path"
    restore_status=$?
    if [ "$restore_status" -eq 0 ]; then
      restore_temporary_path=""
      restore_installed=true
    fi
  fi
  if [ "$restore_installed" = "true" ]; then
    systemctl reload caddy
    restored_reload_status=$?
  fi
  set -e

  if [ "$restore_status" -ne 0 ]; then
    echo "Previous Caddyfile could not be restored atomically." >&2
  elif [ "$restored_validation_status" -ne 0 ]; then
    echo "Restored Caddyfile failed validation; reload was not attempted." >&2
  elif [ "$restored_reload_status" -ne 0 ]; then
    echo "The restored Caddyfile could not be reloaded." >&2
  fi
  if [ "$restore_installed" = "true" ]; then
    echo "Caddy reload failed; the previous configuration was restored." >&2
  else
    echo "Caddy reload failed; the previous configuration was not replaced safely." >&2
  fi
  exit "$reload_status"
fi

echo "Caddy now enforces canonical Host, HTTPS forwarding, and trusted X-Real-IP."
