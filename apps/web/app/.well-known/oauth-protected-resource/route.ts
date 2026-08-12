import { NextResponse } from 'next/server'

import { isOperatorMcpEnabled } from '../../../lib/operator-mcp'
import { getOperatorMcpProtectedResourceMetadata } from '../../../lib/operator-mcp-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  if (!isOperatorMcpEnabled()) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const metadata = getOperatorMcpProtectedResourceMetadata()
  if (!metadata) {
    return NextResponse.json(
      { error: 'oauth_not_configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
