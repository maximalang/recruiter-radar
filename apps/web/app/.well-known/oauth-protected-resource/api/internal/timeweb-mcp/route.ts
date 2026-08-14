import { NextResponse } from 'next/server'

import { getTimewebMcpProtectedResourceMetadata } from '../../../../../lib/timeweb-mcp-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(getTimewebMcpProtectedResourceMetadata(), {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
