import {
  AGENCY_DNA_CAPACITIES,
  AGENCY_DNA_CASE_HIRING_MODES,
  AGENCY_DNA_ENGAGEMENT_TYPES,
  AGENCY_DNA_RESTRICTION_TYPES,
  AGENCY_DNA_SERVICE_TYPES,
  type AgencyDnaCapacity,
  type AgencyDnaCaseHiringMode,
  type AgencyDnaCaseStudy,
  type AgencyDnaRestrictionType,
  type AgencyDnaServiceType,
} from './agency-dna'
import { hashCanonicalJson } from './canonical-hash'
import {
  EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
  EXTERNAL_AGENCY_PROPENSITY_LEVELS,
  type ExternalAgencyPropensityLevel,
} from './external-agency-propensity'
import type { SignalEpisodeStage } from './signal-episode'

export const AGENCY_DNA_MATCH_FEATURE_VERSION = 'agency-dna-match-v2' as const

export const AGENCY_DNA_MATCH_MODES = ['find', 'grow', 'reactivate'] as const
export const AGENCY_DNA_MATCH_LEVELS = [
  'strong',
  'supported',
  'weak',
  'insufficient_evidence',
  'blocked',
] as const
export const AGENCY_DNA_MATCH_DIMENSIONS = [
  'specialization',
  'role_family',
  'seniority',
  'technology_qualification',
  'industry',
  'region',
  'remote',
  'service_type',
  'engagement_type',
  'company_size',
  'economics',
  'case_study',
  'undesirable_hiring_type',
  'account_policy',
] as const

export type AgencyDnaMatchMode = typeof AGENCY_DNA_MATCH_MODES[number]
export type AgencyDnaMatchLevel = typeof AGENCY_DNA_MATCH_LEVELS[number]
export type AgencyDnaMatchDimension = typeof AGENCY_DNA_MATCH_DIMENSIONS[number]
export type AgencyDnaMatchDimensionOutcome =
  | 'match'
  | 'mismatch'
  | 'unknown'
  | 'not_configured'
  | 'blocked'
export type AgencyDnaMatchReasonBasis =
  | 'evidence'
  | 'agency_profile'
  | 'organization_record'
  | 'policy'

export type AgencyDnaMatchReason = {
  code: string
  message: string
  dimension: AgencyDnaMatchDimension
  basis: AgencyDnaMatchReasonBasis
  contribution: number
  evidenceIds: string[]
}

export type AgencyDnaMatchDimensionResult = {
  outcome: AgencyDnaMatchDimensionOutcome
  contribution: number
  weight: number
  agencyValues: string[]
  companyValues: string[]
}

export type AgencyDnaMatchSelectionPolicy = {
  capacity: AgencyDnaCapacity
  minimumFitScore: number
  minimumCoverage: number
  minimumPropensityLevel: 'medium'
  quotaMultiplier: number
  adjacentMatchesAllowed: boolean
}

export type AgencyDnaMatchModeResult = {
  mode: AgencyDnaMatchMode
  applicable: boolean
  status:
    | 'qualifies'
    | 'below_threshold'
    | 'not_applicable'
    | 'insufficient_evidence'
    | 'blocked'
  fitScore: number
  coverage: number
  minimumFitScore: number
  minimumCoverage: number
}

export type AgencyDnaMatchInput = {
  organizationId: string
  workspaceId: string
  ownerId: string
  clientProfileId: string
  propensitySnapshotId: string
  propensityGeneration: number
  propensityIdentity: string
  propensityInputHash: string
  propensityEvidenceHash: string
  propensityFeatureVersion: string
  propensityScore: number
  propensityLevel: ExternalAgencyPropensityLevel
  episodeStage: SignalEpisodeStage
  evidenceSourceFamilyCount: number
  evidenceIds: string[]
  roleFamilies: string[]
  seniorityDistribution: Record<string, number>
  episodeRegions: string[]
  organizationIndustry: string | null
  organizationCity: string | null
  organizationCountry: string | null
  evidencedTechnologyQualificationTags: string[]
  evidencedServiceTypes: AgencyDnaServiceType[]
  evidencedEngagementTypes: string[]
  remoteStatus: boolean | null
  companySizeBucket: string | null
  estimatedFeeMinor: number | null
  estimatedOpportunityValueMinor: number | null
  agencyDnaVersion: number
  agencyDnaSnapshotHash: string
  agencyDnaSourceSnapshot: Readonly<Record<string, unknown>>
  specialization: string | null
  roles: string[]
  technologyQualificationTags: string[]
  industries: string[]
  targetCity: string | null
  preferredRegions: string[]
  excludedIndustries: string[]
  excludedLocations: string[]
  remoteFriendly: boolean
  serviceTypes: AgencyDnaServiceType[]
  targetSeniorities: string[]
  minimumFeeMinor: number | null
  averageFeeMinor: number | null
  minimumOpportunityValueMinor: number | null
  preferredEngagementTypes: string[]
  companySizes: string[]
  hiringMode: AgencyDnaCaseHiringMode
  undesirableHiringTypes: AgencyDnaServiceType[]
  currentCapacity: AgencyDnaCapacity
  caseStudies: AgencyDnaCaseStudy[]
  accountRestriction: AgencyDnaRestrictionType | null
}

