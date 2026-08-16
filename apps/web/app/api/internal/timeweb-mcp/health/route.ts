import { NextResponse } from 'next/server'

import {
  isTimewebMcpConfigured,
  TIMEWEB_MCP_RESOURCE,
} from '../../../../../lib/timeweb-mcp-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const startedAt = Date.now()
  const configured = isTimewebMcpConfigured()

  let upstream = {
    reachable: false,
    latencyMs: null as number | null,
  }

  if (configured) {
    const upstreamStarted = Date.now()
    try {
      const response = await fetch('https://timeweb.cloud/api/v1/mcp', {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      })

      upstream = {
        reachable: response.status < 500 && response.status !== 0,
        latencyMs: Date.now() - upstreamStarted,
      }
    } catch {
      upstream = {
        reachable: false,
        latencyMs: Date.now() - upstreamStarted,
      }
    }
  }

  return NextResponse.json({
    ok: configured && upstream.reachable,
    resource: TIMEWEB_MCP_RESOURCE,
    configured,
    upstream,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  }, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
