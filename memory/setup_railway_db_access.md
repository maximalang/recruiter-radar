---
name: setup-railway-db-access
description: How to reach the live prod Postgres (Railway) and apply migrations from a local session — public TCP-proxy URL, not localhost Docker
metadata:
  type: reference
---

Prod DB is **Railway Postgres** in project `refreshing-solace` (env `production`), service named `Postgres`. The local `.env` `DATABASE_URL` points at `localhost:5432` (dev Docker, usually down) — that is NOT prod.

**Reach prod from a local session** (Railway CLI is logged in as maximal04040404@gmail.com):
```
railway variables --service Postgres --kv | grep -E '^DATABASE_PUBLIC_URL='
```
- `DATABASE_URL` is the *internal* `postgres.railway.internal:5432` host — only reachable inside Railway, useless locally.
- `DATABASE_PUBLIC_URL` routes through the TCP proxy (`*.proxy.rlwy.net:<port>`) — use THIS locally.
- `railway status` / `railway service` (interactive) frequently time out on this network; querying `railway variables --service Postgres` by explicit name works. Retry on transient `operation timed out`.

**Apply migrations to prod** — pass the public URL inline so it wins over `.env` (migrate.mjs `loadEnvFile` skips any key already in `process.env`, so env-passed DATABASE_URL is authoritative; never write the secret to a file):
```
DATABASE_URL="<DATABASE_PUBLIC_URL>" npm run db:migrate
```

**Railway auto-applies migrations on deploy:** as of 2026-06-27 the delivery-channels migration (`20260627120000_…`) was already recorded in `schema_migrations` on prod right after the merge to `main` — so a push to main is enough; manual `db:migrate` is only a verification/backfill path. Confirm with a direct `schema_migrations` + `to_regclass` query rather than assuming.

Railway MCP server (`mcp__railway__*`) needs a separate **Account token** (`RAILWAY_API_TOKEN`), which is NOT set in this env — the CLI login does not feed it. See [[setup-railway-mcp]]. CLI (`railway run`, `railway variables`) is the working path today.
