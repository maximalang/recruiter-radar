#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
validator="$repo_root/scripts/deploy/validate-metrika-id.sh"
temporary_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

sh "$validator" "12345"
sh "$validator" "123456789012"

for invalid_value in "" "1234" "1234567890123" "1234x"; do
  if sh "$validator" "$invalid_value" \
    > "$temporary_dir/stdout.log" \
    2> "$temporary_dir/stderr.log"; then
    echo "Invalid Metrika ID unexpectedly passed validation" >&2
    exit 1
  fi
  test ! -s "$temporary_dir/stdout.log"
  grep -Fxq \
    "NEXT_PUBLIC_YANDEX_METRIKA_ID is missing or invalid" \
    "$temporary_dir/stderr.log"
  if [ -n "$invalid_value" ]; then
    ! grep -Fq "$invalid_value" "$temporary_dir/stderr.log"
  fi
done

printf '%s\n' \
  '{"ok":true,"validLengths":[5,12],"invalid":["empty","short","long","non-numeric"],"valueLeaked":false}'
