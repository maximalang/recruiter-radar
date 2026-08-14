import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  TIMEWEB_MCP_PREAUTH_RATE_LIMIT,
  checkTimewebMcpRateLimit,
  getTimewebMcpAuthenticateChallenge,
  isTimewebMcpConfigured,
  verifyTimewebMcpAccessToken,
} from '../../../../lib/timeweb-mcp-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const TIMEWEB_MCP_UPSTREAM = 'https://timeweb.cloud/api/v1/mcp'
export const TIMEWEB_MCP_MAX_BODY_BYTES = 1024 * 1024
export const TIMEWEB_MCP_TIMEOUT_MS = 30_000

const REQUEST_HEADERS = [
  'accept',
  'content-type',
  'mcp-protocol-version',
  'mcp-session-id',
  'last-event-id',
] as const

const RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'mcp-protocol-version',
  'mcp-session-id',
  'retry-after',
] as const

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
  return proxyTimewebMcp(request)
}

export async function POST(request: Request) {
  return proxyTimewebMcp(request)
}

export async function DELETE(request: Request) {
  return proxyTimewebMcp(request)
}

async function proxyTimewebMcp(request: Request): Promise<Response> {
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

  const auth = await verifyTimewebMcpAccessToken(request.headers.get('authorization'))
  if (!auth.ok) {
    const insufficientScope = auth.reason === 'insufficient_scope'
    return NextResponse.json({ error: insufficientScope ? 'insufficient_scope' : 'unauthorized' }, {
      status: insufficientScope ? 403 : 401,
      headers: {
        ...baseHeaders,
        'WWW-Authenticate': getTimewebMcpAuthenticateChallenge(
          insufficientScope ? 'insufficient_scope' : 'invalid_token',
        ),
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

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > TIMEWEB_MCP_MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'request_too_large' }, { status: 413, headers: baseHeaders })
  }

  let body: ArrayBuffer | undefined
  if (request.method === 'POST') {
    body = await request.arrayBuffer()
    if (body.byteLength > TIMEWEB_MCP_MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'request_too_large' }, { status: 413, headers: baseHeaders })
    }
  }

  const upstreamHeaders = new Headers()
  for (const header of REQUEST_HEADERS) {
    const value = request.headers.get(header)
    if (value) upstreamHeaders.set(header, value)
  }
  upstreamHeaders.set('authorization', `Bearer ${process.env.RR_TIMEWEB_MCP_TOKEN!.trim()}`)

  const started = Date.now()
  try {
    const upstream = await fetch(TIMEWEB_MCP_UPSTREAM, {
      method: request.method,
      headers: upstreamHeaders,
      body: request.method === 'POST' ? body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEWEB_MCP_TIMEOUT_MS),
      cache: 'no-store',
    })

    if (upstream.status >= 300 && upstream.status < 400) {
      audit('upstream_redirect_refused', requestId, request.method, 502, Date.now() - started)
      return NextResponse.json({ error: 'upstream_redirect_refused' }, { status: 502, headers: baseHeaders })
    }

    const responseHeaders = new Headers(baseHeaders)
    for (const header of RESPONSE_HEADERS) {
      const value = upstream.headers.get(header)
      if (value) responseHeaders.set(header, value)
    }

    audit('upstream_response', requestId, request.method, upstream.status, Date.now() - started)
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError'
    audit(timeout ? 'upstream_timeout' : 'upstream_error', requestId, request.method, timeout ? 504 : 502, Date.now() - started)
    return NextResponse.json({ error: timeout ? 'upstream_timeout' : 'upstream_unavailable' }, {
      status: timeout ? 504 : 502,
      headers: baseHeaders,
    })
  }
}

function safeRequestId(value: string | null): string {
  const candidate = value?.trim() ?? ''
  return /^[A-Za-z0-9:._-]{1,128}$/.test(candidate) ? candidate : randomUUID()
}

function audit(event: string, requestId: string, method: string, status: number, durationMs: number) {
  console.info(JSON.stringify({
    ts: new Date().toISOString(),
    component: 'timeweb-mcp-bridge',
    event,
    requestId,
    method,
    status,
    durationMs,
  }))
}