export type AgencyDnaMatchDraft = {
  organizationId: string
  workspaceId: string
  ownerId: string
  clientProfileId: string
  propensitySnapshotId: string
  propensityGeneration: number
  agencyDnaVersion: number
  agencyDnaSnapshotHash: string
  agencyDnaSourceSnapshot: Readonly<Record<string, unknown>>
  matchIdentity: string
  fitScore: number
  coverage: number
  level: AgencyDnaMatchLevel
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>
  reasons: AgencyDnaMatchReason[]
  unknownDimensions: AgencyDnaMatchDimension[]
  selectionPolicy: AgencyDnaMatchSelectionPolicy
  modes: Record<AgencyDnaMatchMode, AgencyDnaMatchModeResult>
  evidenceIds: string[]
  propensityEvidenceHash: string
  inputHash: string
  featureVersion: typeof AGENCY_DNA_MATCH_FEATURE_VERSION
  featureSnapshot: AgencyDnaMatchFeatureSnapshot
}

export type AgencyDnaMatchFeatureSnapshot = {
  propensity: {
    snapshotId: string
    generation: number
    identity: string
    inputHash: string
    featureVersion: typeof EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION
    score: number
    level: ExternalAgencyPropensityLevel
    episodeStage: SignalEpisodeStage
    evidenceSourceFamilyCount: number
  }
  company: {
    roleFamilies: string[]
    seniorityDistribution: Record<string, number>
    episodeRegions: string[]
    organizationIndustry: string | null
    organizationCity: string | null
    organizationCountry: string | null
    technologyQualificationTags: string[]
    serviceTypes: AgencyDnaServiceType[]
    engagementTypes: string[]
    remoteStatus: boolean | null
    companySizeBucket: string | null
    estimatedFeeMinor: number | null
    estimatedOpportunityValueMinor: number | null
  }
  agency: {
    specializationTerms: string[]
    roles: string[]
    technologyQualificationTags: string[]
    industries: string[]
    targetRegions: string[]
    excludedIndustries: string[]
    excludedLocations: string[]
    remoteFriendly: boolean
    serviceTypes: AgencyDnaServiceType[]
    targetSeniorities: string[]
    minimumFeeMinor: number | null
    averageFeeMinor: number | null
    minimumOpportunityValueMinor: number | null
    preferredEngagementTypes: string[]
    companySizes: string[]
    hiringMode: AgencyDnaCaseHiringMode
    undesirableHiringTypes: AgencyDnaServiceType[]
    currentCapacity: AgencyDnaCapacity
    caseStudies: AgencyDnaCaseStudy[]
    accountRestriction: AgencyDnaRestrictionType | null
  }
}

type Evaluation = {
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>
  reasons: AgencyDnaMatchReason[]
  blocked: boolean
}

const WEIGHTS: Record<AgencyDnaMatchDimension, number> = {
  specialization: 0.10,
  role_family: 0.18,
  seniority: 0.12,
  technology_qualification: 0.10,
  industry: 0.12,
  region: 0.10,
  remote: 0.04,
  service_type: 0.08,
  engagement_type: 0.05,
  company_size: 0.05,
  economics: 0.04,
  case_study: 0.02,
  undesirable_hiring_type: 0,
  account_policy: 0,
}

const SELECTION_POLICIES: Record<
  AgencyDnaCapacity,
  AgencyDnaMatchSelectionPolicy
> = {
  low: {
    capacity: 'low',
    minimumFitScore: 0.75,
    minimumCoverage: 0.5,
    minimumPropensityLevel: 'medium',
    quotaMultiplier: 0.5,
    adjacentMatchesAllowed: false,
  },
  normal: {
    capacity: 'normal',
    minimumFitScore: 0.58,
    minimumCoverage: 0.35,
    minimumPropensityLevel: 'medium',
    quotaMultiplier: 1,
    adjacentMatchesAllowed: false,
  },
  high: {
    capacity: 'high',
    minimumFitScore: 0.58,
    minimumCoverage: 0.35,
    minimumPropensityLevel: 'medium',
    quotaMultiplier: 1.5,
    adjacentMatchesAllowed: true,
  },
}

