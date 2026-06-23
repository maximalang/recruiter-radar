# Daily Radar — Railway native cron

This is a **separate Railway service** that triggers the daily pipeline on a
schedule, using Railway's built-in cron. It replaces n8n in the critical path:
n8n stays available for orchestration/alerts, but the daily run no longer
depends on it being deployed, configured, and active.

## How it works

Railway runs a service with `cronSchedule` as a **scheduled one-off**: it starts
the container on schedule, runs the command to completion, then stops it. There
is no 24/7 process and no volume — the service is stateless.

`cron/trigger-daily-radar.mjs` makes a single authenticated POST to the web
service's `POST /api/cron/daily-radar` endpoint and exits. The web service does
all the work (ingest → digest → Telegram delivery); this service is just the clock.

```
Railway cron (03:00 UTC / 06:00 MSK)
  └─ one-off container: node trigger-daily-radar.mjs
       └─ POST https://<web>/api/cron/daily-radar  (x-api-key: CRON_API_KEY)
            └─ web: ingest sources → generate digests → deliver to Telegram
```

## Setup (Railway Dashboard)

### 1. Create the service
- Railway Dashboard → your project → **New** → **GitHub Repo** (same repo).
- New service → **Settings → Build**:
  - **Config-as-code path** = `cron/railway.toml`
    (or set **Root Directory** = `cron/` — either makes Railway use this config).

### 2. Set environment variables (Dashboard → Variables)
Never commit these — they live only in Railway.

| Variable | Value | Notes |
|---|---|---|
| `RR_CRON_URL` | `http://<web-service>.railway.internal:3000/api/cron/daily-radar` | **Prefer the Railway-internal URL** — no public egress, no extra exposure. Use the public `https://…up.railway.app/api/cron/daily-radar` only if internal networking is off. |
| `CRON_API_KEY` | *(same value as the web service)* | Must match the web service's `CRON_API_KEY`, or the POST returns `401`. |
| `RR_CRON_TIMEOUT_MS` | `600000` | Optional. Request timeout (default 10 min). The pipeline ingests sources and delivers digests, so keep it generous. |

### 3. Verify the schedule
`cronSchedule = "0 3 * * *"` in `cron/railway.toml` is **UTC** → 06:00 MSK.
Change it there (config-as-code), not in the Dashboard, to keep it versioned.

### 4. Test it
- Service → **Deployments** → trigger a manual run (Railway lets you run a
  cron service on demand), or wait for the schedule.
- Watch the logs for `[trigger-daily-radar] INFO pipeline ran — HTTP 200`
  (or `207` for a partial run). `HTTP 401` = `CRON_API_KEY` mismatch with web.

## Exit codes (for log/alert triage)
| Code | Meaning |
|---|---|
| `0` | Pipeline ran — HTTP 200 (fully OK) or 207 (partial; some source/digest failed but the run completed). |
| `1` | Misconfiguration — `RR_CRON_URL` or `CRON_API_KEY` not set. |
| `2` | Request failed — network error, timeout, or non-2xx HTTP status (e.g. 401/422/500). |

## Relationship to n8n
`n8n/workflows/hh-daily.json` also calls `POST /api/cron/daily-radar` at 06:00 MSK.
**Run only one of the two** to avoid double-delivery. With this cron service active,
deactivate the `hh-daily` workflow in n8n (keep `career-pages-daily` /
`operational-alerts` there if you use them, on different schedules).
