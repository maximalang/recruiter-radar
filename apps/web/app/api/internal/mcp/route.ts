import { NextResponse } from 'next/server'

import {
  OPERATOR_MCP_MAX_BODY_BYTES,
  OPERATOR_MCP_PROTOCOL_VERSION,
  handleOperatorMcpRequest,
  isAllowedOperatorMcpOrigin,
  isAuthorizedOperatorMcpRequest,
  isOperatorMcpEnabled,
  isSupportedOperatorMcpProtocolVersion,
  validateModernMcpHeaders,
} from '../../../../lib/operator-mcp'

export const dynamic = 'force-dynamic'

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

  if (!isAuthorizedOperatorMcpRequest(
    request.headers.get('authorization'),
    process.env.RR_MCP_TOKEN,
  )) {
    return NextResponse.json(
      { error: 'unauthorized' },
      {
        status: 401,
        headers: {
          ...JSON_HEADERS,
          'WWW-Authenticate': 'Bearer realm="recruiter-radar-operator"',
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
