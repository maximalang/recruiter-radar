import { NextRequest, NextResponse } from 'next/server'

import {
  OPPORTUNITY_ENGINE_LIMITS,
  isOpportunityEngineV1Enabled,
} from '@/lib/opportunities/config'
import {
  backfillOpportunitiesJob,
  buildOpportunitiesJob,
  detectHiringEpisodesJob,
  expireOpportunitiesJob,
  type OpportunityJobOptions,
} from '@/lib/opportunities/jobs'
import { logError } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const JOBS = new Set([
  'detect-hiring-episodes',
  'build-opportunities',
  'expire-opportunities',
  'backfill-opportunities',
])

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ job: string }> },
) {
  if (!isOpportunityEngineV1Enabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const authError = authorizeCron(request)
  if (authError) return authError

  const { job } = await context.params
  if (!JOBS.has(job)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({
    ok: true,
    job,
    enabled: isOpportunityEngineV1Enabled(),
    hint: 'Use POST with x-api-key. Backfill is dry-run unless apply=true.',
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ job: string }> },
) {
  if (!isOpportunityEngineV1Enabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const authError = authorizeCron(request)
  if (authError) return authError

  const { job } = await context.params
  if (!JOBS.has(job)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const params = request.nextUrl.searchParams
  const organizationValue = params.get('organization')
  const batchSizeValue = params.get('batchSize')
  const dryRunValue = params.get('dryRun')
  const applyValue = params.get('apply')
  const organizationId = positiveId(organizationValue)
  const batchSize = positiveInteger(batchSizeValue)
  if (
    (organizationValue !== null && organizationId === null) ||
    (batchSizeValue !== null && (
      batchSize === null ||
      batchSize > OPPORTUNITY_ENGINE_LIMITS.maximumJobBatchSize
    )) ||
    (dryRunValue !== null && dryRunValue !== 'true' && dryRunValue !== 'false') ||
    (applyValue !== null && applyValue !== 'true' && applyValue !== 'false')
  ) {
    return NextResponse.json({ error: 'invalid_parameters' }, { status: 400 })
  }
  const options: OpportunityJobOptions = {
    enabled: true,
    organizationId,
    batchSize: batchSize ?? undefined,
    dryRun: job === 'backfill-opportunities'
      ? applyValue !== 'true'
      : dryRunValue === 'true',
  }

  try {
    const result = job === 'detect-hiring-episodes'
      ? await detectHiringEpisodesJob(options)
      : job === 'build-opportunities'
        ? await buildOpportunitiesJob(options)
        : job === 'expire-opportunities'
          ? await expireOpportunitiesJob(options)
          : await backfillOpportunitiesJob(options)
    return NextResponse.json({ success: true, job, result })
  } catch (error) {
    logError('opportunity.cron.failed', error, { job })
    return NextResponse.json(
      { success: false, error: 'Opportunity job failed.' },
      { status: 500 },
    )
  }
}

function authorizeCron(request: NextRequest): NextResponse | null {
  const expectedKey = process.env.CRON_API_KEY?.trim()
  if (!expectedKey) {
    return NextResponse.json(
      { success: false, error: 'CRON_API_KEY is not configured.' },
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

function positiveId(value: string | null): string | null {
  return value && /^[1-9]\d*$/.test(value) ? value : null
}

function positiveInteger(value: string | null): number | null {
  if (!value) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
