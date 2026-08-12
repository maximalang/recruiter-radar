import { NextResponse } from 'next/server'

import {
  OPERATOR_MCP_MAX_BODY_BYTES,
  OPERATOR_MCP_PROTOCOL_VERSION,
  handleOperatorMcpRequest,
  isAllowedOperatorMcpOrigin,
  isOperatorMcpEnabled,
  isSupportedOperatorMcpProtocolVersion,
  validateModernMcpHeaders,
} from '../../../../lib/operator-mcp'
import {
  OPERATOR_MCP_REQUIRED_SCOPE,
  checkOperatorMcpRateLimit,
  getOperatorMcpAuthenticateChallenge,
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
  if (!isOperatorMcpEnabled()) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: JSON_HEADERS },
    )
  }

  if (!isAllowedOperatorMcpOrigin(request.headers.get('origin'))) {
    return NextResponse.json(
      { error: 'forbidden_origin' },
      { status: 403, headers: JSON_HEADERS },
    )
  }

  const rateKey = request.headers.get('x-real-ip')?.trim() || 'unknown'
  const rateLimit = checkOperatorMcpRateLimit(rateKey)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          ...JSON_HEADERS,
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      },
    )
  }

  const auth = await verifyOperatorMcpAccessToken(
    request.headers.get('authorization'),
  )
  if (!auth.ok) {
    const insufficientScope = auth.reason === 'insufficient_scope'
    const challengeError = insufficientScope
      ? 'insufficient_scope'
      : 'invalid_token'
    return NextResponse.json(
      { error: insufficientScope ? 'insufficient_scope' : 'unauthorized' },
      {
        status: insufficientScope ? 403 : 401,
        headers: {
          ...JSON_HEADERS,
          'WWW-Authenticate': getOperatorMcpAuthenticateChallenge(challengeError),
        },
      },
    )
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    return NextResponse.json(
      { error: 'unsupported_media_type' },
      { status: 415, headers: JSON_HEADERS },
    )
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > OPERATOR_MCP_MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'request_too_large' },
      { status: 413, headers: JSON_HEADERS },
    )
  }

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > OPERATOR_MCP_MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'request_too_large' },
      { status: 413, headers: JSON_HEADERS },
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
      { status: 400, headers: JSON_HEADERS },
    )
  }

  const protocolHeader = request.headers.get('mcp-protocol-version')
  if (!isSupportedOperatorMcpProtocolVersion(protocolHeader)) {
    return NextResponse.json(
      { error: 'unsupported_mcp_protocol_version' },
      { status: 400, headers: JSON_HEADERS },
    )
  }

  const modernHeaderError = validateModernMcpHeaders(
    protocolHeader,
    request.headers.get('mcp-method'),
    request.headers.get('mcp-name'),
    body,
  )
  if (modernHeaderError) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: typeof body.id === 'string' || typeof body.id === 'number' ? body.id : null,
        error: { code: -32600, message: modernHeaderError },
      },
      { status: 400, headers: JSON_HEADERS },
    )
  }

  const outcome = await handleOperatorMcpRequest(body, protocolHeader)
  if (outcome.body === null) {
    return new NextResponse(null, {
      status: outcome.status,
      headers: JSON_HEADERS,
    })
  }

  const result = outcome.body.result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const resultRecord = result as Record<string, unknown>
    if (protocolHeader === OPERATOR_MCP_PROTOCOL_VERSION &&
        typeof resultRecord.resultType !== 'string') {
      resultRecord.resultType = 'complete'
    }

    if (body.method === 'tools/list' && Array.isArray(resultRecord.tools)) {
      resultRecord.tools = resultRecord.tools.map((tool) => {
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return tool
        return {
          ...(tool as Record<string, unknown>),
          securitySchemes: [
            { type: 'oauth2', scopes: [OPERATOR_MCP_REQUIRED_SCOPE] },
          ],
        }
      })
    }
  }

  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: {
      ...JSON_HEADERS,
      ...(protocolHeader === OPERATOR_MCP_PROTOCOL_VERSION
        ? { 'MCP-Protocol-Version': OPERATOR_MCP_PROTOCOL_VERSION }
        : {}),
    },
  })
}
