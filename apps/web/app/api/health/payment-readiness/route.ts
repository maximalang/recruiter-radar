import { timingSafeEqual } from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'

import { buildPaymentReadinessReport } from '@/lib/payment-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_API_KEY?.trim()
  const received = request.headers.get('x-api-key')
  if (!expected || !received) return false
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_API_KEY?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'Payment readiness is unavailable: CRON_API_KEY is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or missing x-api-key header.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const report = buildPaymentReadinessReport()
  const status = report.liveLaunchReady
    ? 'live-ready'
    : report.selfServePilotReady
      ? 'integration-ready'
      : 'sales-assisted'

  return NextResponse.json(
    { ok: true, status, report },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
