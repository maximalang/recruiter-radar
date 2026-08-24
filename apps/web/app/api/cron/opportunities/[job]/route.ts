import { NextRequest, NextResponse } from 'next/server'

import {
  COMPANY_EVENTS_V1_LIMITS,
  COMPANY_STATE_V1_LIMITS,
  SIGNAL_EPISODES_V2_LIMITS,
  COMMERCIAL_THESIS_V1_LIMITS,
  EXTERNAL_AGENCY_PROPENSITY_V1_LIMITS,
  AGENCY_DNA_MATCH_V2_LIMITS,
  OPPORTUNITY_SCORING_V3_LIMITS,
  OPPORTUNITY_ENGINE_LIMITS,
  isCompanyEventsV1Enabled,
  isCompanyStateV1Enabled,
  isSignalEpisodesV2Enabled,
  isCommercialThesisV1Enabled,
  isExternalAgencyPropensityV1Enabled,
  isAgencyDnaMatchV2Enabled,
  isOpportunityScoringV3Enabled,
  isCommercialSignalQualityV2Enabled,
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
  buildSignalEpisodesJob,
  type SignalEpisodesJobOptions,
} from '@/lib/opportunities/signal-episode-job'
import {
  buildCommercialThesesJob,
  type CommercialThesisJobOptions,
} from '@/lib/opportunities/commercial-thesis-job'
import {
  buildExternalAgencyPropensityJob,
  type ExternalAgencyPropensityJobOptions,
} from '@/lib/opportunities/external-agency-propensity-job'
import {
  buildAgencyDnaMatchJob,
  type AgencyDnaMatchJobOptions,
} from '@/lib/opportunities/agency-dna-match-job'
import {
  buildOpportunityScoringV3Job,
  type OpportunityScoringV3JobOptions,
} from '@/lib/opportunities/opportunity-scoring-v3-job'
import {
  COMMERCIAL_SIGNAL_QUALITY_V2_SHADOW_LIMITS,
  runCommercialSignalQualityV2ShadowPipeline,
  type CommercialSignalQualityV2ShadowOptions,
} from '@/lib/opportunities/commercial-signal-quality-v2-job'
import {
  QUERY_PLANNER_V2_LIMITS,
  isQueryPlannerV2Enabled,
} from '@/lib/lead-discovery/query-planner-v2-config'
import {
  buildQueryPlansV2Job,
  type QueryPlannerV2JobOptions,
} from '@/lib/lead-discovery/query-planner-v2-job'
import {
  executeQueryPlannerV2Sources,
} from '@/lib/lead-discovery/query-planner-v2-executor'
import {
  commercialSignalCandidateRolloutMode,
} from '@/lib/opportunities/commercial-signal-rollout'
import {
  writeCommercialSignalOpportunities,
} from '@/lib/opportunities/commercial-signal-opportunity-writer'
import {
  runCommercialSignalCanary,
} from '@/lib/opportunities/commercial-signal-canary-job'
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
  'build-signal-episodes',
  'build-commercial-theses',
  'build-external-agency-propensity',
  'build-agency-dna-matches',
  'build-opportunity-candidates-v3',
  'build-commercial-signal-quality-v2',
  'build-query-plans-v2',
  'execute-query-plans-v2',
  'write-commercial-signal-opportunities',
  'run-commercial-signal-canary',
])

