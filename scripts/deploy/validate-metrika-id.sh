#!/usr/bin/env sh
set -eu

metrika_id="${1:-}"

case "$metrika_id" in
  *[!0-9]* | ???? | ??????????????*)
    echo "NEXT_PUBLIC_YANDEX_METRIKA_ID is missing or invalid" >&2
    exit 1
    ;;
esac

if [ "${#metrika_id}" -lt 5 ] || [ "${#metrika_id}" -gt 12 ]; then
  echo "NEXT_PUBLIC_YANDEX_METRIKA_ID is missing or invalid" >&2
  exit 1
fi