export function buildAgencyDnaMatch(
  rawInput: AgencyDnaMatchInput,
): AgencyDnaMatchDraft {
  const input = normalizeInput(rawInput)
  const featureSnapshot = snapshot(input)
  const evaluation = evaluate(featureSnapshot, input.evidenceIds)
  const scored = score(evaluation.dimensions)
  const evidenceSufficient = propensityClearsEvidenceFloor(featureSnapshot)
  if (!evidenceSufficient) {
    evaluation.reasons.push(reason({
      code: 'PROPENSITY_BELOW_EVIDENCE_FLOOR',
      message: 'External Agency Propensity does not clear the shared evidence floor.',
      dimension: 'account_policy',
      basis: 'policy',
      contribution: 0,
    }))
  }
  const selectionPolicy = { ...SELECTION_POLICIES[input.currentCapacity] }
  const level = matchLevel({
    blocked: evaluation.blocked,
    evidenceSufficient,
    fitScore: scored.fitScore,
    coverage: scored.coverage,
    propensityLevel: input.propensityLevel,
  })
  const modes = Object.fromEntries(AGENCY_DNA_MATCH_MODES.map((mode) => [
    mode,
    modeResult({
      mode,
      restriction: input.accountRestriction,
      blocked: evaluation.blocked,
      evidenceSufficient,
      fitScore: scored.fitScore,
      coverage: scored.coverage,
      policy: selectionPolicy,
    }),
  ])) as Record<AgencyDnaMatchMode, AgencyDnaMatchModeResult>
  const matchIdentity = hashCanonicalJson({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    clientProfileId: input.clientProfileId,
    propensityIdentity: input.propensityIdentity,
    featureVersion: AGENCY_DNA_MATCH_FEATURE_VERSION,
  })
  const inputHash = hashCanonicalJson({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    clientProfileId: input.clientProfileId,
    propensityEvidenceHash: input.propensityEvidenceHash,
    agencyDnaVersion: input.agencyDnaVersion,
    agencyDnaSnapshotHash: input.agencyDnaSnapshotHash,
    agencyDnaSourceSnapshot: input.agencyDnaSourceSnapshot,
    featureSnapshot,
    featureVersion: AGENCY_DNA_MATCH_FEATURE_VERSION,
  })

  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    clientProfileId: input.clientProfileId,
    propensitySnapshotId: input.propensitySnapshotId,
    propensityGeneration: input.propensityGeneration,
    agencyDnaVersion: input.agencyDnaVersion,
    agencyDnaSnapshotHash: input.agencyDnaSnapshotHash,
    agencyDnaSourceSnapshot: input.agencyDnaSourceSnapshot,
    matchIdentity,
    fitScore: scored.fitScore,
    coverage: scored.coverage,
    level,
    dimensions: evaluation.dimensions,
    reasons: evaluation.reasons,
    unknownDimensions: AGENCY_DNA_MATCH_DIMENSIONS.filter((dimension) =>
      evaluation.dimensions[dimension].outcome === 'unknown'),
    selectionPolicy,
    modes,
    evidenceIds: input.evidenceIds,
    propensityEvidenceHash: input.propensityEvidenceHash,
    inputHash,
    featureVersion: AGENCY_DNA_MATCH_FEATURE_VERSION,
    featureSnapshot,
  }
}

