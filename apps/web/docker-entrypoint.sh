#!/bin/sh
set -e

echo "=== Recruiter Radar — Docker Entrypoint ==="

# Run database migrations before starting the app.
# Migrations are idempotent — safe to run on every deploy.
# If DATABASE_URL is not set, skip gracefully.
# If MIGRATE_ON_START is set to "false", skip (useful when migrations
# are run externally, e.g. in CI before the container starts).
if [ -n "$DATABASE_URL" ] && [ "$MIGRATE_ON_START" != "false" ]; then
  echo "Running database migrations..."
  node packages/db/scripts/migrate.mjs
  echo "Migrations complete."
else
  if [ "$MIGRATE_ON_START" = "false" ]; then
    echo "MIGRATE_ON_START=false — skipping migrations (run externally)."
  else
    echo "DATABASE_URL not set — skipping migrations."
  fi
fi

if [ -n "$DATABASE_URL" ]; then
  echo "Reconciling payment telemetry..."
  if ! timeout -s TERM 45 \
    node packages/db/scripts/reconcile-payment-success-telemetry.mjs; then
    echo "Payment telemetry reconciliation failed; application startup continues." >&2
  fi
else
  echo "DATABASE_URL not set — skipping payment telemetry reconciliation."
fi

echo "Starting application..."
exec node apps/web/server.js