const COMPANY_EVENTS_JOB = 'normalize-company-events'
const COMPANY_STATE_JOB = 'build-company-state'
const SIGNAL_EPISODES_JOB = 'build-signal-episodes'
const COMMERCIAL_THESIS_JOB = 'build-commercial-theses'
const EXTERNAL_AGENCY_PROPENSITY_JOB = 'build-external-agency-propensity'
const AGENCY_DNA_MATCH_JOB = 'build-agency-dna-matches'
const OPPORTUNITY_SCORING_V3_JOB = 'build-opportunity-candidates-v3'
const COMMERCIAL_SIGNAL_QUALITY_V2_JOB = 'build-commercial-signal-quality-v2'
const QUERY_PLANNER_V2_JOB = 'build-query-plans-v2'
const QUERY_PLANNER_V2_EXECUTION_JOB = 'execute-query-plans-v2'
const COMMERCIAL_SIGNAL_WRITER_JOB = 'write-commercial-signal-opportunities'
const COMMERCIAL_SIGNAL_CANARY_JOB = 'run-commercial-signal-canary'

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
    hint: 'Use POST with x-api-key. Backfill and additive intelligence jobs are dry-run unless apply=true.',
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
  const workspaceValue = params.get('workspace')
  const profileValue = params.get('profile')
  const batchSizeValue = params.get('batchSize')
  const afterValue = params.get('after')
  const dryRunValue = params.get('dryRun')
  const applyValue = params.get('apply')
  const organizationId = positiveId(organizationValue)
  const workspaceId = positiveId(workspaceValue)
  const clientProfileId = positiveId(profileValue)
  const batchSize = positiveInteger(batchSizeValue)
  const afterLineageId = positiveId(afterValue)
  const maximumBatchSize = job === COMPANY_EVENTS_JOB
    ? COMPANY_EVENTS_V1_LIMITS.maximumJobBatchSize
    : job === COMPANY_STATE_JOB
      ? COMPANY_STATE_V1_LIMITS.maximumJobBatchSize
      : job === SIGNAL_EPISODES_JOB
        ? SIGNAL_EPISODES_V2_LIMITS.maximumJobBatchSize
        : job === COMMERCIAL_THESIS_JOB
          ? COMMERCIAL_THESIS_V1_LIMITS.maximumJobBatchSize
          : job === EXTERNAL_AGENCY_PROPENSITY_JOB
            ? EXTERNAL_AGENCY_PROPENSITY_V1_LIMITS.maximumJobBatchSize
            : job === AGENCY_DNA_MATCH_JOB
              ? AGENCY_DNA_MATCH_V2_LIMITS.maximumJobBatchSize
              : job === OPPORTUNITY_SCORING_V3_JOB
                ? OPPORTUNITY_SCORING_V3_LIMITS.maximumJobBatchSize
                : job === COMMERCIAL_SIGNAL_QUALITY_V2_JOB
                  ? COMMERCIAL_SIGNAL_QUALITY_V2_SHADOW_LIMITS.maximumBatchSize
                : job === QUERY_PLANNER_V2_JOB
                  ? QUERY_PLANNER_V2_LIMITS.maximumProfileBatchSize
                  : job === QUERY_PLANNER_V2_EXECUTION_JOB ||
                      job === COMMERCIAL_SIGNAL_WRITER_JOB ||
                      job === COMMERCIAL_SIGNAL_CANARY_JOB
                    ? 100
                    : OPPORTUNITY_ENGINE_LIMITS.maximumJobBatchSize
  if (
    (organizationValue !== null && organizationId === null) ||
    (workspaceValue !== null && workspaceId === null) ||
    (profileValue !== null && clientProfileId === null) ||
    (afterValue !== null && afterLineageId === null) ||
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
    job === QUERY_PLANNER_V2_JOB &&
    applyValue === 'true' &&
    (workspaceId === null || clientProfileId === null)
  ) {
    return NextResponse.json(
      { error: 'workspace_and_profile_required_for_apply' },
      { status: 400 },
    )
  }
  if (
    job === COMMERCIAL_SIGNAL_CANARY_JOB &&
    (
      applyValue !== 'true' ||
      workspaceValue !== null ||
      profileValue !== null ||
      organizationValue !== null
    )
  ) {
    return NextResponse.json(
      {
        error: applyValue !== 'true'
          ? 'apply_true_required'
          : 'canary_scope_is_environment_managed',
      },
      { status: 400 },
    )
  }
  if (
    (job === QUERY_PLANNER_V2_EXECUTION_JOB ||
      job === COMMERCIAL_SIGNAL_WRITER_JOB) &&
    (workspaceId === null || applyValue !== 'true')
  ) {
    return NextResponse.json(
      {
        error: workspaceId === null
          ? 'workspace_required_for_apply'
          : 'apply_true_required',
      },
      { status: 400 },
    )
  }
  if (
    job === COMMERCIAL_SIGNAL_QUALITY_V2_JOB &&
    (
      workspaceId === null ||
      clientProfileId === null ||
      (applyValue === 'true' && organizationId === null)
    )
  ) {
    return NextResponse.json(
      {
        error: applyValue === 'true'
          ? 'workspace_profile_and_organization_required_for_apply'
          : 'workspace_and_profile_required_for_shadow',
      },
      { status: 400 },
    )
  }
  if (
    (
      job === COMPANY_EVENTS_JOB ||
      job === COMPANY_STATE_JOB ||
      job === SIGNAL_EPISODES_JOB ||
      job === COMMERCIAL_THESIS_JOB ||
      job === EXTERNAL_AGENCY_PROPENSITY_JOB ||
      job === AGENCY_DNA_MATCH_JOB ||
      job === OPPORTUNITY_SCORING_V3_JOB
    ) &&
    applyValue === 'true' &&
    (
      organizationId === null ||
      ((job === EXTERNAL_AGENCY_PROPENSITY_JOB ||
        job === AGENCY_DNA_MATCH_JOB ||
        job === OPPORTUNITY_SCORING_V3_JOB) && workspaceId === null)
    )
  ) {
    return NextResponse.json(
      {
        error: job === EXTERNAL_AGENCY_PROPENSITY_JOB ||
          job === AGENCY_DNA_MATCH_JOB ||
          job === OPPORTUNITY_SCORING_V3_JOB
          ? 'workspace_and_organization_required_for_apply'
          : 'organization_required_for_apply',
      },
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
  const signalEpisodesOptions: SignalEpisodesJobOptions = {
    ...commonOptions,
    dryRun: applyValue !== 'true',
  }
  const commercialThesisOptions: CommercialThesisJobOptions = {
    ...commonOptions,
    dryRun: applyValue !== 'true',
  }
  const externalAgencyPropensityOptions: ExternalAgencyPropensityJobOptions = {
    ...commonOptions,
    workspaceId,
    dryRun: applyValue !== 'true',
  }
  const agencyDnaMatchOptions: AgencyDnaMatchJobOptions = {
    ...commonOptions,
    workspaceId,
    dryRun: applyValue !== 'true',
  }
  const opportunityScoringV3Options: OpportunityScoringV3JobOptions = {
    ...commonOptions,
    workspaceId,
    dryRun: applyValue !== 'true',
    rolloutMode: commercialSignalCandidateRolloutMode(workspaceId),
  }
  const commercialSignalQualityV2Options: CommercialSignalQualityV2ShadowOptions = {
    workspaceId,
    clientProfileId,
    organizationId,
    afterLineageId,
    batchSize: batchSize ?? undefined,
    dryRun: applyValue !== 'true',
  }
  const queryPlannerV2Options: QueryPlannerV2JobOptions = {
    enabled: true,
    workspaceId,
    clientProfileId,
    profileBatchSize: batchSize ?? undefined,
    dryRun: applyValue !== 'true',
  }

  try {
    const result = job === COMMERCIAL_SIGNAL_CANARY_JOB
      ? await runCommercialSignalCanary({
        batchSize: batchSize ?? 25,
      })
      : job === QUERY_PLANNER_V2_JOB
        ? await buildQueryPlansV2Job(queryPlannerV2Options)
        : job === COMMERCIAL_SIGNAL_QUALITY_V2_JOB
          ? await runCommercialSignalQualityV2ShadowPipeline(
            commercialSignalQualityV2Options,
          )
        : job === QUERY_PLANNER_V2_EXECUTION_JOB
          ? await executeQueryPlannerV2Sources({
            workspaceId: workspaceId!,
            clientProfileId,
            limit: Math.min(batchSize ?? 20, 50),
            dryRun: false,
          })
          : job === COMMERCIAL_SIGNAL_WRITER_JOB
            ? await writeCommercialSignalOpportunities({
              workspaceId: workspaceId!,
              clientProfileId,
              organizationId,
              batchSize: Math.min(batchSize ?? 20, 100),
            })
            : job === COMPANY_EVENTS_JOB
              ? await normalizeCompanyEventsJob(companyEventOptions)
              : job === COMPANY_STATE_JOB
                ? await buildCompanyStateJob(companyStateOptions)
                : job === SIGNAL_EPISODES_JOB
                  ? await buildSignalEpisodesJob(signalEpisodesOptions)
                  : job === COMMERCIAL_THESIS_JOB
                    ? await buildCommercialThesesJob(commercialThesisOptions)
                    : job === EXTERNAL_AGENCY_PROPENSITY_JOB
                      ? await buildExternalAgencyPropensityJob(
                        externalAgencyPropensityOptions,
                      )
                      : job === AGENCY_DNA_MATCH_JOB
                        ? await buildAgencyDnaMatchJob(agencyDnaMatchOptions)
                        : job === OPPORTUNITY_SCORING_V3_JOB
                          ? await buildOpportunityScoringV3Job(
                            opportunityScoringV3Options,
                          )
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
  return job === COMMERCIAL_SIGNAL_CANARY_JOB
    ? isQueryPlannerV2Enabled() && isOpportunityScoringV3Enabled()
    : job === COMMERCIAL_SIGNAL_QUALITY_V2_JOB
      ? isCommercialSignalQualityV2Enabled()
    : job === QUERY_PLANNER_V2_JOB || job === QUERY_PLANNER_V2_EXECUTION_JOB
      ? isQueryPlannerV2Enabled()
      : job === COMMERCIAL_SIGNAL_WRITER_JOB
        ? isOpportunityScoringV3Enabled()
        : job === COMPANY_EVENTS_JOB
          ? isCompanyEventsV1Enabled()
          : job === COMPANY_STATE_JOB
            ? isCompanyStateV1Enabled()
            : job === SIGNAL_EPISODES_JOB
              ? isSignalEpisodesV2Enabled()
              : job === COMMERCIAL_THESIS_JOB
                ? isCommercialThesisV1Enabled()
                : job === EXTERNAL_AGENCY_PROPENSITY_JOB
                  ? isExternalAgencyPropensityV1Enabled()
                  : job === AGENCY_DNA_MATCH_JOB
                    ? isAgencyDnaMatchV2Enabled()
                    : job === OPPORTUNITY_SCORING_V3_JOB
                      ? isOpportunityScoringV3Enabled()
                      : isOpportunityEngineV1Enabled()
}

function authorizeCron(request: NextRequest): NextResponse | null {
  const expectedKey = process.env.CRON_API_KEY?.trim()
  if (!expectedKey) {
    return NextResponse.json(
      { success: false, error: 'Opportunity service is not configured.' },
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
  if (!value || !/^[1-9]\d{0,18}$/.test(value)) return null
  return BigInt(value) <= BigInt('9223372036854775807')
    ? BigInt(value).toString()
    : null
}

function positiveInteger(value: string | null): number | null {
  if (!value) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}