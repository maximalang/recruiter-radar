#!/bin/sh
set -eu

echo "=== Recruiter Radar — Docker Entrypoint ==="

operator_mode="${RR_OPERATOR_MODE:-false}"
case "$operator_mode" in
  true | false) ;;
  *)
    echo "RR_OPERATOR_MODE must be exactly true or false" >&2
    exit 1
    ;;
esac

if [ "$operator_mode" = "true" ]; then
  # The operator container is a diagnostics/control resource server, not an
  # application worker. It must never run startup migrations or payment
  # reconciliation because its database credential is intentionally read-only.
  echo "RR_OPERATOR_MODE=true — skipping all startup database mutations."
else
  # Run database migrations before starting the public application.
  # Migrations are idempotent — safe to run on every normal web deploy.
  if [ -n "${DATABASE_URL:-}" ] && [ "${MIGRATE_ON_START:-}" != "false" ]; then
    echo "Running database migrations..."
    node packages/db/scripts/migrate.mjs
    echo "Migrations complete."
  else
    if [ "${MIGRATE_ON_START:-}" = "false" ]; then
      echo "MIGRATE_ON_START=false — skipping migrations (run externally)."
    else
      echo "DATABASE_URL not set — skipping migrations."
    fi
  fi

  if [ -n "${DATABASE_URL:-}" ]; then
    echo "Reconciling payment telemetry..."
    if ! timeout -s TERM 45 \
      node packages/db/scripts/reconcile-payment-success-telemetry.mjs; then
      echo "Payment telemetry reconciliation failed; application startup continues." >&2
    fi
  else
    echo "DATABASE_URL not set — skipping payment telemetry reconciliation."
  fi
fi

echo "Starting application..."
exec node apps/web/server.js
