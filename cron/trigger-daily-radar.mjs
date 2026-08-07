/**
 * Cron trigger: Daily Radar
 *
 * Railway runs this as a scheduled one-off container. The trigger first runs
 * the established daily-radar pipeline for non-canary workspaces. When the
 * runtime mode is explicitly `canary`, it then invokes the single configured
 * Commercial Signal canary pipeline and its corporate-only enrichment queue.
 *
 * Required env:
 *   RR_CRON_URL   — full URL of /api/cron/daily-radar
 *   CRON_API_KEY  — must match the web service CRON_API_KEY
 *
 * Optional env:
 *   RR_CRON_TIMEOUT_MS — per-request timeout (default 600000)
 *   COMMERCIAL_SIGNAL_RUNTIME_MODE — `canary` enables canary stages
 *
 * Exit codes:
 *   0 — every required stage ran
 *   1 — configuration error
 *   2 — request/stage failure
 */

const url = process.env.RR_CRON_URL
const apiKey = process.env.CRON_API_KEY
const timeoutMs = Number(process.env.RR_CRON_TIMEOUT_MS ?? 600_000)
const commercialSignalMode = process.env.COMMERCIAL_SIGNAL_RUNTIME_MODE?.trim()

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
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
  log('ERROR', 'RR_CRON_TIMEOUT_MS must be a finite number >= 1000.')
  process.exit(1)
}

async function postStage(stageUrl, label, acceptedStatuses) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = new Date().toISOString()
  log('INFO', `POST ${stageUrl} (${label}, timeout ${timeoutMs}ms) at ${startedAt}`)
  try {
    const response = await fetch(stageUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    })
    const text = await response.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
    if (!acceptedStatuses.includes(response.status)) {
      throw new Error(`${label} returned HTTP ${response.status}: ${safePayload(payload)}`)
    }
    log('INFO', `${label} ran — HTTP ${response.status}`, payload)
    return payload
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${label} aborted after ${timeoutMs}ms timeout.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function safePayload(payload) {
  const value = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database-url]').slice(0, 1000)
}

try {
  await postStage(url, 'legacy daily radar', [200, 207])

  if (commercialSignalMode === 'canary') {
    const canaryUrl = new URL(
      '/api/cron/opportunities/run-commercial-signal-canary?apply=true',
      url,
    ).toString()
    await postStage(canaryUrl, 'Commercial Signal canary', [200])

    const enrichmentUrl = new URL(
      '/api/cron/opportunities/commercial-signal-enrichment?apply=true',
      url,
    ).toString()
    await postStage(enrichmentUrl, 'Commercial Signal corporate enrichment', [200])
  } else {
    log('INFO', 'Commercial Signal canary not scheduled; runtime mode is not canary.')
  }

  process.exit(0)
} catch (error) {
  log('ERROR', 'scheduled pipeline failed.', error?.message ?? error)
  process.exit(2)
}
