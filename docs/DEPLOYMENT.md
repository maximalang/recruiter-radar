# Deployment — Recruiter Radar

## Current Deploy Flow (as of 2026-06-09)

```
git push origin main
       │
       ▼
GitHub Actions: test.yml
  ├─ test job (always on push to main)
  └─ build job (push to main or tag)
       ├─ docker build -f apps/web/Dockerfile
       └─ smoke test: container starts, /api/health → 200
       │
       ▼  (NO push to container registry — image is discarded)
Railway: autodeploy(?) on push to main
  ├─ rebuilds from Dockerfile
  ├─ starts: node server.js  (PORT=3000)
  └─ healthcheck: GET /api/health every 30s
```

### What actually triggers Railway deploy

**Unconfirmed.** There is no `railway.toml`, no `railway.json`, and no deploy hook in CI.
The likely scenario: Railway GitHub integration is connected to `maximalang/recruiter-radar`,
listening on `main` branch with autodeploy ON — but this must be verified in Railway dashboard.

**Verify now:**
1. `railway status` (if CLI installed) or open Railway dashboard → project → service → Settings
2. Check "GitHub Repo" points to `maximalang/recruiter-radar`
3. Check "Branch" = `main`
4. Check "Auto Deploy" = ON or OFF
5. Check service type = **production** or **staging**

### Migration gap (CRITICAL)

The Dockerfile does **not** run migrations. The app starts against whatever DB schema exists.
If a deploy includes a migration that adds columns/tables, the new code will fail until migrations
are run manually.

**Current manual step:**
```bash
# Must be run AFTER Railway deploy starts but BEFORE app serves traffic
# Railway CLI or inside a Railway shell:
npm run db:migrate
```

This is the biggest operational risk — see "Target flow" below for fixes.

---

## Required Secrets (Railway env vars)

### Core (mandatory — app won't start without these)

| Variable | Description | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Railway-provided Postgres service or external |
| `SESSION_SECRET` | ≥32 chars, signs rr_sid cookies | Generate: `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | Public URL of the app | e.g. `https://recruiter-radar.up.railway.app` |

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

### Source-specific (set per source as needed)

| Variable | Description |
|---|---|
| `HH_USER_AGENT` | Must be real registered app — placeholder is 403'd |
| `OPENAI_API_KEY` | Required for Firecrawl structured extraction |
| `FIRECRAWL_API_KEY` | If using SaaS Firecrawl |

---

## Pre-Deploy Checks

Run **before** merging to `main` (which triggers deploy):

```bash
# 1. Type check
npm run web:check

# 2. Tests
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

# 2. Migrations are up to date
#    Either run: npm run db:migrate
#    Or check Railway deploy logs for migration output

# 3. Smoke: landing page loads
curl -sf https://<APP_URL>/ -o /dev/null

# 4. Smoke: Telegram webhook is set
#    Verify via @BotFather or manual GET to webhook info endpoint
```

---

## Rollback Steps

### Option A: Railway re-deploy previous commit (fastest)

```bash
# 1. Find the last working deploy in Railway dashboard → Deployments
# 2. Click "Redeploy" on the previous successful deployment
# This builds the same commit again — takes a few minutes.
```

### Option B: Git revert (if re-deploy unavailable)

```bash
# 1. Identify the broken commit
git log --oneline -5 main

# 2. Revert the merge/commit
git revert <commit-sha>
git push origin main
# This triggers a new Railway deploy with the reverted code.

# 3. If a migration was applied that needs undoing:
npm run db:migrate  # won't undo — use down.sql manually:
# Read packages/db/migrations/<migration>.down.sql
# Apply manually via psql or Railway shell
```

### Option C: Emergency — disable autodeploy

```bash
# Railway dashboard → Service → Settings → Auto Deploy → OFF
# Then fix the issue on a branch, test, re-enable autodeploy.
```

---

## Target Deployment Flows

### Minimum safe flow (implement now)

1. **Add `railway.toml`** to pin deploy config in repo (branch, build, healthcheck)
2. **Add a `release` npm script** that runs migrations then starts the app:
   ```
   "release": "npm run db:migrate && node .next/standalone/server.js"
   ```
   Update Dockerfile CMD to use this script (or run migrate in a startup command).
3. **Verify autodeploy settings** in Railway dashboard — confirm branch = `main`, autodeploy = ON
4. **Add Railway deploy notification** — set `RAILWAY_DEPLOY_HOOK` or use Railway webhook to alert on deploy success/failure

### Ideal flow (later)

1. **Separate staging service** on Railway: `develop` branch → staging, `main` → production
2. **PR review required** on GitHub: branch protection on `main` requiring 1 approval + passing CI
3. **Deploy gate**: Railway autodeploy OFF on production; manual deploy button after review
4. **Pre-deploy migration check**: CI job that verifies migrations can be applied on a DB clone
5. **Post-deploy smoke test**: automated curl against `/api/health` after each Railway deploy
6. **Rollback automation**: Railway redeploy previous on healthcheck failure (Railway supports this natively)
7. **Deploy log**: tag each deploy with git SHA + timestamp in a `deploys` table or log

---

## Quick Reference

| Command | Purpose |
|---|---|
| `npm run web:check` | TypeScript check |
| `npm run web:build` | Next.js production build |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:validate` | Validate migration SQL syntax |
| `curl /api/health` | Health check (DB + Redis) |
| `docker build -f apps/web/Dockerfile .` | Build Docker image |
