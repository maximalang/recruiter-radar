import { timingSafeEqual } from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'

import { getOperationalReadinessReport } from '@/lib/operational-readiness'
import { getSourceFreshnessReport } from '@/lib/source-freshness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function secretsMatch(received: string | null, expected: string): boolean {
  if (!received) return false
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.CRON_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'Operational readiness is unavailable: CRON_API_KEY is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (!secretsMatch(request.headers.get('x-api-key'), apiKey)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or missing x-api-key header.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const rawWindow = request.nextUrl.searchParams.get('windowHours')
  const parsedWindow = rawWindow === null ? null : Number(rawWindow)

  try {
    const [report, sourceFreshness] = await Promise.all([
      getOperationalReadinessReport(parsedWindow),
      getSourceFreshnessReport(),
    ])
    const status = report.profiles.missed === 0 ? 'ready' : 'degraded'
    return NextResponse.json(
      { ok: true, status, report: { ...report, sourceFreshness } },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json(
      { ok: false, status: 'unavailable', error: 'Operational readiness report could not be generated.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
