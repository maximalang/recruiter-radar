import { NextRequest, NextResponse } from 'next/server'

import { isOpportunityEngineV1Enabled } from '@/lib/opportunities/config'
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
  _request: NextRequest,
  context: { params: Promise<{ job: string }> },
) {
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
  if (!isOpportunityEngineV1Enabled()) {
    return NextResponse.json(
      { success: false, error: 'Opportunity Engine v1 is disabled.' },
      { status: 409 },
    )
  }

  const { job } = await context.params
  if (!JOBS.has(job)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const params = request.nextUrl.searchParams
  const options: OpportunityJobOptions = {
    enabled: true,
    organizationId: positiveId(params.get('organization')),
    batchSize: positiveInteger(params.get('batchSize')) ?? undefined,
    dryRun: job === 'backfill-opportunities'
      ? params.get('apply') !== 'true'
      : params.get('dryRun') === 'true',
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

function positiveId(value: string | null): string | null {
  return value && /^[1-9]\d*$/.test(value) ? value : null
}

function positiveInteger(value: string | null): number | null {
  if (!value) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
