import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  TIMEWEB_MCP_PREAUTH_RATE_LIMIT,
  checkTimewebMcpRateLimit,
  getTimewebMcpAuthenticateChallenge,
  isTimewebMcpConfigured,
  verifyTimewebMcpAccessToken,
} from '../../../../lib/timeweb-mcp-auth'
import { withSingleTimewebMcpRecovery } from '../../../../lib/timeweb-mcp-recovery'
import {
  handleTimewebMcpProtocol,
  isJsonRpcRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../../../../lib/timeweb-mcp-router'
import {
  timewebMcpSessionManager,
  type TimewebMcpSession,
} from '../../../../lib/timeweb-mcp-session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const TIMEWEB_MCP_UPSTREAM = 'https://timeweb.cloud/api/v1/mcp'
export const TIMEWEB_MCP_MAX_BODY_BYTES = 1024 * 1024
export const TIMEWEB_MCP_TIMEOUT_MS = 30_000

const RESPONSE_HEADERS = ['cache-control', 'retry-after'] as const

type AuthorizedContext = {
  requestId: string
  baseHeaders: Record<string, string>
  session: TimewebMcpSession
}

type UpstreamAttempt = {
  response: JsonRpcResponse | null
  status: number
  sessionId: string | null
  expired: boolean
}

class UpstreamBridgeError extends Error {
  constructor(readonly status: 502 | 504, message: string) {
    super(message)
    this.name = 'UpstreamBridgeError'
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'GET, POST, DELETE, OPTIONS',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function GET(request: Request) {
  const authorized = await authorize(request)
  if (authorized instanceof Response) return authorized
  try {
    return await proxyTransport(request, authorized)
  } catch (error) {
    return bridgeFailure(authorized, request.method, error)
  }
}

export async function POST(request: Request) {
  const authorized = await authorize(request)
  if (authorized instanceof Response) return authorized

  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > TIMEWEB_MCP_MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'request_too_large' }, { status: 413, headers: authorized.baseHeaders })
  }

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, {
      status: 400,
      headers: mcpHeaders(authorized),
    })
  }

  const requests = Array.isArray(payload) ? payload : [payload]
  if (requests.length === 0 || requests.length > 64 || requests.some((item) => !isJsonRpcRequest(item))) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, {
      status: 400,
      headers: mcpHeaders(authorized),
    })
  }

  const started = Date.now()
  try {
    const results: JsonRpcResponse[] = []
    for (const rpcRequest of requests as JsonRpcRequest[]) {
      const response = await handleTimewebMcpProtocol(rpcRequest, {
        upstream: (item) => callUpstreamWithSingleRecovery(authorized.session, item),
        serverVersion: process.env.RR_DEPLOY_SHA,
      })
      if (response) results.push(response)
    }
    await timewebMcpSessionManager.touch(authorized.session)

    audit('protocol_response', authorized.requestId, request.method, results.length ? 200 : 202, Date.now() - started, authorized.session)
    if (!results.length) return new Response(null, { status: 202, headers: mcpHeaders(authorized) })
    return NextResponse.json(Array.isArray(payload) ? results : results[0], { headers: mcpHeaders(authorized) })
  } catch (error) {
    return bridgeFailure(authorized, request.method, error, Date.now() - started)
  }
}

export async function DELETE(request: Request) {
  const authorized = await authorize(request)
  if (authorized instanceof Response) return authorized

  try {
    if (authorized.session.upstreamSessionId) {
      await fetchUpstreamTransport('DELETE', authorized.session)
    }
    await timewebMcpSessionManager.clear(authorized.session)
    audit('session_deleted', authorized.requestId, request.method, 204, 0, authorized.session)
    return new Response(null, { status: 204, headers: authorized.baseHeaders })
  } catch (error) {
    return bridgeFailure(authorized, request.method, error)
  }
}

