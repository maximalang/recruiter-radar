import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  OPERATOR_MCP_MAX_BODY_BYTES,
  OPERATOR_MCP_PROTOCOL_VERSION,
  getOperatorMcpToolRequiredScopes,
  handleOperatorMcpRequest,
  isAllowedOperatorMcpOrigin,
  isOperatorMcpEnabled,
  isSupportedOperatorMcpProtocolVersion,
  validateModernMcpHeaders,
  validateOperatorMcpProtocolUse,
} from '../../../../lib/operator-mcp'
import { writeOperatorMcpAuditEvent } from '../../../../lib/operator-mcp-audit'
import {
  OPERATOR_MCP_PREAUTH_RATE_LIMIT,
  OPERATOR_MCP_READ_SCOPES,
  checkOperatorMcpRateLimit,
  getOperatorMcpAuthenticateChallenge,
  hasOperatorMcpScopes,
  verifyOperatorMcpAccessToken,
} from '../../../../lib/operator-mcp-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

export async function GET() {
  return new NextResponse(null, {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'POST, OPTIONS' },
  })
}

export async function DELETE() {
  return new NextResponse(null, {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'POST, OPTIONS' },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      Allow: 'POST, OPTIONS',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function POST(request: Request) {
  const requestId = requestIdFromHeader(request.headers.get('x-request-id'))
  const responseHeaders = { ...JSON_HEADERS, 'X-Request-ID': requestId }

  if (!isOperatorMcpEnabled()) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: responseHeaders },
    )
  }

  if (!isAllowedOperatorMcpOrigin(request.headers.get('origin'))) {
    return NextResponse.json(
      { error: 'forbidden_origin' },
      { status: 403, headers: responseHeaders },
    )
  }

  // Caddy overwrites X-Real-IP at the sole public ingress. This limiter is a
  // coarse unauthenticated abuse boundary; a second subject limiter is applied
  // after OAuth verification so one IP cannot spoof another operator identity.
  const sourceIp = request.headers.get('x-real-ip')?.trim() || 'unknown'
  const preauthRateLimit = checkOperatorMcpRateLimit(
    `ip:${sourceIp}`,
    Date.now(),
    OPERATOR_MCP_PREAUTH_RATE_LIMIT,
  )
  if (!preauthRateLimit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          ...responseHeaders,
          'Retry-After': String(preauthRateLimit.retryAfterSeconds),
        },
      },
    )
  }

  const auth = await verifyOperatorMcpAccessToken(
    request.headers.get('authorization'),
  )
  if (!auth.ok) {
    const insufficientScope = auth.reason === 'insufficient_scope'
    return NextResponse.json(
      { error: insufficientScope ? 'insufficient_scope' : 'unauthorized' },
      {
        status: insufficientScope ? 403 : 401,
        headers: {
          ...responseHeaders,
          'WWW-Authenticate': getOperatorMcpAuthenticateChallenge(
            insufficientScope ? 'insufficient_scope' : 'invalid_token',
            OPERATOR_MCP_READ_SCOPES,
          ),
        },
      },
    )
  }

  const subjectRateLimit = checkOperatorMcpRateLimit(`sub:${auth.subject}`)
  if (!subjectRateLimit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          ...responseHeaders,
          'Retry-After': String(subjectRateLimit.retryAfterSeconds),
        },
      },
    )
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    return NextResponse.json(
      { error: 'unsupported_media_type' },
      { status: 415, headers: responseHeaders },
    )
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > OPERATOR_MCP_MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'request_too_large' },
      { status: 413, headers: responseHeaders },
    )
  }

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > OPERATOR_MCP_MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'request_too_large' },
      { status: 413, headers: responseHeaders },
    )
  }

  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(rawBody) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400, headers: responseHeaders },
    )
  }

  const protocolHeader = request.headers.get('mcp-protocol-version')
  if (!isSupportedOperatorMcpProtocolVersion(protocolHeader)) {
    return NextResponse.json(
      { error: 'unsupported_mcp_protocol_version' },
      { status: 400, headers: responseHeaders },
    )
  }

  const protocolUseError = validateOperatorMcpProtocolUse(protocolHeader, body)
  if (protocolUseError) {
    return rpcRequestError(body, protocolUseError, responseHeaders)
  }

  const modernHeaderError = validateModernMcpHeaders(
    protocolHeader,
    request.headers.get('mcp-method'),
    request.headers.get('mcp-name'),
    body,
  )
  if (modernHeaderError) {
    return rpcRequestError(body, modernHeaderError, responseHeaders)
  }

  const toolContext = requestedToolContext(body)
  if (toolContext) {
    const requiredScopes = getOperatorMcpToolRequiredScopes(toolContext.name)
    if (requiredScopes && !hasOperatorMcpScopes(auth.scopes, requiredScopes)) {
      writeOperatorMcpAuditEvent({
        requestId,
        subject: auth.subject,
        tool: toolContext.name,
        args: toolContext.args,
        status: 'denied',
        durationMs: 0,
        deploySha: safeSha(process.env.RR_DEPLOY_SHA),
        mutationTarget:
          typeof toolContext.args.service === 'string'
            ? toolContext.args.service
            : toolContext.name === 'reload_proxy'
              ? 'caddy'
              : null,
        error: 'insufficient_scope',
      })
      return NextResponse.json(
        { error: 'insufficient_scope' },
        {
          status: 403,
          headers: {
            ...responseHeaders,
            'WWW-Authenticate': getOperatorMcpAuthenticateChallenge(
              'insufficient_scope',
              requiredScopes,
            ),
          },
        },
      )
    }
  }

  const outcome = await handleOperatorMcpRequest(body, protocolHeader, {
    requestId,
    subject: auth.subject,
  })
  if (outcome.body === null) {
    return new NextResponse(null, {
      status: outcome.status,
      headers: responseHeaders,
    })
  }

  const result = outcome.body.result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const resultRecord = result as Record<string, unknown>
    if (
      protocolHeader === OPERATOR_MCP_PROTOCOL_VERSION &&
      typeof resultRecord.resultType !== 'string'
    ) {
      resultRecord.resultType = 'complete'
    }
  }

  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: {
      ...responseHeaders,
      ...(protocolHeader === OPERATOR_MCP_PROTOCOL_VERSION
        ? { 'MCP-Protocol-Version': OPERATOR_MCP_PROTOCOL_VERSION }
        : {}),
    },
  })
}

function requestedToolContext(body: Record<string, unknown>) {
  if (body.method !== 'tools/call') return null
  const params = asObject(body.params)
  const name = typeof params.name === 'string' ? params.name : ''
  if (!name) return null
  return { name, args: asObject(params.arguments) }
}

function rpcRequestError(
  body: Record<string, unknown>,
  message: string,
  headers: Record<string, string>,
) {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id: typeof body.id === 'string' || typeof body.id === 'number' ? body.id : null,
      error: { code: -32600, message },
    },
    { status: 400, headers },
  )
}

function requestIdFromHeader(value: string | null): string {
  const candidate = value?.trim() ?? ''
  return /^[A-Za-z0-9:._-]{1,128}$/.test(candidate) ? candidate : randomUUID()
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeSha(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return /^[a-f0-9]{40}$/.test(normalized) ? normalized : null
}
