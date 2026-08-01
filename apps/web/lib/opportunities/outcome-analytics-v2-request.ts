import {
  OPPORTUNITY_HIRING_MODES,
  ORGANIZATION_SIZE_BUCKETS,
} from './analytics-cohort'
import { HIRING_EPISODE_TYPES } from './hiring-episode-detection'
import type { OutcomeAnalyticsV2Filter } from './outcome-analytics-v2'
import {
  OPPORTUNITY_CONTACT_PATH_TYPES,
  OPPORTUNITY_OUTCOME_CHANNELS,
} from './outcome-domain'

const MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1000

export type ParsedOutcomeAnalyticsV2Filters = Omit<
  OutcomeAnalyticsV2Filter,
  'ownerId' | 'workspaceId'
>

export function parseOutcomeAnalyticsV2Filters(
  searchParams: URLSearchParams,
  now: Date,
):
  | { filters: ParsedOutcomeAnalyticsV2Filters }
  | { error: 'invalid_period' | 'invalid_filter' } {
  const rawTo = searchParams.get('to')
  const rawFrom = searchParams.get('from')
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

  const clientProfileId = optionalParam(searchParams, 'clientProfileId')
  const clientProfileVersion = optionalParam(searchParams, 'clientProfileVersion')
  const agencyDnaVersion = optionalParam(searchParams, 'agencyDnaVersion')
  const hiringMode = optionalParam(searchParams, 'hiringMode')
  const specialization = optionalParam(searchParams, 'specialization')
  const matchedRoleFamily = optionalParam(searchParams, 'matchedRoleFamily')
  const matchedIndustry = optionalParam(searchParams, 'matchedIndustry')
  const matchedRegion = optionalParam(searchParams, 'matchedRegion')
  const organizationSizeBucket = optionalParam(
    searchParams,
    'organizationSizeBucket',
  )
  const episodeType = optionalParam(searchParams, 'episodeType')
  const confidenceGate = optionalParam(searchParams, 'confidenceGate')
  const sourceFamily = optionalParam(searchParams, 'sourceFamily')
  const scoreBucket = optionalParam(searchParams, 'scoreBucket')
  const externalSupportNeedBucket = optionalParam(
    searchParams,
    'externalSupportNeedBucket',
  )
  const scoringVersion = optionalParam(searchParams, 'scoringVersion')
  const channel = optionalParam(searchParams, 'channel')
  const contactPathType = optionalParam(searchParams, 'contactPathType')
  const assignedUserId = optionalParam(searchParams, 'assignedUserId')
  const cohort = optionalParam(searchParams, 'cohort') ?? 'shown'
  const rawMaturityDays = optionalParam(searchParams, 'maturityDays')
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

function optionalParam(searchParams: URLSearchParams, name: string): string | null {
  const value = searchParams.get(name)?.trim()
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
