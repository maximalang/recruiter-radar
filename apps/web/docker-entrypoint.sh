#!/bin/sh
set -e

echo "=== Recruiter Radar — Docker Entrypoint ==="

# Run database migrations before starting the app.
# Migrations are idempotent — safe to run on every deploy.
# If DATABASE_URL is not set (e.g. static export), skip gracefully.
if [ -n "$DATABASE_URL" ]; then
  echo "Running database migrations..."
  node packages/db/scripts/migrate.mjs
  echo "Migrations complete."
else
  echo "DATABASE_URL not set — skipping migrations."
fi

echo "Starting application..."
exec node server.js