function normalizeInput(input: AgencyDnaMatchInput): AgencyDnaMatchInput {
  if (input.propensityFeatureVersion !== EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION) {
    throw new TypeError('Unsupported propensity feature version.')
  }
  if (!EXTERNAL_AGENCY_PROPENSITY_LEVELS.includes(input.propensityLevel)) {
    throw new TypeError('Unsupported propensity level.')
  }
  if (!['active', 'cooling', 'expired'].includes(input.episodeStage)) {
    throw new TypeError('Unsupported episode stage.')
  }
  if (!Number.isFinite(input.propensityScore) ||
      input.propensityScore < 0 || input.propensityScore > 1) {
    throw new TypeError('Propensity score must be between 0 and 1.')
  }
  if (!Number.isSafeInteger(input.evidenceSourceFamilyCount) ||
      input.evidenceSourceFamilyCount < 0) {
    throw new TypeError('Evidence source-family count must be a non-negative integer.')
  }
  if (!AGENCY_DNA_CAPACITIES.includes(input.currentCapacity)) {
    throw new TypeError('Unsupported Agency DNA capacity.')
  }
  if (!AGENCY_DNA_CASE_HIRING_MODES.includes(input.hiringMode)) {
    throw new TypeError('Unsupported Agency DNA hiring mode.')
  }
  if (input.accountRestriction !== null &&
      !AGENCY_DNA_RESTRICTION_TYPES.includes(input.accountRestriction)) {
    throw new TypeError('Unsupported Agency DNA account restriction.')
  }
  const evidenceIds = ids(input.evidenceIds, 'evidence')
  if (evidenceIds.length === 0) {
    throw new TypeError('Agency DNA Match requires at least one evidence id.')
  }

  return {
    ...input,
    organizationId: positiveId(input.organizationId, 'organization'),
    workspaceId: positiveId(input.workspaceId, 'workspace'),
    ownerId: positiveId(input.ownerId, 'owner'),
    clientProfileId: positiveId(input.clientProfileId, 'client profile'),
    propensitySnapshotId: positiveId(input.propensitySnapshotId, 'propensity snapshot'),
    propensityGeneration: positiveInteger(
      input.propensityGeneration,
      'propensity generation',
    ),
    propensityIdentity: hash(input.propensityIdentity, 'propensity identity hash'),
    propensityInputHash: hash(input.propensityInputHash, 'propensity input hash'),
    propensityEvidenceHash: hash(
      input.propensityEvidenceHash,
      'propensity evidence hash',
    ),
    agencyDnaVersion: positiveInteger(input.agencyDnaVersion, 'Agency DNA version'),
    agencyDnaSnapshotHash: hash(
      input.agencyDnaSnapshotHash,
      'Agency DNA snapshot hash',
    ),
    agencyDnaSourceSnapshot: jsonObject(
      input.agencyDnaSourceSnapshot,
      'Agency DNA source snapshot',
    ),
    evidenceIds,
    roleFamilies: strings(input.roleFamilies),
    seniorityDistribution: numberRecord(input.seniorityDistribution),
    episodeRegions: strings(input.episodeRegions),
    organizationIndustry: text(input.organizationIndustry),
    organizationCity: text(input.organizationCity),
    organizationCountry: text(input.organizationCountry),
    evidencedTechnologyQualificationTags: strings(
      input.evidencedTechnologyQualificationTags,
    ),
    evidencedServiceTypes: serviceTypes(
      input.evidencedServiceTypes,
      'evidenced service type',
    ),
    evidencedEngagementTypes: allowedStrings(
      input.evidencedEngagementTypes,
      AGENCY_DNA_ENGAGEMENT_TYPES,
      'evidenced engagement type',
    ),
    companySizeBucket: text(input.companySizeBucket),
    estimatedFeeMinor: money(input.estimatedFeeMinor, 'estimated fee'),
    estimatedOpportunityValueMinor: money(
      input.estimatedOpportunityValueMinor,
      'estimated opportunity value',
    ),
    specialization: text(input.specialization),
    roles: strings(input.roles),
    technologyQualificationTags: strings(input.technologyQualificationTags),
    industries: strings(input.industries),
    targetCity: text(input.targetCity),
    preferredRegions: strings(input.preferredRegions),
    excludedIndustries: strings(input.excludedIndustries),
    excludedLocations: strings(input.excludedLocations),
    serviceTypes: serviceTypes(input.serviceTypes, 'Agency DNA service type'),
    targetSeniorities: strings(input.targetSeniorities),
    minimumFeeMinor: money(input.minimumFeeMinor, 'minimum fee'),
    averageFeeMinor: money(input.averageFeeMinor, 'average fee'),
    minimumOpportunityValueMinor: money(
      input.minimumOpportunityValueMinor,
      'minimum opportunity value',
    ),
    preferredEngagementTypes: allowedStrings(
      input.preferredEngagementTypes,
      AGENCY_DNA_ENGAGEMENT_TYPES,
      'preferred engagement type',
    ),
    companySizes: strings(input.companySizes),
    undesirableHiringTypes: serviceTypes(
      input.undesirableHiringTypes,
      'undesirable hiring type',
    ),
    caseStudies: normalizeCaseStudies(input.caseStudies),
  }
}

function snapshot(input: AgencyDnaMatchInput): AgencyDnaMatchFeatureSnapshot {
  return {
    propensity: {
      snapshotId: input.propensitySnapshotId,
      generation: input.propensityGeneration,
      identity: input.propensityIdentity,
      inputHash: input.propensityInputHash,
      featureVersion: EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
      score: input.propensityScore,
      level: input.propensityLevel,
      episodeStage: input.episodeStage,
      evidenceSourceFamilyCount: input.evidenceSourceFamilyCount,
    },
    company: {
      roleFamilies: input.roleFamilies,
      seniorityDistribution: input.seniorityDistribution,
      episodeRegions: input.episodeRegions,
      organizationIndustry: input.organizationIndustry,
      organizationCity: input.organizationCity,
      organizationCountry: input.organizationCountry,
      technologyQualificationTags: input.evidencedTechnologyQualificationTags,
      serviceTypes: input.evidencedServiceTypes,
      engagementTypes: input.evidencedEngagementTypes,
      remoteStatus: input.remoteStatus,
      companySizeBucket: input.companySizeBucket,
      estimatedFeeMinor: input.estimatedFeeMinor,
      estimatedOpportunityValueMinor: input.estimatedOpportunityValueMinor,
    },
    agency: {
      specializationTerms: specializationTerms(input.specialization),
      roles: input.roles,
      technologyQualificationTags: input.technologyQualificationTags,
      industries: input.industries,
      targetRegions: strings([
        ...input.preferredRegions,
        ...(input.targetCity ? [input.targetCity] : []),
      ]),
      excludedIndustries: input.excludedIndustries,
      excludedLocations: input.excludedLocations,
      remoteFriendly: input.remoteFriendly,
      serviceTypes: input.serviceTypes,
      targetSeniorities: input.targetSeniorities,
      minimumFeeMinor: input.minimumFeeMinor,
      averageFeeMinor: input.averageFeeMinor,
      minimumOpportunityValueMinor: input.minimumOpportunityValueMinor,
      preferredEngagementTypes: input.preferredEngagementTypes,
      companySizes: input.companySizes,
      hiringMode: input.hiringMode,
      undesirableHiringTypes: input.undesirableHiringTypes,
      currentCapacity: input.currentCapacity,
      caseStudies: input.caseStudies,
      accountRestriction: input.accountRestriction,
    },
  }
}

