export const AGENCY_DNA_SERVICE_TYPES = [
  'permanent',
  'executive',
  'volume',
  'project',
] as const

export const AGENCY_DNA_RESTRICTION_TYPES = [
  'existing_client',
  'former_client',
  'do_not_contact',
  'conflict',
] as const

export const AGENCY_DNA_TARGET_SENIORITIES = [
  'junior',
  'middle',
  'senior',
  'lead',
  'executive',
] as const

export const AGENCY_DNA_ENGAGEMENT_TYPES = [
  'success_fee',
  'retainer',
  'embedded',
  'project',
] as const

export const AGENCY_DNA_CAPACITIES = ['low', 'normal', 'high'] as const

export type AgencyDnaServiceType = typeof AGENCY_DNA_SERVICE_TYPES[number]
export type AgencyDnaRestrictionType =
  typeof AGENCY_DNA_RESTRICTION_TYPES[number]
export type AgencyDnaCapacity = 'low' | 'normal' | 'high'

export type AgencyDnaCaseStudy = {
  roleFamilies: string[]
  industries: string[]
  companySizeBucket: string | null
  region: string | null
  measurableResult: string | null
  publicSafeDescription: string | null
}

export type AgencyDnaOpportunityContext = {
  capabilityMatches: {
    roleFamilies: string[]
    industries: string[]
    regions: string[]
    seniorities: string[]
    serviceTypes: AgencyDnaServiceType[]
    engagementTypes: string[]
    companySizeBucket: string | null
  }
  restrictionSnapshot: {
    type: AgencyDnaRestrictionType | null
    opportunityMode: 'new' | 'grow' | 'reactivate' | 'blocked'
    blocksOpportunity: boolean
  }
  blocksOpportunity: boolean
}

type AgencyDnaOpportunityInput = {
  serviceTypes: readonly AgencyDnaServiceType[]
  targetSeniorities: readonly string[]
  preferredEngagementTypes: readonly string[]
  currentCapacity: AgencyDnaCapacity
  matchedRoleFamilies: readonly string[]
  matchedIndustries: readonly string[]
  matchedRegions: readonly string[]
  episodeTitle: string
  vacancyCount: number
  restrictionType: AgencyDnaRestrictionType | null
  companySizeBucket?: string | null
  evidencedEngagementTypes?: readonly string[]
}

export class AgencyDnaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgencyDnaValidationError'
  }
}

export function resolveAgencyDnaOpportunityContext(
  input: AgencyDnaOpportunityInput,
): AgencyDnaOpportunityContext {
  const seniority = inferSeniority(input.episodeTitle)
  const serviceTypes = input.serviceTypes.filter((serviceType) => {
    if (serviceType === 'permanent') return true
    if (serviceType === 'executive') {
      return seniority === 'executive' ||
        input.matchedRoleFamilies.includes('executive')
    }
    if (serviceType === 'volume') return input.vacancyCount >= 5
    return false
  })
  const evidencedEngagementTypes = input.evidencedEngagementTypes ?? []
  const engagementTypes = input.preferredEngagementTypes.filter((type) =>
    evidencedEngagementTypes.includes(type),
  )
  const restrictionSnapshot = resolveRestriction(input.restrictionType)

  return {
    capabilityMatches: {
      roleFamilies: uniqueStrings(input.matchedRoleFamilies),
      industries: uniqueStrings(input.matchedIndustries),
      regions: uniqueStrings(input.matchedRegions),
      seniorities: seniority && input.targetSeniorities.includes(seniority)
        ? [seniority]
        : [],
      serviceTypes,
      engagementTypes,
      companySizeBucket: input.companySizeBucket ?? null,
    },
    restrictionSnapshot,
    blocksOpportunity: restrictionSnapshot.blocksOpportunity,
  }
}

export function normalizeAgencyDnaCaseStudies(
  input: readonly Partial<AgencyDnaCaseStudy>[],
): AgencyDnaCaseStudy[] {
  if (input.length > 20) {
    throw new AgencyDnaValidationError('Agency DNA accepts at most 20 case studies')
  }

  return input.map((caseStudy) => {
    const normalized: AgencyDnaCaseStudy = {
      roleFamilies: normalizeStringList(caseStudy.roleFamilies, 20, 80),
      industries: normalizeStringList(caseStudy.industries, 20, 80),
      companySizeBucket: normalizeText(caseStudy.companySizeBucket, 80),
      region: normalizeText(caseStudy.region, 120),
      measurableResult: normalizeText(caseStudy.measurableResult, 500),
      publicSafeDescription: normalizeText(caseStudy.publicSafeDescription, 1000),
    }

    for (const value of [
      normalized.measurableResult,
      normalized.publicSafeDescription,
    ]) {
      if (value && containsPersonalContact(value)) {
        throw new AgencyDnaValidationError(
          'Case studies must not contain personal email addresses or phone numbers',
        )
      }
    }

    return normalized
  })
}

function resolveRestriction(type: AgencyDnaRestrictionType | null) {
  if (type === 'existing_client') {
    return { type, opportunityMode: 'grow' as const, blocksOpportunity: false }
  }
  if (type === 'former_client') {
    return { type, opportunityMode: 'reactivate' as const, blocksOpportunity: false }
  }
  if (type === 'do_not_contact' || type === 'conflict') {
    return { type, opportunityMode: 'blocked' as const, blocksOpportunity: true }
  }
  return { type: null, opportunityMode: 'new' as const, blocksOpportunity: false }
}

function inferSeniority(title: string): string | null {
  const normalized = title.toLocaleLowerCase('ru-RU')
  if (/\b(c[etf]o|chief|head|director|vp)\b|директор|руковод/.test(normalized)) {
    return 'executive'
  }
  if (/\blead\b|лид|ведущ/.test(normalized)) return 'lead'
  if (/\bsenior\b|старш/.test(normalized)) return 'senior'
  if (/\bmiddle\b|мидл/.test(normalized)) return 'middle'
  if (/\bjunior\b|джун|младш/.test(normalized)) return 'junior'
  return null
}

function normalizeStringList(
  values: readonly string[] | undefined,
  maximumItems: number,
  maximumLength: number,
): string[] {
  const normalized = uniqueStrings(values ?? []).map((value) => {
    if (value.length > maximumLength) {
      throw new AgencyDnaValidationError(`Value exceeds ${maximumLength} characters`)
    }
    return value
  })
  if (normalized.length > maximumItems) {
    throw new AgencyDnaValidationError(`List accepts at most ${maximumItems} values`)
  }
  return normalized
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeText(
  value: string | null | undefined,
  maximumLength: number,
): string | null {
  const normalized = value?.trim() ?? ''
  if (!normalized) return null
  if (normalized.length > maximumLength) {
    throw new AgencyDnaValidationError(`Value exceeds ${maximumLength} characters`)
  }
  return normalized
}

function containsPersonalContact(value: string): boolean {
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  const phonePattern = /(?:^|\D)(?:\+?7|8)[\s().-]*\d{3}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?:\D|$)/
  return emailPattern.test(value) || phonePattern.test(value)
}
