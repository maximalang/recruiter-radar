#!/usr/bin/env bash
# Recruiter Radar — VM-side source-refresh tick (sole authoritative tick generator).
# Invoked hourly by rr-source-refresh.timer (systemd, Persistent=true).
#
# Contract: docs/runbooks/source-refresh-vm-tick-authority.md §2/§4.3.
# - One HTTP call per tick to /api/cron/source-refresh carries authoritative
#   metadata. The endpoint atomically claims the ledger slot and, only when owned,
#   invokes the source refresh in-process.
# - No secrets in argv/env: CRON_API_KEY lives only inside the web runtime.
# - Exit codes: 0 = slot closed ok (success/degraded/no-op-422/duplicate),
#   1 = slot red (real failure, late, schema error, or endpoint unreachable).
set -euo pipefail

TICK_PATH="${TICK_PATH:-/api/cron/source-refresh}"
SOURCE_REFRESH_CLIENT_TIMEOUT_MS="${SOURCE_REFRESH_CLIENT_TIMEOUT_MS:-900000}" # 15 min
SLOT_GRACE_MINUTES=15

log() { printf '[source-refresh-tick] %s\n' "$*"; }

# --- slot + timestamps (all UTC, canonical) ---------------------------------
now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# slot_id = floor((now - 15min grace) / 1h) per protocol §2.1/§17.4
slot_floor_epoch=$(( $(date -u -d "$now_iso" +%s) - SLOT_GRACE_MINUTES * 60 ))
slot_floor_iso="$(date -u -d "@${slot_floor_epoch}" +%Y-%m-%dT%H:00:00)"
slot_id="${slot_floor_iso}Z"
scheduled_at="${slot_floor_iso}Z"

payload="$(printf '{"slot_id":"%s","scheduled_at":"%s","observed_at":"%s","authority":"vm-systemd"}' \
  "$slot_id" "$scheduled_at" "$now_iso")"

log "slot_id=${slot_id} observed_at=${now_iso}"

# --- single round-trip through the web container ----------------------------
# node inside the container does the ledger POST + (if owned) the refresh, and
# returns a compact JSON verdict on stdout. Exit code follows the verdict.
verdict="$(docker compose exec -T web node --input-type=module - "$TICK_PATH" "$SOURCE_REFRESH_CLIENT_TIMEOUT_MS" <<NODE_EOF
const http = await import('node:http')
const path = process.argv[2] ?? '${TICK_PATH}'
const timeoutMs = Number(process.argv[3] ?? 900000)
const key = process.env.CRON_API_KEY?.trim()
if (!key) throw new Error('CRON_API_KEY is not configured in the web runtime.')
const payload = String.raw\`${payload}\`
const response = await new Promise((resolve, reject) => {
  const request = http.request({
    hostname: '127.0.0.1',
    port: 3000,
    path,
    method: 'POST',
    headers: {
      'x-api-key': key,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    },
  }, (incoming) => {
    let rawBody = ''
    incoming.setEncoding('utf8')
    incoming.on('data', (chunk) => { rawBody += chunk })
    incoming.on('error', reject)
    incoming.on('end', () => {
      let body = null
      let parseError = null
      try { body = JSON.parse(rawBody) } catch (error) { parseError = String(error) }
      resolve({ status: incoming.statusCode ?? 0, body, parseError })
    })
  })
  request.setTimeout(timeoutMs, () => request.destroy(new Error('tick client timeout')))
  request.on('error', reject)
  request.end(payload)
})
const body = response.body
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const tickResult = isRecord(body) && typeof body.tick_result === 'string' ? body.tick_result : 'schema_error'
const slotOwned = isRecord(body) && body.slot_owned === true
// Exit-code mapping (runbook §4.3): green family -> 0, red family -> 1.
const zeroResults = new Set(['success', 'degraded_ok', 'no_op_422', 'duplicate_skipped'])
console.log(JSON.stringify({ status: response.status, tick_result: tickResult, slot_owned: slotOwned, parse_error: response.parseError }))
if (!zeroResults.has(tickResult)) process.exit(1)
NODE_EOF
)" || verdict_rc=$?

verdict_rc="${verdict_rc:-0}"
if [ "$verdict_rc" -ne 0 ]; then
  log "tick verdict RED (node rc=${verdict_rc}) verdict=${verdict:-<none>}"
  exit 1
fi

log "tick verdict ${verdict}"
exit 0