function evaluate(
  snapshot: AgencyDnaMatchFeatureSnapshot,
  evidenceIds: string[],
): Evaluation {
  const dimensions = emptyDimensions()
  const reasons: AgencyDnaMatchReason[] = []
  let blocked = false
  const company = snapshot.company
  const agency = snapshot.agency
  const companyIndustry = company.organizationIndustry
    ? [company.organizationIndustry]
    : []
  const companyRegions = strings([
    ...company.episodeRegions,
    ...(company.organizationCity ? [company.organizationCity] : []),
  ])
  const companySeniorities = Object.entries(company.seniorityDistribution)
    .filter(([, count]) => count > 0)
    .map(([name]) => name)
  const specializationCompanyValues = strings([
    ...company.roleFamilies,
    ...companyIndustry,
    ...company.technologyQualificationTags,
  ])

  evaluateList({
    dimensions,
    reasons,
    dimension: 'specialization',
    agencyValues: agency.specializationTerms,
    companyValues: specializationCompanyValues,
    basis: 'agency_profile',
    evidenceIds: [],
  })
  evaluateList({
    dimensions,
    reasons,
    dimension: 'role_family',
    agencyValues: agency.roles,
    companyValues: company.roleFamilies,
    basis: 'evidence',
    evidenceIds,
  })
  evaluateList({
    dimensions,
    reasons,
    dimension: 'seniority',
    agencyValues: agency.targetSeniorities,
    companyValues: companySeniorities,
    basis: 'evidence',
    evidenceIds,
  })
  evaluateList({
    dimensions,
    reasons,
    dimension: 'technology_qualification',
    agencyValues: agency.technologyQualificationTags,
    companyValues: company.technologyQualificationTags,
    basis: 'evidence',
    evidenceIds,
  })

  if (intersects(agency.excludedIndustries, companyIndustry)) {
    setDimension(dimensions, 'industry', 'blocked', agency.excludedIndustries,
      companyIndustry)
    reasons.push(reason({
      code: 'EXCLUDED_INDUSTRY',
      message: 'The organization industry is excluded by Agency DNA.',
      dimension: 'industry',
      basis: 'policy',
      contribution: -1,
    }))
    blocked = true
  } else {
    evaluateList({
      dimensions,
      reasons,
      dimension: 'industry',
      agencyValues: agency.industries,
      companyValues: companyIndustry,
      basis: 'organization_record',
      evidenceIds: [],
    })
  }

  if (intersects(agency.excludedLocations, companyRegions)) {
    setDimension(dimensions, 'region', 'blocked', agency.excludedLocations,
      companyRegions)
    reasons.push(reason({
      code: 'EXCLUDED_REGION',
      message: 'The evidenced or recorded region is excluded by Agency DNA.',
      dimension: 'region',
      basis: 'policy',
      contribution: -1,
    }))
    blocked = true
  } else {
    evaluateList({
      dimensions,
      reasons,
      dimension: 'region',
      agencyValues: agency.targetRegions,
      companyValues: companyRegions,
      basis: company.episodeRegions.length > 0 ? 'evidence' : 'organization_record',
      evidenceIds: company.episodeRegions.length > 0 ? evidenceIds : [],
    })
  }

  if (company.remoteStatus === null) {
    setDimension(dimensions, 'remote', 'unknown', [String(agency.remoteFriendly)], [])
  } else {
    const remoteMatch = !company.remoteStatus || agency.remoteFriendly
    setDimension(
      dimensions,
      'remote',
      remoteMatch ? 'match' : 'mismatch',
      [String(agency.remoteFriendly)],
      [String(company.remoteStatus)],
    )
    reasons.push(matchReason(
      'remote',
      remoteMatch,
      'organization_record',
      [],
    ))
  }

  evaluateList({
    dimensions,
    reasons,
    dimension: 'service_type',
    agencyValues: agency.serviceTypes,
    companyValues: company.serviceTypes,
    basis: 'evidence',
    evidenceIds,
  })
  evaluateList({
    dimensions,
    reasons,
    dimension: 'engagement_type',
    agencyValues: agency.preferredEngagementTypes,
    companyValues: company.engagementTypes,
    basis: 'evidence',
    evidenceIds,
  })
  evaluateList({
    dimensions,
    reasons,
    dimension: 'company_size',
    agencyValues: agency.companySizes,
    companyValues: company.companySizeBucket ? [company.companySizeBucket] : [],
    basis: 'organization_record',
    evidenceIds: [],
  })
  evaluateEconomics(dimensions, reasons, snapshot)
  evaluateCases(dimensions, reasons, snapshot)

  const undesirable = intersection(
    agency.undesirableHiringTypes,
    company.serviceTypes,
  )
  if (undesirable.length > 0) {
    setDimension(
      dimensions,
      'undesirable_hiring_type',
      'blocked',
      agency.undesirableHiringTypes,
      company.serviceTypes,
    )
    reasons.push(reason({
      code: 'UNDESIRABLE_HIRING_TYPE',
      message: 'The evidenced hiring type is explicitly undesirable for this agency.',
      dimension: 'undesirable_hiring_type',
      basis: 'policy',
      contribution: -1,
    }))
    blocked = true
  } else {
    setDimension(
      dimensions,
      'undesirable_hiring_type',
      agency.undesirableHiringTypes.length === 0
        ? 'not_configured'
        : company.serviceTypes.length === 0 ? 'unknown' : 'match',
      agency.undesirableHiringTypes,
      company.serviceTypes,
    )
  }

  if (agency.accountRestriction === 'do_not_contact' ||
      agency.accountRestriction === 'conflict') {
    setDimension(
      dimensions,
      'account_policy',
      'blocked',
      [agency.accountRestriction],
      [],
    )
    reasons.push(reason({
      code: agency.accountRestriction === 'do_not_contact'
        ? 'DO_NOT_CONTACT'
        : 'ACCOUNT_CONFLICT',
      message: agency.accountRestriction === 'do_not_contact'
        ? 'The tenant-scoped account policy forbids commercial contact.'
        : 'The tenant-scoped account has a recorded conflict.',
      dimension: 'account_policy',
      basis: 'policy',
      contribution: -1,
    }))
    blocked = true
  } else {
    setDimension(
      dimensions,
      'account_policy',
      'match',
      agency.accountRestriction ? [agency.accountRestriction] : [],
      [],
    )
  }

  return { dimensions, reasons, blocked }
}

