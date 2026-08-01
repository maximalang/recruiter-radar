import { NextRequest, NextResponse } from 'next/server'

import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import {
  OPPORTUNITY_HIRING_MODES,
  ORGANIZATION_SIZE_BUCKETS,
} from '@/lib/opportunities/analytics-cohort'
import { isOpportunityAnalyticsV2EnabledForContext } from '@/lib/opportunities/config'
import { HIRING_EPISODE_TYPES } from '@/lib/opportunities/hiring-episode-detection'
import {
  getOutcomeAnalyticsV2Summary,
  type OutcomeAnalyticsV2Filter,
} from '@/lib/opportunities/outcome-analytics-v2'
import {
  OPPORTUNITY_CONTACT_PATH_TYPES,
  OPPORTUNITY_OUTCOME_CHANNELS,
} from '@/lib/opportunities/outcome-domain'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1000

type ParsedFilters = Omit<
  OutcomeAnalyticsV2Filter,
  'ownerId' | 'workspaceId'
>

export async function GET(request: NextRequest) {
  const authorization = await getOpportunityAuthorizationContext(
    'opportunities:read',
  )
  const featureContext = authorization ?? {
    dataOwnerId: null,
    workspaceId: null,
  }
  if (!isOpportunityAnalyticsV2EnabledForContext(featureContext)) {
    return json({ error: 'not_found' }, 404)
  }
  if (!authorization) {
    return json({ error: 'authentication_required' }, 401)
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access || access.authMode !== 'auth_v2' || access.workspaceId == null) {
    return json({ error: 'not_found' }, 404)
  }

  const parsed = parseFilters(request, new Date())
  if ('error' in parsed) {
    logEvent('opportunity_analytics_v2.request_rejected', {
      reasonCode: parsed.error,
      rejected: 1,
    })
    return json({ error: parsed.error }, 400)
  }

  const startedAt = Date.now()
  try {
    const summary = await getOutcomeAnalyticsV2Summary({
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      ...parsed.filters,
    })
    logEvent('opportunity_analytics_v2.summary_completed', {
      durationMs: Date.now() - startedAt,
      cohortSize: summary.cohort.size,
      wonWithConfirmedValue:
        summary.confirmedRevenue.wonWithConfirmedValue,
      wonWithoutConfirmedValue:
        summary.confirmedRevenue.wonWithoutConfirmedValue,
      completed: 1,
    })
    return json(summary, 200)
  } catch (error) {
    logError('opportunity_analytics_v2.summary_failed', error, {
      durationMs: Date.now() - startedAt,
      failed: 1,
    })
    return json({ error: 'opportunity_analytics_v2_unavailable' }, 500)
  }
}

function parseFilters(
  request: NextRequest,
  now: Date,
): { filters: ParsedFilters } | { error: 'invalid_period' | 'invalid_filter' } {
  const rawTo = request.nextUrl.searchParams.get('to')
  const rawFrom = request.nextUrl.searchParams.get('from')
  const parsedTo = parseTimestamp(rawTo)
  const parsedFrom = parseTimestamp(rawFrom)
  if ((rawTo && !parsedTo) || (rawFrom && !parsedFrom)) {
    return { error: 'invalid_period' }
  }
  const to = parsedTo ?? now
  const from = parsedFrom ??
    new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (
    from >= to ||
    to.getTime() > now.getTime() + 5 * 60 * 1000 ||
    to.getTime() - from.getTime() > MAX_PERIOD_MS
  ) {
    return { error: 'invalid_period' }
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
  const channel = optionalParam(request, 'channel')
  const contactPathType = optionalParam(request, 'contactPathType')
  const assignedUserId = optionalParam(request, 'assignedUserId')
  const cohort = optionalParam(request, 'cohort') ?? 'shown'
  const rawMaturityDays = optionalParam(request, 'maturityDays')
  const maturityDays = rawMaturityDays === null ? 30 : Number(rawMaturityDays)

  if (
    (clientProfileId && !isPositiveId(clientProfileId)) ||
    (clientProfileVersion && !isSafeIdentifier(clientProfileVersion)) ||
    (agencyDnaVersion && !isSafeIdentifier(agencyDnaVersion)) ||
    (hiringMode && ![...OPPORTUNITY_HIRING_MODES, 'unknown'].includes(
      hiringMode as (typeof OPPORTUNITY_HIRING_MODES)[number] | 'unknown',
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
    (channel && !OPPORTUNITY_OUTCOME_CHANNELS.includes(
      channel as (typeof OPPORTUNITY_OUTCOME_CHANNELS)[number],
    )) ||
    (contactPathType && !OPPORTUNITY_CONTACT_PATH_TYPES.includes(
      contactPathType as (typeof OPPORTUNITY_CONTACT_PATH_TYPES)[number],
    )) ||
    (assignedUserId &&
      assignedUserId !== 'unknown' &&
      !isPositiveId(assignedUserId)) ||
    !['shown', 'accepted', 'contacted'].includes(cohort) ||
    ((channel || contactPathType) && cohort !== 'contacted') ||
    !Number.isInteger(maturityDays) ||
    maturityDays < 1 ||
    maturityDays > 365
  ) {
    return { error: 'invalid_filter' }
  }

  return {
    filters: {
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
      channel,
      contactPathType,
      assignedUserId,
      cohort: cohort as 'shown' | 'accepted' | 'contacted',
      maturityDays,
    },
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

function isPositiveId(value: string): boolean {
  return /^[1-9]\d{0,18}$/.test(value)
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-z0-9._:-]{1,160}$/i.test(value)
}

function isSafeDimensionText(value: string): boolean {
  return value.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(value)
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
