import { NextRequest, NextResponse } from 'next/server'

import {
  materializeQueryPlannerV2YieldJob,
} from '@/lib/lead-discovery/query-planner-v2-yield-job'
import { logError } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PUBLIC_CONFIGURATION_ERROR = 'Query Plan yield service is not configured.'

export async function GET(request: NextRequest) {
  const authError = authorizeCron(request)
  if (authError) return authError
  return NextResponse.json({
    ok: true,
    job: 'query-plan-yield-v2',
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
  if (params.has('workspace')) {
    return NextResponse.json(
      { error: 'canary_scope_is_environment_managed' },
      { status: 400 },
    )
  }
  const windowDays = positiveInteger(params.get('windowDays'))
  const limit = positiveInteger(params.get('limit'))
  if (
    (params.has('windowDays') && (windowDays === null || windowDays > 180)) ||
    (params.has('limit') && (limit === null || limit > 1000))
  ) {
    return NextResponse.json({ error: 'invalid_parameters' }, { status: 400 })
  }

  try {
    const result = await materializeQueryPlannerV2YieldJob({
      windowDays: windowDays ?? 30,
      limit: limit ?? 200,
    })
    return NextResponse.json({ success: true, job: 'query-plan-yield-v2', result })
  } catch (error) {
    logError('query_planner_v2.yield_cron_failed', error)
    return NextResponse.json(
      { success: false, error: 'Query Plan yield materialization failed.' },
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
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