function evaluateEconomics(
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>,
  reasons: AgencyDnaMatchReason[],
  snapshot: AgencyDnaMatchFeatureSnapshot,
): void {
  const agency = snapshot.agency
  const company = snapshot.company
  const agencyValues = [
    agency.minimumFeeMinor,
    agency.averageFeeMinor,
    agency.minimumOpportunityValueMinor,
  ].filter((value): value is number => value !== null).map(String)
  const companyValues = [
    company.estimatedFeeMinor,
    company.estimatedOpportunityValueMinor,
  ].filter((value): value is number => value !== null).map(String)
  if (agencyValues.length === 0) {
    setDimension(dimensions, 'economics', 'not_configured', [], companyValues)
    return
  }
  if (companyValues.length === 0) {
    setDimension(dimensions, 'economics', 'unknown', agencyValues, [])
    return
  }
  const feePasses = agency.minimumFeeMinor === null ||
    (company.estimatedFeeMinor !== null &&
      company.estimatedFeeMinor >= agency.minimumFeeMinor)
  const opportunityPasses = agency.minimumOpportunityValueMinor === null ||
    (company.estimatedOpportunityValueMinor !== null &&
      company.estimatedOpportunityValueMinor >= agency.minimumOpportunityValueMinor)
  const matches = feePasses && opportunityPasses
  setDimension(
    dimensions,
    'economics',
    matches ? 'match' : 'mismatch',
    agencyValues,
    companyValues,
  )
  reasons.push(matchReason('economics', matches, 'organization_record', []))
}

