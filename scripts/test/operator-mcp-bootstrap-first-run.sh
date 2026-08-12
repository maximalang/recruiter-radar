#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bootstrap="$repo_root/scripts/deploy/configure-operator-mcp.sh"
sandbox="$(mktemp -d)"
cleanup() {
  rm -rf "$sandbox"
}
trap cleanup EXIT

app_dir="$sandbox/app"
fake_bin="$sandbox/bin"
marker="$sandbox/compose-preflight-ok"
mkdir -p "$app_dir/scripts/operator-mcp" "$fake_bin"
: > "$app_dir/.env"
cat > "$app_dir/compose.yml" <<'YAML'
services:
  web:
    image: recruiter-radar-web:test
  db:
    image: postgres:16
YAML
cp "$repo_root/scripts/operator-mcp/rr-operator-agent.py" "$app_dir/scripts/operator-mcp/rr-operator-agent.py"

cat > "$fake_bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  inspect)
    if [ "${2:-}" = "--format" ]; then
      printf '%s\n' 'recruiter-radar-web:test'
    fi
    exit 0
    ;;
  exec)
    printf '%s\n' 'recruiter_radar'
    exit 0
    ;;
  compose)
    shift
    last_compose=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -f)
          [ "$#" -ge 2 ] || exit 90
          last_compose="$2"
          shift 2
          ;;
        *) shift ;;
      esac
    done
    [ -n "$last_compose" ] || exit 91
    [ -f "$last_compose" ] || exit 92
    env_path="$(awk '/env_file:/{getline; sub(/^[[:space:]]*-[[:space:]]*/, ""); print; exit}' "$last_compose")"
    [ -n "$env_path" ] || exit 93
    [ -f "$env_path" ] || {
      echo "compose preflight referenced a missing env_file: $env_path" >&2
      exit 94
    }
    [ "$env_path" != "$RR_APP_DIR/.rr-operator.env" ] || {
      echo "first-run preflight referenced permanent operator env before installation" >&2
      exit 95
    }
    : > "$RR_TEST_MARKER"
    exit 0
    ;;
  *)
    echo "unexpected docker invocation: $*" >&2
    exit 96
    ;;
esac
SH
chmod +x "$fake_bin/docker"

[ ! -e "$app_dir/.rr-operator.env" ]
[ ! -e "$app_dir/.rr-operator.compose.yml" ]

PATH="$fake_bin:$PATH" \
RR_APP_DIR="$app_dir" \
RR_TEST_MARKER="$marker" \
RR_MCP_ENABLED=false \
RR_MCP_MUTATIONS_ENABLED=false \
RR_DEPLOY_SHA=1111111111111111111111111111111111111111 \
  bash "$bootstrap" --preflight >/dev/null

[ -f "$marker" ]
[ ! -e "$app_dir/.rr-operator.env" ]
[ ! -e "$app_dir/.rr-operator.compose.yml" ]
if find "$app_dir" -maxdepth 1 -name '.rr-operator.*.??????' -print -quit | grep -q .; then
  echo "operator preflight left temporary bootstrap material behind" >&2
  exit 1
fi

printf '%s\n' '{"ok":true,"operatorFirstBootstrapPreflight":"validated"}'
