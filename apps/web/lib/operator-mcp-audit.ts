type OperatorMcpAuditEvent = {
  requestId: string
  subject: string
  tool: string
  args: Record<string, unknown>
  status: 'ok' | 'error' | 'denied'
  durationMs: number
  deploySha: string | null
  mutationTarget?: string | null
  error?: string
}

const SAFE_ARGUMENT_KEYS = new Set([
  'service',
  'sinceSeconds',
  'limit',
  'days',
  'minSamples',
  'services',
])

export function writeOperatorMcpAuditEvent(event: OperatorMcpAuditEvent) {
  const safeArgs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event.args)) {
    if (SAFE_ARGUMENT_KEYS.has(key)) safeArgs[key] = value
    if (key === 'idempotencyKey') safeArgs.idempotencyKeyPresent = true
  }

  const record = {
    event: 'rr_operator_mcp_audit',
    timestamp: new Date().toISOString(),
    requestId: safeToken(event.requestId, 128),
    subject: safeToken(event.subject, 160),
    tool: safeToken(event.tool, 120),
    args: safeArgs,
    status: event.status,
    durationMs: Math.max(0, Math.round(event.durationMs)),
    deploySha: safeSha(event.deploySha),
    mutationTarget: event.mutationTarget
      ? safeToken(event.mutationTarget, 120)
      : null,
    ...(event.error ? { error: safeToken(event.error, 120) } : {}),
  }

  // stdout is intentionally used instead of the production database. The
  // operator DB credential remains read-only and Docker's bounded service logs
  // retain the security trail without creating a hidden write path.
  console.info(JSON.stringify(record))
}

function safeToken(value: string, maximum: number): string {
  return value.replace(/[^A-Za-z0-9:._|@/-]/g, '_').slice(0, maximum)
}

function safeSha(value: string | null): string | null {
  return value && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null
}
