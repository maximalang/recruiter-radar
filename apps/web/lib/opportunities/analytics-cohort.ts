export const OPPORTUNITY_HIRING_MODES = [
  'auto',
  'specialist',
  'executive',
  'volume',
] as const

export type OpportunityHiringMode = (typeof OPPORTUNITY_HIRING_MODES)[number]

export const ORGANIZATION_SIZE_BUCKETS = [
  'startup',
  'small',
  'medium',
  'large',
  'enterprise',
  'unknown',
] as const

export type OrganizationSizeBucket =
  (typeof ORGANIZATION_SIZE_BUCKETS)[number]

export interface OpportunityAnalyticsCohort {
  clientProfileId: string
  clientProfileVersion: string
  agencyDnaVersion: string
  hiringMode: OpportunityHiringMode | 'unknown'
  specialization: string | null
  matchedRoleFamilies: string[]
  matchedIndustries: string[]
  matchedRegions: string[]
  organizationSizeBucket: OrganizationSizeBucket
  episodeType: string
  confidenceGate: string
  scoreBucket: string
  externalSupportNeedBucket: 'low' | 'medium' | 'high'
  sourceFamilies: string[]
  scoringVersion: string
}

export function createOpportunityAnalyticsCohort(input: {
  clientProfileId: string | number
  clientProfileVersion: string | null | undefined
  agencyDnaVersion?: string | null
  hiringMode: string | null | undefined
  specialization: string | null | undefined
  matchedRoleFamilies: readonly string[]
  matchedIndustries: readonly string[]
  matchedRegions: readonly string[]
  organizationSizeBucket?: string | null
  episodeType: string
  confidenceGate: string
  opportunityScore: number
  externalSupportNeedScore: number
  sourceFamilies: readonly string[]
  scoringVersion: string
}): OpportunityAnalyticsCohort {
  const clientProfileVersion =
    normalizedVersion(input.clientProfileVersion) ?? 'legacy-unversioned'
  return {
    clientProfileId: String(input.clientProfileId),
    clientProfileVersion,
    agencyDnaVersion:
      normalizedVersion(input.agencyDnaVersion) ?? clientProfileVersion,
    hiringMode: isHiringMode(input.hiringMode) ? input.hiringMode : 'unknown',
    specialization: normalizedOptionalText(input.specialization),
    matchedRoleFamilies: normalizedDimensionList(input.matchedRoleFamilies),
    matchedIndustries: normalizedDimensionList(input.matchedIndustries),
    matchedRegions: normalizedDimensionList(input.matchedRegions),
    organizationSizeBucket: isOrganizationSizeBucket(
      input.organizationSizeBucket,
    )
      ? input.organizationSizeBucket
      : 'unknown',
    episodeType: normalizedRequiredText(input.episodeType, 'unknown'),
    confidenceGate: normalizedRequiredText(input.confidenceGate, 'D'),
    scoreBucket: opportunityScoreBucket(input.opportunityScore),
    externalSupportNeedBucket: externalSupportNeedBucket(
      input.externalSupportNeedScore,
    ),
    sourceFamilies: normalizedDimensionList(input.sourceFamilies),
    scoringVersion: normalizedRequiredText(input.scoringVersion, 'unknown'),
  }
}

export function isCompleteOpportunityAnalyticsCohort(
  value: unknown,
): value is OpportunityAnalyticsCohort {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.clientProfileId === 'string' &&
    typeof item.clientProfileVersion === 'string' &&
    typeof item.agencyDnaVersion === 'string' &&
    (
      item.hiringMode === 'unknown' ||
      isHiringMode(item.hiringMode)
    ) &&
    (item.specialization === null || typeof item.specialization === 'string') &&
    isStringArray(item.matchedRoleFamilies) &&
    isStringArray(item.matchedIndustries) &&
    isStringArray(item.matchedRegions) &&
    isOrganizationSizeBucket(item.organizationSizeBucket) &&
    typeof item.episodeType === 'string' &&
    typeof item.confidenceGate === 'string' &&
    typeof item.scoreBucket === 'string' &&
    ['low', 'medium', 'high'].includes(
      String(item.externalSupportNeedBucket),
    ) &&
    isStringArray(item.sourceFamilies) &&
    typeof item.scoringVersion === 'string'
  )
}

export function opportunityScoreBucket(score: number): string {
  const percent = Math.min(Math.max(Math.floor(score * 100), 0), 100)
  if (percent === 100) return '100'
  const lower = Math.floor(percent / 10) * 10
  return `${lower}-${lower + 9}`
}

export function externalSupportNeedBucket(
  score: number,
): 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  return 'low'
}

function isHiringMode(value: unknown): value is OpportunityHiringMode {
  return typeof value === 'string' &&
    OPPORTUNITY_HIRING_MODES.includes(value as OpportunityHiringMode)
}

function isOrganizationSizeBucket(
  value: unknown,
): value is OrganizationSizeBucket {
  return typeof value === 'string' &&
    ORGANIZATION_SIZE_BUCKETS.includes(value as OrganizationSizeBucket)
}

function normalizedVersion(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized ? normalized.slice(0, 160) : null
}

function normalizedOptionalText(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? ''
  return normalized ? normalized.slice(0, 160) : null
}

function normalizedRequiredText(value: string, fallback: string): string {
  return normalizedOptionalText(value) ?? fallback
}

function normalizedDimensionList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) =>
    value.trim().toLocaleLowerCase('ru-RU')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ru-RU'))
    .slice(0, 100)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