async function authorize(request: Request): Promise<AuthorizedContext | Response> {
  const requestId = safeRequestId(request.headers.get('x-request-id'))
  const baseHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Request-ID': requestId,
  }

  if (!isTimewebMcpConfigured()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: baseHeaders })
  }

  const sourceIp = request.headers.get('x-real-ip')?.trim() || 'unknown'
  const preauth = checkTimewebMcpRateLimit(`ip:${sourceIp}`, Date.now(), TIMEWEB_MCP_PREAUTH_RATE_LIMIT)
  if (!preauth.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, {
      status: 429,
      headers: { ...baseHeaders, 'Retry-After': String(preauth.retryAfterSeconds) },
    })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > TIMEWEB_MCP_MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'request_too_large' }, { status: 413, headers: baseHeaders })
  }

  const auth = await verifyTimewebMcpAccessToken(request.headers.get('authorization'))
  if (!auth.ok) {
    const insufficientScope = auth.reason === 'insufficient_scope'
    return NextResponse.json({ error: insufficientScope ? 'insufficient_scope' : 'unauthorized' }, {
      status: insufficientScope ? 403 : 401,
      headers: {
        ...baseHeaders,
        'WWW-Authenticate': getTimewebMcpAuthenticateChallenge(insufficientScope ? 'insufficient_scope' : 'invalid_token'),
      },
    })
  }

  const subjectLimit = checkTimewebMcpRateLimit(`sub:${auth.subject}`)
  if (!subjectLimit.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, {
      status: 429,
      headers: { ...baseHeaders, 'Retry-After': String(subjectLimit.retryAfterSeconds) },
    })
  }

  const protocolVersion = request.headers.get('mcp-protocol-version')?.trim() || '2025-03-26'
  const requestedSessionId = request.headers.get('mcp-session-id')
  const { session } = await timewebMcpSessionManager.getOrCreate(auth.subject, requestedSessionId, protocolVersion)
  return { requestId, baseHeaders, session }
}

async function proxyTransport(request: Request, context: AuthorizedContext): Promise<Response> {
  const started = Date.now()
  await ensureUpstreamInitialized(context.session)
  const outcome = await withSingleTimewebMcpRecovery(
    () => fetchUpstreamTransport('GET', context.session),
    async () => {
      await timewebMcpSessionManager.markRecovered(context.session)
      await ensureUpstreamInitialized(context.session)
    },
    (response) => isExpiredStatus(response.status),
  )
  const upstream = outcome.result

  const headers = new Headers(mcpHeaders(context))
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  audit('transport_response', context.requestId, request.method, upstream.status, Date.now() - started, context.session)
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
}

async function callUpstreamWithSingleRecovery(session: TimewebMcpSession, request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (request.method === 'initialize') {
    const attempt = await fetchUpstreamRpc(request, null, session.protocolVersion)
    if (attempt.sessionId) await timewebMcpSessionManager.setUpstreamSession(session, attempt.sessionId)
    return attempt.response ?? upstreamError(request, attempt.status)
  }

  await ensureUpstreamInitialized(session)
  const outcome = await withSingleTimewebMcpRecovery(
    () => fetchUpstreamRpc(request, session.upstreamSessionId, session.protocolVersion),
    async () => {
      await timewebMcpSessionManager.markRecovered(session)
      await ensureUpstreamInitialized(session)
    },
    (attempt) => attempt.expired,
  )
  return outcome.result.response ?? upstreamError(request, outcome.result.status)
}

async function ensureUpstreamInitialized(session: TimewebMcpSession) {
  if (session.upstreamSessionId) return
  const initialize: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: `rr-init-${randomUUID()}`,
    method: 'initialize',
    params: {
      protocolVersion: session.protocolVersion,
      capabilities: {},
      clientInfo: { name: 'recruiter-radar-timeweb-bridge', version: process.env.RR_DEPLOY_SHA ?? 'unknown' },
    },
  }
  const attempt = await fetchUpstreamRpc(initialize, null, session.protocolVersion)
  if (!attempt.response || attempt.response.error || !attempt.sessionId) {
    throw new UpstreamBridgeError(attempt.status === 504 ? 504 : 502, `timeweb_mcp_initialize_failed:${attempt.status}`)
  }
  await timewebMcpSessionManager.setUpstreamSession(session, attempt.sessionId)
  await fetchUpstreamRpc(
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    attempt.sessionId,
    session.protocolVersion,
  )
}

