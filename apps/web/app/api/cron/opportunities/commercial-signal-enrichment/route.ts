import { NextRequest, NextResponse } from 'next/server'

import {
  runCommercialSignalEnrichmentJob,
} from '@/lib/opportunities/commercial-signal-enrichment-job'
import { logError } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PUBLIC_CONFIGURATION_ERROR = 'Commercial Signal enrichment service is not configured.'

export async function GET(request: NextRequest) {
  const authError = authorizeCron(request)
  if (authError) return authError
  return NextResponse.json({
    ok: true,
    job: 'commercial-signal-enrichment',
    hint: 'POST with x-api-key and apply=true. Canary scope is environment-managed.',
  })
}

export async function POST(request: NextRequest) {
  const authError = authorizeCron(request)
  if (authError) return authError

  const params = request.nextUrl.searchParams
  if (params.get('apply') !== 'true') {
    return NextResponse.json({ error: 'apply_true_required' }, { status: 400 })
  }
  if (
    params.has('workspace') ||
    params.has('profile') ||
    params.has('organization')
  ) {
    return NextResponse.json(
      { error: 'canary_scope_is_environment_managed' },
      { status: 400 },
    )
  }
  const limit = positiveInteger(params.get('limit'))
  if (params.has('limit') && (limit === null || limit > 30)) {
    return NextResponse.json({ error: 'invalid_limit' }, { status: 400 })
  }

  try {
    const result = await runCommercialSignalEnrichmentJob({
      limit: limit ?? 10,
    })
    return NextResponse.json({
      success: true,
      job: 'commercial-signal-enrichment',
      result,
    })
  } catch (error) {
    logError('commercial_signal.enrichment_cron_failed', error)
    return NextResponse.json(
      { success: false, error: 'Commercial Signal enrichment failed.' },
      { status: 500 },
    )
  }
}

function authorizeCron(request: NextRequest): NextResponse | null {
  const expectedKey = process.env.CRON_API_KEY?.trim()
  if (!expectedKey) {
    return NextResponse.json(
      { success: false, error: PUBLIC_CONFIGURATION_ERROR },
      { status: 503 },
    )
  }
  if (request.headers.get('x-api-key') !== expectedKey) {
    return NextResponse.json(
      { success: false, error: 'Invalid or missing x-api-key header.' },
      { status: 401 },
    )
  }
  return null
}

function positiveInteger(value: string | null): number | null {
  if (!value) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