function evaluateCases(
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>,
  reasons: AgencyDnaMatchReason[],
  snapshot: AgencyDnaMatchFeatureSnapshot,
): void {
  const cases = snapshot.agency.caseStudies
  if (cases.length === 0) {
    setDimension(dimensions, 'case_study', 'not_configured', [], [])
    return
  }
  const company = snapshot.company
  const comparable = company.roleFamilies.length > 0 ||
    Boolean(company.organizationIndustry) || company.episodeRegions.length > 0 ||
    Boolean(company.companySizeBucket)
  if (!comparable) {
    setDimension(dimensions, 'case_study', 'unknown', ['configured'], [])
    return
  }
  const matched = cases.some((item) =>
    intersects(item.roleFamilies, company.roleFamilies) ||
    (company.organizationIndustry !== null &&
      item.industries.includes(company.organizationIndustry)) ||
    (item.region !== null && company.episodeRegions.includes(item.region)) ||
    (item.companySizeBucket !== null &&
      item.companySizeBucket === company.companySizeBucket))
  setDimension(
    dimensions,
    'case_study',
    matched ? 'match' : 'mismatch',
    ['configured'],
    ['company_context'],
  )
  reasons.push(matchReason('case_study', matched, 'agency_profile', []))
}

function evaluateList(input: {
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>
  reasons: AgencyDnaMatchReason[]
  dimension: AgencyDnaMatchDimension
  agencyValues: string[]
  companyValues: string[]
  basis: AgencyDnaMatchReasonBasis
  evidenceIds: string[]
}): void {
  if (input.agencyValues.length === 0) {
    setDimension(
      input.dimensions,
      input.dimension,
      'not_configured',
      [],
      input.companyValues,
    )
    return
  }
  if (input.companyValues.length === 0) {
    setDimension(
      input.dimensions,
      input.dimension,
      'unknown',
      input.agencyValues,
      [],
    )
    return
  }
  const matches = intersects(input.agencyValues, input.companyValues)
  setDimension(
    input.dimensions,
    input.dimension,
    matches ? 'match' : 'mismatch',
    input.agencyValues,
    input.companyValues,
  )
  input.reasons.push(matchReason(
    input.dimension,
    matches,
    input.basis,
    input.evidenceIds,
  ))
}

function score(
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>,
): { fitScore: number; coverage: number } {
  let evaluatedWeight = 0
  let matchedWeight = 0
  for (const dimension of AGENCY_DNA_MATCH_DIMENSIONS) {
    const result = dimensions[dimension]
    if (result.outcome === 'match' || result.outcome === 'mismatch') {
      evaluatedWeight += result.weight
      if (result.outcome === 'match') matchedWeight += result.weight
    }
  }
  return {
    fitScore: evaluatedWeight === 0 ? 0 : rounded(matchedWeight / evaluatedWeight),
    coverage: rounded(evaluatedWeight),
  }
}

function matchLevel(input: {
  blocked: boolean
  evidenceSufficient: boolean
  fitScore: number
  coverage: number
  propensityLevel: ExternalAgencyPropensityLevel
}): AgencyDnaMatchLevel {
  if (input.blocked) return 'blocked'
  if (!input.evidenceSufficient || input.coverage < 0.2) {
    return 'insufficient_evidence'
  }
  if (
    input.propensityLevel === 'high' &&
    input.fitScore >= 0.75 &&
    input.coverage >= 0.45
  ) return 'strong'
  if (input.fitScore >= 0.58) return 'supported'
  return 'weak'
}

function modeResult(input: {
  mode: AgencyDnaMatchMode
  restriction: AgencyDnaRestrictionType | null
  blocked: boolean
  evidenceSufficient: boolean
  fitScore: number
  coverage: number
  policy: AgencyDnaMatchSelectionPolicy
}): AgencyDnaMatchModeResult {
  const applicable = applicableMode(input.restriction) === input.mode
  let status: AgencyDnaMatchModeResult['status']
  if (input.blocked) status = 'blocked'
  else if (!applicable) status = 'not_applicable'
  else if (!input.evidenceSufficient) status = 'insufficient_evidence'
  else if (
    input.fitScore >= input.policy.minimumFitScore &&
    input.coverage >= input.policy.minimumCoverage
  ) status = 'qualifies'
  else status = 'below_threshold'
  return {
    mode: input.mode,
    applicable,
    status,
    fitScore: input.fitScore,
    coverage: input.coverage,
    minimumFitScore: input.policy.minimumFitScore,
    minimumCoverage: input.policy.minimumCoverage,
  }
}

function applicableMode(
  restriction: AgencyDnaRestrictionType | null,
): AgencyDnaMatchMode | null {
  if (restriction === 'existing_client') return 'grow'
  if (restriction === 'former_client') return 'reactivate'
  if (restriction === 'do_not_contact' || restriction === 'conflict') return null
  return 'find'
}

function propensityClearsEvidenceFloor(
  snapshot: AgencyDnaMatchFeatureSnapshot,
): boolean {
  return snapshot.propensity.episodeStage !== 'expired' &&
    snapshot.propensity.evidenceSourceFamilyCount > 0 &&
    (snapshot.propensity.level === 'high' ||
      snapshot.propensity.level === 'medium')
}

function emptyDimensions(): Record<
  AgencyDnaMatchDimension,
  AgencyDnaMatchDimensionResult