async function fetchUpstreamRpc(
  request: JsonRpcRequest,
  upstreamSessionId: string | null,
  protocolVersion: string,
): Promise<UpstreamAttempt> {
  try {
    const headers = upstreamHeaders(upstreamSessionId, protocolVersion)
    headers.set('content-type', 'application/json')
    const upstream = await fetch(TIMEWEB_MCP_UPSTREAM, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEWEB_MCP_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (upstream.status >= 300 && upstream.status < 400) {
      return { response: null, status: 502, sessionId: null, expired: false }
    }
    const text = await upstream.text()
    const response = parseUpstreamRpc(text, upstream.headers.get('content-type'))
    const sessionId = sanitizeUpstreamSessionId(upstream.headers.get('mcp-session-id'))
    return {
      response,
      status: upstream.status,
      sessionId,
      expired: isExpiredStatus(upstream.status) || isExpiredRpc(response),
    }
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError'
    return {
      response: { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32002, message: timeout ? 'Upstream timeout' : 'Upstream unavailable' } },
      status: timeout ? 504 : 502,
      sessionId: null,
      expired: false,
    }
  }
}

async function fetchUpstreamTransport(method: 'GET' | 'DELETE', session: TimewebMcpSession) {
  return fetch(TIMEWEB_MCP_UPSTREAM, {
    method,
    headers: upstreamHeaders(session.upstreamSessionId, session.protocolVersion),
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEWEB_MCP_TIMEOUT_MS),
    cache: 'no-store',
  })
}

function upstreamHeaders(upstreamSessionId: string | null, protocolVersion: string) {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${process.env.RR_TIMEWEB_MCP_TOKEN!.trim()}`,
    'mcp-protocol-version': protocolVersion,
  })
  if (upstreamSessionId) headers.set('mcp-session-id', upstreamSessionId)
  return headers
}

function parseUpstreamRpc(text: string, contentType: string | null): JsonRpcResponse | null {
  if (!text.trim()) return null
  try {
    if (!contentType?.includes('text/event-stream')) return JSON.parse(text) as JsonRpcResponse
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      return JSON.parse(data) as JsonRpcResponse
    }
  } catch {
    return null
  }
  return null
}

function isExpiredStatus(status: number) {
  return status === 404 || status === 410
}

function isExpiredRpc(response: JsonRpcResponse | null) {
  const message = response?.error?.message ?? ''
  return /session/i.test(message) && /(expired|invalid|not found|unknown)/i.test(message)
}

function upstreamError(request: JsonRpcRequest, status: number): JsonRpcResponse {
  return { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32001, message: 'Timeweb MCP upstream error', data: { status } } }
}

function sanitizeUpstreamSessionId(value: string | null) {
  const candidate = value?.trim() ?? ''
  return /^[A-Za-z0-9._~+\/-]{1,256}$/.test(candidate) ? candidate : null
}

function mcpHeaders(context: AuthorizedContext) {
  return {
    ...context.baseHeaders,
    'Mcp-Session-Id': context.session.id,
    'Mcp-Protocol-Version': context.session.protocolVersion,
  }
}

function bridgeFailure(context: AuthorizedContext, method: string, error: unknown, durationMs = 0) {
  const timeout = (error instanceof DOMException && error.name === 'TimeoutError')
    || (error instanceof UpstreamBridgeError && error.status === 504)
  const status = timeout ? 504 : 502
  audit(timeout ? 'upstream_timeout' : 'bridge_error', context.requestId, method, status, durationMs, context.session)
  return NextResponse.json({ error: timeout ? 'upstream_timeout' : 'upstream_unavailable' }, {
    status,
    headers: mcpHeaders(context),
  })
}

function safeRequestId(value: string | null): string {
  const candidate = value?.trim() ?? ''
  return /^[A-Za-z0-9:._-]{1,128}$/.test(candidate) ? candidate : randomUUID()
}

function audit(event: string, requestId: string, method: string, status: number, durationMs: number, session?: TimewebMcpSession) {
  console.info(JSON.stringify({
    ts: new Date().toISOString(),
    component: 'timeweb-mcp-bridge',
    event,
    requestId,
    method,
    status,
    durationMs,
    sessionId: session?.id,
    recoveryCount: session?.recoveryCount,
  }))
}
