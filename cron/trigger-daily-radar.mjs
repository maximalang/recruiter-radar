/**
 * Cron trigger: Daily Radar
 *
 * Railway runs this as a scheduled one-off container (see cron/railway.toml).
 * It makes a single authenticated POST to the web service's daily-radar
 * endpoint, logs the outcome, and exits with a code that reflects success.
 *
 * This is deliberately dependency-free (Node 22 global fetch) so the cron
 * image stays tiny and builds in seconds — it does NOT reuse the web build.
 *
 * Required env:
 *   RR_CRON_URL   — full URL of the endpoint, e.g.
 *                   https://recruiter-radarweb-production.up.railway.app/api/cron/daily-radar
 *                   (Railway-internal URL is preferred to avoid egress + public exposure.)
 *   CRON_API_KEY  — must match the web service's CRON_API_KEY.
 *
 * Optional env:
 *   RR_CRON_TIMEOUT_MS — request timeout in ms (default 600000 = 10 min;
 *                        the pipeline ingests sources + delivers digests).
 *
 * Exit codes:
 *   0  — pipeline ran (HTTP 200 fully OK, or 207 partial — both are "ran")
 *   1  — configuration error (missing env)
 *   2  — request failed (network, timeout, or non-2xx HTTP status)
 */

const url = process.env.RR_CRON_URL
const apiKey = process.env.CRON_API_KEY
const timeoutMs = Number(process.env.RR_CRON_TIMEOUT_MS ?? 600_000)

function log(level, msg, extra) {
  const line = `[trigger-daily-radar] ${level} ${msg}`
  if (extra !== undefined) {
    console[level === 'ERROR' ? 'error' : 'log'](line, extra)
  } else {
    console[level === 'ERROR' ? 'error' : 'log'](line)
  }
}

if (!url) {
  log('ERROR', 'RR_CRON_URL is not set — cannot trigger the pipeline.')
  process.exit(1)
}
if (!apiKey) {
  log('ERROR', 'CRON_API_KEY is not set — the request would be rejected with 401.')
  process.exit(1)
}

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), timeoutMs)
const startedAt = new Date().toISOString()

log('INFO', `POST ${url} (timeout ${timeoutMs}ms) at ${startedAt}`)

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: '{}',
    signal: controller.signal,
  })

  const text = await res.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = text
  }

  // 200 = fully OK, 207 = partial (some source/digest failed but pipeline ran).
  // Both mean the cron did its job; operational alerts handle partials.
  if (res.status === 200 || res.status === 207) {
    log('INFO', `pipeline ran — HTTP ${res.status}`, payload)
    process.exit(0)
  }

  log('ERROR', `pipeline NOT run — HTTP ${res.status}`, payload)
  process.exit(2)
} catch (err) {
  if (err?.name === 'AbortError') {
    log('ERROR', `request aborted after ${timeoutMs}ms timeout.`)
  } else {
    log('ERROR', 'request failed.', err?.message ?? err)
  }
  process.exit(2)
} finally {
  clearTimeout(timer)
}
