import { NextRequest, NextResponse } from 'next/server'

import {
  isOpportunityEngineV1EnabledForContext,
  isOpportunityOutcomesEnabledForContext,
} from '@/lib/opportunities/config'
import { HIRING_EPISODE_TYPES } from '@/lib/opportunities/hiring-episode-detection'
import { getOutcomeFunnelSummary } from '@/lib/opportunities/outcome-repository'
import {
  OPPORTUNITY_HIRING_MODES,
  ORGANIZATION_SIZE_BUCKETS,
} from '@/lib/opportunities/analytics-cohort'
import { logError } from '@/lib/runtime'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  const authorization = await getOpportunityAuthorizationContext(
    'opportunities:read',
  )
  const featureContext = authorization ?? {
    dataOwnerId: null,
    workspaceId: null,
  }
  if (
    !isOpportunityEngineV1EnabledForContext(featureContext) ||
    !isOpportunityOutcomesEnabledForContext(featureContext)
  ) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!authorization) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const now = new Date()
  const rawTo = request.nextUrl.searchParams.get('to')
  const rawFrom = request.nextUrl.searchParams.get('from')
  const parsedTo = parseTimestamp(rawTo)
  const parsedFrom = parseTimestamp(rawFrom)
  if ((rawTo && !parsedTo) || (rawFrom && !parsedFrom)) {
    return NextResponse.json({ error: 'invalid_period' }, { status: 400 })
  }
  const to = parsedTo ?? now
  const from = parsedFrom ??
    new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (
    from >= to ||
    to.getTime() > now.getTime() + 5 * 60 * 1000 ||
    to.getTime() - from.getTime() > MAX_PERIOD_MS
  ) {
    return NextResponse.json({ error: 'invalid_period' }, { status: 400 })
  }

  const clientProfileId = optionalParam(request, 'clientProfileId')
  const clientProfileVersion = optionalParam(request, 'clientProfileVersion')
  const agencyDnaVersion = optionalParam(request, 'agencyDnaVersion')
  const hiringMode = optionalParam(request, 'hiringMode')
  const specialization = optionalParam(request, 'specialization')
  const matchedRoleFamily = optionalParam(request, 'matchedRoleFamily')
  const matchedIndustry = optionalParam(request, 'matchedIndustry')
  const matchedRegion = optionalParam(request, 'matchedRegion')
  const organizationSizeBucket = optionalParam(
    request,
    'organizationSizeBucket',
  )
  const episodeType = optionalParam(request, 'episodeType')
  const confidenceGate = optionalParam(request, 'confidenceGate')
  const sourceFamily = optionalParam(request, 'sourceFamily')
  const scoreBucket = optionalParam(request, 'scoreBucket')
  const externalSupportNeedBucket = optionalParam(
    request,
    'externalSupportNeedBucket',
  )
  const scoringVersion = optionalParam(request, 'scoringVersion')
  const cohort = optionalParam(request, 'cohort') ?? 'shown'
  const rawMaturityDays = optionalParam(request, 'maturityDays')
  const maturityDays = rawMaturityDays === null ? 30 : Number(rawMaturityDays)
  if (
    (clientProfileId && !/^[1-9]\d{0,18}$/.test(clientProfileId)) ||
    (clientProfileVersion && !isSafeIdentifier(clientProfileVersion)) ||
    (agencyDnaVersion && !isSafeIdentifier(agencyDnaVersion)) ||
    (hiringMode && !OPPORTUNITY_HIRING_MODES.includes(
      hiringMode as (typeof OPPORTUNITY_HIRING_MODES)[number],
    )) ||
    (specialization && !isSafeDimensionText(specialization)) ||
    (matchedRoleFamily && !isSafeDimensionText(matchedRoleFamily)) ||
    (matchedIndustry && !isSafeDimensionText(matchedIndustry)) ||
    (matchedRegion && !isSafeDimensionText(matchedRegion)) ||
    (organizationSizeBucket && !ORGANIZATION_SIZE_BUCKETS.includes(
      organizationSizeBucket as (typeof ORGANIZATION_SIZE_BUCKETS)[number],
    )) ||
    (episodeType && !HIRING_EPISODE_TYPES.includes(
      episodeType as (typeof HIRING_EPISODE_TYPES)[number],
    )) ||
    (confidenceGate && !['A', 'B', 'C', 'D'].includes(confidenceGate)) ||
    (sourceFamily && !/^[a-z0-9_-]{1,64}$/i.test(sourceFamily)) ||
    (scoreBucket && !/^(?:0-9|[1-9]0-[1-9]9|100)$/.test(scoreBucket)) ||
    (externalSupportNeedBucket &&
      !['low', 'medium', 'high'].includes(externalSupportNeedBucket)) ||
    (scoringVersion && !isSafeIdentifier(scoringVersion)) ||
    !['shown', 'accepted'].includes(cohort) ||
    !Number.isInteger(maturityDays) ||
    maturityDays < 1 ||
    maturityDays > 365
  ) {
    return NextResponse.json({ error: 'invalid_filter' }, { status: 400 })
  }

  try {
    const summary = await getOutcomeFunnelSummary({
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      from: from.toISOString(),
      to: to.toISOString(),
      clientProfileId,
      clientProfileVersion,
      agencyDnaVersion,
      hiringMode,
      specialization,
      matchedRoleFamily,
      matchedIndustry,
      matchedRegion,
      organizationSizeBucket,
      episodeType,
      confidenceGate,
      sourceFamily,
      scoreBucket,
      externalSupportNeedBucket: externalSupportNeedBucket as
        'low' | 'medium' | 'high' | null,
      scoringVersion,
      cohort: cohort as 'shown' | 'accepted',
      maturityDays,
    })
    return NextResponse.json(summary)
  } catch (error) {
    logError('opportunity_outcome.api.summary_failed', error, {
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
    })
    return NextResponse.json(
      { error: 'opportunity_outcome_summary_failed' },
      { status: 500 },
    )
  }
}

function optionalParam(request: NextRequest, name: string): string | null {
  const value = request.nextUrl.searchParams.get(name)?.trim()
  return value || null
}

function parseTimestamp(value: string | null): Date | null {
  if (value === null) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp) : null
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-z0-9._:-]{1,160}$/i.test(value)
}

function isSafeDimensionText(value: string): boolean {
  return value.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(value)
}
