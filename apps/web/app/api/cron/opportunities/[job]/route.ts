import { NextRequest, NextResponse } from 'next/server'

import {
  COMPANY_EVENTS_V1_LIMITS,
  COMPANY_STATE_V1_LIMITS,
  OPPORTUNITY_ENGINE_LIMITS,
  isCompanyEventsV1Enabled,
  isCompanyStateV1Enabled,
  isOpportunityEngineV1Enabled,
} from '@/lib/opportunities/config'
import {
  normalizeCompanyEventsJob,
  type CompanyEventJobOptions,
} from '@/lib/opportunities/company-event-job'
import {
  buildCompanyStateJob,
  type CompanyStateJobOptions,
} from '@/lib/opportunities/company-state-job'
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
  'normalize-company-events',
  'build-company-state',
])

const COMPANY_EVENTS_JOB = 'normalize-company-events'
const COMPANY_STATE_JOB = 'build-company-state'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ job: string }> },
) {
  const { job } = await context.params
  if (!JOBS.has(job) || !isJobEnabled(job)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const authError = authorizeCron(request)
  if (authError) return authError

  return NextResponse.json({
    ok: true,
    job,
    enabled: true,
    hint: 'Use POST with x-api-key. Backfill, Company Events, and Company State are dry-run unless apply=true.',
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ job: string }> },
) {
  const { job } = await context.params
  if (!JOBS.has(job) || !isJobEnabled(job)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const authError = authorizeCron(request)
  if (authError) return authError

  const params = request.nextUrl.searchParams
  const organizationValue = params.get('organization')
  const batchSizeValue = params.get('batchSize')
  const dryRunValue = params.get('dryRun')
  const applyValue = params.get('apply')
  const organizationId = positiveId(organizationValue)
  const batchSize = positiveInteger(batchSizeValue)
  const maximumBatchSize = job === COMPANY_EVENTS_JOB
    ? COMPANY_EVENTS_V1_LIMITS.maximumJobBatchSize
    : job === COMPANY_STATE_JOB
      ? COMPANY_STATE_V1_LIMITS.maximumJobBatchSize
      : OPPORTUNITY_ENGINE_LIMITS.maximumJobBatchSize
  if (
    (organizationValue !== null && organizationId === null) ||
    (batchSizeValue !== null && (
      batchSize === null ||
      batchSize > maximumBatchSize
    )) ||
    (dryRunValue !== null && dryRunValue !== 'true' && dryRunValue !== 'false') ||
    (applyValue !== null && applyValue !== 'true' && applyValue !== 'false')
  ) {
    return NextResponse.json({ error: 'invalid_parameters' }, { status: 400 })
  }
  if (
    (job === COMPANY_EVENTS_JOB || job === COMPANY_STATE_JOB) &&
    applyValue === 'true' &&
    organizationId === null
  ) {
    return NextResponse.json(
      { error: 'organization_required_for_apply' },
      { status: 400 },
    )
  }
  const commonOptions = {
    enabled: true,
    organizationId,
    batchSize: batchSize ?? undefined,
  }
  const opportunityOptions: OpportunityJobOptions = {
    ...commonOptions,
    dryRun: job === 'backfill-opportunities'
      ? applyValue !== 'true'
      : dryRunValue === 'true',
  }
  const companyEventOptions: CompanyEventJobOptions = {
    ...commonOptions,
    dryRun: applyValue !== 'true',
  }
  const companyStateOptions: CompanyStateJobOptions = {
    ...commonOptions,
    dryRun: applyValue !== 'true',
  }

  try {
    const result = job === COMPANY_EVENTS_JOB
      ? await normalizeCompanyEventsJob(companyEventOptions)
      : job === COMPANY_STATE_JOB
        ? await buildCompanyStateJob(companyStateOptions)
      : job === 'detect-hiring-episodes'
      ? await detectHiringEpisodesJob(opportunityOptions)
      : job === 'build-opportunities'
        ? await buildOpportunitiesJob(opportunityOptions)
        : job === 'expire-opportunities'
          ? await expireOpportunitiesJob(opportunityOptions)
          : await backfillOpportunitiesJob(opportunityOptions)
    return NextResponse.json({ success: true, job, result })
  } catch (error) {
    logError('opportunity.cron.failed', error, { job })
    return NextResponse.json(
      { success: false, error: 'Opportunity job failed.' },
      { status: 500 },
    )
  }
}

function isJobEnabled(job: string): boolean {
  return job === COMPANY_EVENTS_JOB
    ? isCompanyEventsV1Enabled()
    : job === COMPANY_STATE_JOB
      ? isCompanyStateV1Enabled()
    : isOpportunityEngineV1Enabled()
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
