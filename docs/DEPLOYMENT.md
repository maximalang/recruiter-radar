# Deployment — Recruiter Radar

## Current Deploy Flow (as of 2026-06-09)

```
git push origin main
       │
       ▼
GitHub Actions: test.yml
  ├─ test job (Node 22, tsc + jest + 745 tests)
  └─ build job (Node 22, Postgres service)
       ├─ migrations: npm run db:migrate (21 migrations)
       ├─ docker build -f apps/web/Dockerfile (repo root context)
       └─ smoke test: docker run --network host, /api/health → 200
       │
       ▼  (NO push to container registry — image is discarded)
Railway: autodeploy on push to main (railway.toml configured)
  ├─ rebuilds from Dockerfile (Node 22-alpine)
  ├─ docker-entrypoint.sh
  │    ├─ MIGRATE_ON_START=true (default): runs npm run db:migrate
  │    └─ MIGRATE_ON_START=false: skip (when migrations run externally)
  ├─ starts: node apps/web/server.js  (standalone output, PORT=3000)
  └─ healthcheck: GET /api/health every 30s (DB + Redis probes)
```

### Railway configuration

Defined in `railway.toml` (committed to repo):
- **Branch:** `main`
- **Builder:** Dockerfile at `apps/web/Dockerfile`
- **Healthcheck:** `/api/health` (timeout 120s)
- **Restart:** ON_FAILURE, max 3 retries

### Migration flow (NO duplication)

| Step | Runs migrations? | Where |
|---|---|---|
| CI build job | ✅ Yes — before container start | Outside Docker, directly against CI Postgres |
| CI smoke container | ❌ No — `MIGRATE_ON_START=false` | Inside Docker, skips entrypoint migration |
| Railway production | ✅ Yes — on every deploy | Inside Docker, entrypoint runs `migrate.mjs` |

Migrations are **idempotent** — safe to run on every deploy. Only one path runs them per environment.

---

## Required Secrets (Railway env vars)

### Core (mandatory — app won't start without these)

| Variable | Description | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Railway-provided Postgres service or external |
| `SESSION_SECRET` | ≥32 chars, signs rr_sid cookies | Generate: `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | Public URL of the app | e.g. `https://recruiter-radar.up.railway.app` |
| `AUTH_SITE_URL` | Canonical HTTPS origin for one-time login links | Usually the same value as `NEXT_PUBLIC_APP_URL` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | SMTP transport for passwordless account login | Without it login requests stay generic but no email is delivered |

### Telegram (mandatory for digest delivery)

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook verification |

### Billing (mandatory for self-serve)

| Variable | Description |
|---|---|
| `BILLING_WEBHOOK_SECRET` | Webhook signing key |

### Optional but operational

| Variable | Description |
|---|---|
| `REDIS_URL` | If set: distributed rate limiting. Without: in-memory fallback |
| `SESSION_SECURE_COOKIE` | Set `true` in production (HTTPS). Default assumes HTTPS |
| `DIGEST_API_KEY` | API key for digest endpoints |
| `DIGEST_CALLBACK_SECRET` | Callback verification |
| `MIGRATE_ON_START` | `true` (default) or `false` to skip entrypoint migrations |

### Source-specific (set per source as needed)

See `.env.example` for full list of source env vars (HH, LinkedIn, SuperJob, etc.)

---

## Pre-Deploy Checks

Run **before** merging to `main` (which triggers deploy):

```bash
# 1. Type check
npm run web:check

# 2. Tests (must run from apps/web cwd)
cd apps/web && npm test

# 3. DB migration validation (ensure SQL syntax is valid)
npm run db:validate

# 4. If migrations changed: review schema consistency
#    - Read the migration .sql file
#    - Confirm no destructive changes (DROP, ALTER COLUMN type change)
#    - Confirm .down.sql exists for rollback

# 5. Build (only if routes/middleware/next.config changed)
npm run web:build
```

---

## Post-Deploy Checks

Run **after** Railway deployment completes:

```bash
# 1. Health endpoint
curl -s https://<APP_URL>/api/health
# Expected: {"status":"healthy","db":"ok","redis":"ok" or "unavailable"}

# 2. Check Railway deploy logs for migration output
#    Should see "Migration summary: X applied, Y skipped"

# 3. Smoke: landing page loads
curl -sf https://<APP_URL>/ -o /dev/null

# 4. Smoke: Telegram webhook is set
#    Verify via @BotFather or manual GET to webhook info endpoint
```

---

## Rollback Steps

### Option A: Railway re-deploy previous commit (fastest)

1. Open Railway dashboard → Deployments
2. Click "Redeploy" on the previous successful deployment
3. This builds the same commit again — takes a few minutes

### Option B: Git revert (if re-deploy unavailable)

```bash
# 1. Identify the broken commit
git log --oneline -5 main

# 2. Revert the merge/commit
git revert <commit-sha>
git push origin main
# This triggers a new Railway deploy with the reverted code.

# 3. If a migration was applied that needs undoing:
#    Read packages/db/migrations/<migration>.down.sql
#    Apply manually via psql or Railway shell
```

### Option C: Emergency — disable autodeploy

1. Railway dashboard → Service → Settings → Auto Deploy → OFF
2. Fix the issue on a branch, test
3. Re-enable autodeploy

---

## Key Technical Details

### Docker image structure

- **Base:** `node:22-alpine` (Next.js 16 requires Node >= 20.9.0)
- **Build context:** repo root (not `apps/web/`) — Dockerfile needs `packages/db/`
- **Standalone output:** Next.js standalone places `server.js` at `apps/web/server.js`
- **Static files:** Copied to `./apps/web/.next/static` (matches server's expected path)
- **No `public/` directory** — no static assets yet (removed COPY)

### Health check endpoint

`GET /api/health` returns:
```json
{
  "status": "healthy",
  "db": "ok",
  "redis": "ok" | "unavailable" | "error",
  "timestamp": "2026-06-09T..."
}
```
- `redis: "unavailable"` is OK (REDIS_URL not set)
- `redis: "error"` is unhealthy (REDIS_URL set but connection fails)
- HTTP 200 = healthy, 503 = unhealthy

---

## Target Deployment Flows

### Current (minimum safe flow)

- ✅ `railway.toml` pins deploy config in repo
- ✅ Migrations auto-run on every deploy via docker-entrypoint.sh
- ✅ CI runs test + build + smoke before Railway deploys
- ✅ Healthcheck monitors DB + Redis
- ❌ No separate staging service
- ❌ No branch protection on main
- ❌ No deploy notification

### Ideal flow (later)

1. **Separate staging service** on Railway: `develop` branch → staging, `main` → production
2. **PR review required** on GitHub: branch protection on `main` requiring 1 approval + passing CI
3. **Deploy gate**: Railway autodeploy OFF on production; manual deploy button after review
4. **Pre-deploy migration check**: CI job that verifies migrations on a DB clone
5. **Post-deploy smoke test**: automated curl against `/api/health` after each Railway deploy
6. **Rollback automation**: Railway redeploy previous on healthcheck failure
7. **Deploy log**: tag each deploy with git SHA + timestamp in a `deploys` table

---

## Quick Reference

| Command | Purpose |
|---|---|
| `npm run web:check` | TypeScript check |
| `npm run web:build` | Next.js production build |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:validate` | Validate migration SQL syntax |
| `curl /api/health` | Health check (DB + Redis) |
| `docker build -f apps/web/Dockerfile .` | Build Docker image (from repo root!) |