> {
  return Object.fromEntries(AGENCY_DNA_MATCH_DIMENSIONS.map((dimension) => [
    dimension,
    {
      outcome: 'not_configured',
      contribution: 0,
      weight: WEIGHTS[dimension],
      agencyValues: [],
      companyValues: [],
    },
  ])) as unknown as Record<
    AgencyDnaMatchDimension,
    AgencyDnaMatchDimensionResult
  >
}

function setDimension(
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>,
  dimension: AgencyDnaMatchDimension,
  outcome: AgencyDnaMatchDimensionOutcome,
  agencyValues: string[],
  companyValues: string[],
): void {
  const weight = WEIGHTS[dimension]
  dimensions[dimension] = {
    outcome,
    contribution: outcome === 'match' ? weight
      : outcome === 'mismatch' ? -weight : outcome === 'blocked' ? -1 : 0,
    weight,
    agencyValues: strings(agencyValues),
    companyValues: strings(companyValues),
  }
}

function matchReason(
  dimension: AgencyDnaMatchDimension,
  matches: boolean,
  basis: AgencyDnaMatchReasonBasis,
  evidenceIds: string[],
): AgencyDnaMatchReason {
  return reason({
    code: `${dimension.toUpperCase()}_${matches ? 'MATCH' : 'MISMATCH'}`,
    message: matches
      ? `${dimension} matches the Agency DNA scope.`
      : `${dimension} does not match the Agency DNA scope.`,
    dimension,
    basis,
    contribution: matches ? WEIGHTS[dimension] : -WEIGHTS[dimension],
    evidenceIds,
  })
}

function reason(input: Omit<AgencyDnaMatchReason, 'evidenceIds'> & {
  evidenceIds?: string[]
}): AgencyDnaMatchReason {
  return { ...input, evidenceIds: input.evidenceIds ?? [] }
}

function specializationTerms(value: string | null): string[] {
  if (!value) return []
  return strings(value.split(/[;,/|]+/u))
}

function normalizeCaseStudies(values: readonly AgencyDnaCaseStudy[]): AgencyDnaCaseStudy[] {
  return values.map((item) => ({
    roleFamilies: strings(item.roleFamilies),
    industries: strings(item.industries),
    companySizeBucket: text(item.companySizeBucket),
    region: text(item.region),
    hiringModes: allowedStrings(
      item.hiringModes,
      AGENCY_DNA_CASE_HIRING_MODES,
      'case-study hiring mode',
    ) as AgencyDnaCaseHiringMode[],
    measurableResult: text(item.measurableResult),
    publicSafeDescription: text(item.publicSafeDescription),
  })).sort((left, right) => compareText(
    JSON.stringify(left),
    JSON.stringify(right),
  ))
}

function serviceTypes(values: readonly string[], label: string): AgencyDnaServiceType[] {
  return allowedStrings(values, AGENCY_DNA_SERVICE_TYPES, label) as AgencyDnaServiceType[]
}

function allowedStrings<T extends string>(
  values: readonly string[],
  allowed: readonly T[],
  label: string,
): T[] {
  const normalized = strings(values)
  const allowedSet = new Set<string>(allowed)
  if (normalized.some((value) => !allowedSet.has(value))) {
    throw new TypeError(`Unsupported ${label}.`)
  }
  return normalized as T[]
}

function strings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase())
    .filter(Boolean))].sort(compareText)
}

function numberRecord(value: Readonly<Record<string, number>>): Record<string, number> {
  const normalized = new Map<string, number>()
  for (const [key, count] of Object.entries(value)) {
    const normalizedKey = key.trim().toLowerCase()
    if (!normalizedKey || !Number.isFinite(count) || count < 0) {
      throw new TypeError('Seniority distribution contains an invalid count.')
    }
    normalized.set(normalizedKey, (normalized.get(normalizedKey) ?? 0) + count)
  }
  return Object.fromEntries([...normalized.entries()].sort(([left], [right]) =>
    compareText(left, right)))
}

function text(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized || null
}

function money(value: number | null, label: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`)
  }
  return value
}

function jsonObject(
  value: Readonly<Record<string, unknown>>,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value
}

function ids(values: readonly string[], label: string): string[] {
  return [...new Set(values.map((value) => positiveId(value, label)))]
    .sort(compareIds)
}

function positiveId(value: string, label: string): string {
  const normalized = String(value)
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new TypeError(`Invalid ${label} id.`)
  }
  return BigInt(normalized).toString()
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new TypeError(`${label} must be a positive integer.`)
  }
  return value
}

function hash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`Invalid ${label}.`)
  return value
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right)
  return left.filter((value) => rightSet.has(value))
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  return intersection(left, right).length > 0
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function compareIds(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right)
  return difference < 0 ? -1 : difference > 0 ? 1 : 0
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
