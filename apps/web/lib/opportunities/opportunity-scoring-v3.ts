import {
  AGENCY_DNA_CAPACITIES,
  AGENCY_DNA_RESTRICTION_TYPES,
  type AgencyDnaCapacity,
  type AgencyDnaRestrictionType,
} from './agency-dna'
import { hashCanonicalJson } from './canonical-hash'
import {
  EXTERNAL_AGENCY_PROPENSITY_LEVELS,
  type ExternalAgencyPropensityLevel,
} from './external-agency-propensity'
import {
  signalEpisodeStageAt,
  type SignalEpisodeStage,
} from './signal-episode'

export const OPPORTUNITY_SCORING_VERSION_V3 = 'opportunity-v3' as const
export const OPPORTUNITY_FEATURE_SCHEMA_V3 =
  'opportunity-quality-features-v3' as const
export const OPPORTUNITY_GATE_VERSION_V3 =
  'opportunity-quality-gates-v3' as const

export const OPPORTUNITY_V3_STATUSES = [
  'qualified_actionable',
  'qualified_needs_enrichment',
  'review',
  'blocked',
  'expired',
  'dismissed',
] as const

export const OPPORTUNITY_V3_MODES = [
  'find',
  'grow',
  'reactivate',
  'blocked',
] as const

export const OPPORTUNITY_V3_HARD_GATE_CODES = [
  'ORGANIZATION_IDENTITY_UNVERIFIED',
  'ADMISSIBLE_EVIDENCE_MISSING',
  'COMPANY_STATE_CHANGE_UNCONFIRMED',
  'EPISODE_NOT_ACTIVE',
  'PROFILE_EXCLUSION',
  'ACCOUNT_RESTRICTION_BLOCKED',
  'AGENCY_FIT_BELOW_THRESHOLD',
  'EXTERNAL_AGENCY_PROPENSITY_BELOW_THRESHOLD',
  'ECONOMICS_CONTRADICTS_AGENCY',
] as const

export const OPPORTUNITY_V3_SAFE_CONTACT_CATEGORIES = [
  'hr-email',
  'careers-email',
  'generic-email',
  'contact-form',
  'career-page',
] as const

export type OpportunityV3Status = typeof OPPORTUNITY_V3_STATUSES[number]
export type OpportunityV3Mode = typeof OPPORTUNITY_V3_MODES[number]
export type OpportunityV3HardGateCode =
  typeof OPPORTUNITY_V3_HARD_GATE_CODES[number]
export type OpportunityV3SafeContactCategory =
  typeof OPPORTUNITY_V3_SAFE_CONTACT_CATEGORIES[number]
export type OpportunityV3RolloutMode = 'shadow' | 'canary'
export type OpportunityV3ContactPolicy =
  | 'corporate_only'
  | 'no_personal'
  | 'unrestricted'
export type OpportunityV3EconomicsOutcome =
  | 'match'
  | 'mismatch'
  | 'unknown'
  | 'not_configured'

export type OpportunityV3ReasonBasis =
  | 'evidence'
  | 'agency_profile'
  | 'organization_record'
  | 'policy'
  | 'enrichment'

export type OpportunityV3Reason = {
  code: string
  message: string
  basis: OpportunityV3ReasonBasis
  contribution: number
  evidenceIds: string[]
}

export type OpportunityV3Component = {
  score: number
  reasons: OpportunityV3Reason[]
}

export type OpportunityV3HardGate = {
  code: OpportunityV3HardGateCode
  passed: boolean
  message: string
  basis: OpportunityV3ReasonBasis
  evidenceIds: string[]
}

export type OpportunityScoringV3Input = {
  organizationId: string
  workspaceId: string
  ownerId: string
  clientProfileId: string
  agencyDnaMatchSnapshotId: string
  agencyDnaMatchGeneration: number
  agencyDnaMatchIdentity: string
  agencyDnaMatchInputHash: string
  propensitySnapshotId: string
  propensityGeneration: number
  commercialThesisId: string
  commercialThesisGeneration: number
  signalEpisodeId: string
  signalEpisodeGeneration: number
  companyStateSnapshotId: string
  agencyDnaVersion: number
  agencyDnaSnapshotHash: string
  evidenceHash: string
  evidenceIds: string[]
  evidenceSourceFamilies: string[]
  directEvidenceCount: number
  corroborationEvidenceCount: number
  organizationIdentityVerified: boolean
  stateChangeConfirmed: boolean
  companyStateConfidence: number
  episodeStage: SignalEpisodeStage
  episodeIntensity: number
  episodeLastSeenAt: string
  episodeValidUntil: string
  profileExcluded: boolean
  accountRestriction: AgencyDnaRestrictionType | null
  opportunityMode: OpportunityV3Mode
  agencyFitScore: number
  agencyFitCoverage: number
  minimumAgencyFitScore: number
  minimumAgencyFitCoverage: number
  propensityScore: number
  propensityLevel: ExternalAgencyPropensityLevel
  economicsOutcome: OpportunityV3EconomicsOutcome
  currentCapacity: AgencyDnaCapacity
  corporateContactPathCategories: OpportunityV3SafeContactCategory[]
  decisionMakerFunctions: string[]
  contactPolicy: OpportunityV3ContactPolicy
  enrichmentCompleteness: number
  rolloutMode: OpportunityV3RolloutMode
  fallbackScoringVersion: string
  now?: Date
}

export type OpportunityScoringV3FeatureSnapshot = {
  source: {
    agencyDnaMatchSnapshotId: string
    agencyDnaMatchGeneration: number
    agencyDnaMatchIdentity: string
    agencyDnaMatchInputHash: string
    propensitySnapshotId: string
    propensityGeneration: number
    commercialThesisId: string
    commercialThesisGeneration: number
    signalEpisodeId: string
    signalEpisodeGeneration: number
    companyStateSnapshotId: string
    agencyDnaVersion: number
    agencyDnaSnapshotHash: string
  }
  quality: {
    organizationIdentityVerified: boolean
    stateChangeConfirmed: boolean
    companyStateConfidence: number
    episodeStage: SignalEpisodeStage
    episodeIntensity: number
    episodeLastSeenAt: string
    episodeValidUntil: string
    profileExcluded: boolean
    accountRestriction: AgencyDnaRestrictionType | null
    agencyFitScore: number
    agencyFitCoverage: number
    minimumAgencyFitScore: number
    minimumAgencyFitCoverage: number
    propensityScore: number
    propensityLevel: ExternalAgencyPropensityLevel
    economicsOutcome: OpportunityV3EconomicsOutcome
    currentCapacity: AgencyDnaCapacity
    minimumQualityScore: number
  }
  actionability: {
    corporateContactPathCategories: OpportunityV3SafeContactCategory[]
    decisionMakerFunctions: string[]
    contactPolicy: OpportunityV3ContactPolicy
    enrichmentCompleteness: number
  }
  rollout: {
    mode: OpportunityV3RolloutMode
    fallbackScoringVersion: string
  }
}

export type OpportunityScoringV3EvidenceSnapshot = {
  evidenceIds: string[]
  evidenceSourceFamilies: string[]
  directEvidenceCount: number
  corroborationEvidenceCount: number
}

export type OpportunityScoringV3Result = {
  organizationId: string
  workspaceId: string
  ownerId: string
  clientProfileId: string
  candidateIdentity: string
  opportunityMode: OpportunityV3Mode
  qualityComponents: {
    agencyFit: OpportunityV3Component
    externalAgencyPropensity: OpportunityV3Component
    timing: OpportunityV3Component
    economics: OpportunityV3Component
    evidenceConfidence: OpportunityV3Component
  }
  actionabilityComponents: {
    corporateContactPath: OpportunityV3Component
    decisionMakerFunction: OpportunityV3Component
    accountAccess: OpportunityV3Component
    contactPolicy: OpportunityV3Component
    enrichmentCompleteness: OpportunityV3Component
  }
  hardGates: OpportunityV3HardGate[]
  reasons: OpportunityV3Reason[]
  rawQualityScore: number
  qualityScore: number
  actionabilityScore: number
  rankingScore: number
  status: OpportunityV3Status
  legacyStatusProjection: 'new' | 'review' | 'dismissed'
  featureSnapshot: OpportunityScoringV3FeatureSnapshot
  evidenceSnapshot: OpportunityScoringV3EvidenceSnapshot
  evidenceHash: string
  inputHash: string
  validUntil: string
  scoreVersion: typeof OPPORTUNITY_SCORING_VERSION_V3
  featureSchemaVersion: typeof OPPORTUNITY_FEATURE_SCHEMA_V3
  gateVersion: typeof OPPORTUNITY_GATE_VERSION_V3
  rolloutMode: OpportunityV3RolloutMode
  fallbackScoringVersion: string
  modelType: 'heuristic'
  calibrationStatus: 'uncalibrated'
}

const MINIMUM_PROPENSITY_SCORE = 0.55
const QUALITY_THRESHOLDS: Record<AgencyDnaCapacity, number> = {
  low: 0.75,
  normal: 0.62,
  high: 0.62,
}

export function buildOpportunityScoringV3(
  rawInput: OpportunityScoringV3Input,
): OpportunityScoringV3Result {
  const input = normalizeInput(rawInput)
  const evidenceSnapshot: OpportunityScoringV3EvidenceSnapshot = {
    evidenceIds: input.evidenceIds,
    evidenceSourceFamilies: input.evidenceSourceFamilies,
    directEvidenceCount: input.directEvidenceCount,
    corroborationEvidenceCount: input.corroborationEvidenceCount,
  }
  const featureSnapshot = buildFeatureSnapshot(input)
  const hardGates = evaluateHardGates(input)
  const qualityComponents = buildQualityComponents(input)
  const actionabilityComponents = buildActionabilityComponents(input)
  const rawQualityScore = geometricMean(
    Object.values(qualityComponents).map((item) => item.score),
  )
  const qualityScore = hardGates.every((item) => item.passed)
    ? rawQualityScore
    : 0
  const actionabilityScore = isPolicyBlocked(input.accountRestriction)
    ? 0
    : geometricMean(
      Object.values(actionabilityComponents).map((item) => item.score),
    )
  const status = resolveStatus({
    input,
    hardGates,
    qualityScore,
    actionabilityScore,
  })
  const candidateIdentity = hashCanonicalJson({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    clientProfileId: input.clientProfileId,
    agencyDnaMatchIdentity: input.agencyDnaMatchIdentity,
    opportunityMode: input.opportunityMode,
    scoreVersion: OPPORTUNITY_SCORING_VERSION_V3,
  })
  const inputHash = hashCanonicalJson({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    clientProfileId: input.clientProfileId,
    featureSnapshot,
    evidenceSnapshot,
    evidenceHash: input.evidenceHash,
    scoreVersion: OPPORTUNITY_SCORING_VERSION_V3,
    featureSchemaVersion: OPPORTUNITY_FEATURE_SCHEMA_V3,
    gateVersion: OPPORTUNITY_GATE_VERSION_V3,
  })
  const reasons = uniqueReasons([
    ...hardGates
      .filter((item) => !item.passed)
      .map((item) => gateReason(item, input.accountRestriction)),
    ...Object.values(qualityComponents).flatMap((item) => item.reasons),
    ...Object.values(actionabilityComponents).flatMap((item) => item.reasons),
  ])

  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    clientProfileId: input.clientProfileId,
    candidateIdentity,
    opportunityMode: input.opportunityMode,
    qualityComponents,
    actionabilityComponents,
    hardGates,
    reasons,
    rawQualityScore,
    qualityScore,
    actionabilityScore,
    rankingScore: qualityScore,
    status,
    legacyStatusProjection: legacyStatus(status),
    featureSnapshot,
    evidenceSnapshot,
    evidenceHash: input.evidenceHash,
    inputHash,
    validUntil: input.episodeValidUntil,
    scoreVersion: OPPORTUNITY_SCORING_VERSION_V3,
    featureSchemaVersion: OPPORTUNITY_FEATURE_SCHEMA_V3,
    gateVersion: OPPORTUNITY_GATE_VERSION_V3,
    rolloutMode: input.rolloutMode,
    fallbackScoringVersion: input.fallbackScoringVersion,
    modelType: 'heuristic',
    calibrationStatus: 'uncalibrated',
  }
}

function normalizeInput(
  input: OpportunityScoringV3Input,
): OpportunityScoringV3Input {
  const now = validDate(input.now ?? new Date(), 'now')
  const episodeLastSeenAt = timestamp(input.episodeLastSeenAt, 'episode last seen')
  const episodeValidUntil = timestamp(input.episodeValidUntil, 'episode valid until')
  if (Date.parse(episodeLastSeenAt) > now.getTime()) {
    throw new TypeError('Episode last seen cannot be in the future.')
  }
  if (Date.parse(episodeValidUntil) <= Date.parse(episodeLastSeenAt)) {
    throw new TypeError('Episode valid until must follow last seen.')
  }
  const currentStage = signalEpisodeStageAt({
    lastSeenAt: episodeLastSeenAt,
    validUntil: episodeValidUntil,
  }, now)
  if (currentStage !== input.episodeStage) {
    throw new TypeError('Episode stage is stale for the scoring time.')
  }
  if (!EXTERNAL_AGENCY_PROPENSITY_LEVELS.includes(input.propensityLevel)) {
    throw new TypeError('External Agency Propensity level is invalid.')
  }
  if (!AGENCY_DNA_CAPACITIES.includes(input.currentCapacity)) {
    throw new TypeError('Agency DNA capacity is invalid.')
  }
  if (input.accountRestriction !== null &&
      !AGENCY_DNA_RESTRICTION_TYPES.includes(input.accountRestriction)) {
    throw new TypeError('Agency account restriction is invalid.')
  }
  if (!OPPORTUNITY_V3_MODES.includes(input.opportunityMode)) {
    throw new TypeError('Opportunity mode is invalid.')
  }
  assertMode(input.opportunityMode, input.accountRestriction)
  if (!['match', 'mismatch', 'unknown', 'not_configured']
    .includes(input.economicsOutcome)) {
    throw new TypeError('Economics outcome is invalid.')
  }
  if (!['corporate_only', 'no_personal', 'unrestricted']
    .includes(input.contactPolicy)) {
    throw new TypeError('Contact policy is invalid.')
  }
  if (!['shadow', 'canary'].includes(input.rolloutMode)) {
    throw new TypeError('Rollout mode is invalid.')
  }
  const fallbackScoringVersion = input.fallbackScoringVersion.trim()
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(fallbackScoringVersion)) {
    throw new TypeError('Fallback scoring version is invalid.')
  }

  return {
    ...input,
    organizationId: positiveId(input.organizationId, 'organization'),
    workspaceId: positiveId(input.workspaceId, 'workspace'),
    ownerId: positiveId(input.ownerId, 'owner'),
    clientProfileId: positiveId(input.clientProfileId, 'client profile'),
    agencyDnaMatchSnapshotId: positiveId(
      input.agencyDnaMatchSnapshotId,
      'Agency DNA Match snapshot',
    ),
    agencyDnaMatchGeneration: generation(
      input.agencyDnaMatchGeneration,
      'Agency DNA Match generation',
    ),
    agencyDnaMatchIdentity: hash(
      input.agencyDnaMatchIdentity,
      'Agency DNA Match identity',
    ),
    agencyDnaMatchInputHash: hash(
      input.agencyDnaMatchInputHash,
      'Agency DNA Match input',
    ),
    propensitySnapshotId: positiveId(
      input.propensitySnapshotId,
      'propensity snapshot',
    ),
    propensityGeneration: generation(
      input.propensityGeneration,
      'propensity generation',
    ),
    commercialThesisId: positiveId(input.commercialThesisId, 'thesis'),
    commercialThesisGeneration: generation(
      input.commercialThesisGeneration,
      'thesis generation',
    ),
    signalEpisodeId: positiveId(input.signalEpisodeId, 'signal episode'),
    signalEpisodeGeneration: generation(
      input.signalEpisodeGeneration,
      'signal episode generation',
    ),
    companyStateSnapshotId: positiveId(
      input.companyStateSnapshotId,
      'company state snapshot',
    ),
    agencyDnaVersion: generation(input.agencyDnaVersion, 'Agency DNA version'),
    agencyDnaSnapshotHash: hash(input.agencyDnaSnapshotHash, 'Agency DNA snapshot'),
    evidenceHash: hash(input.evidenceHash, 'evidence'),
    evidenceIds: positiveIds(input.evidenceIds, 'evidence'),
    evidenceSourceFamilies: strings(input.evidenceSourceFamilies),
    directEvidenceCount: count(input.directEvidenceCount, 'direct evidence'),
    corroborationEvidenceCount: count(
      input.corroborationEvidenceCount,
      'corroboration evidence',
    ),
    companyStateConfidence: ratio(
      input.companyStateConfidence,
      'company state confidence',
    ),
    episodeIntensity: ratio(input.episodeIntensity, 'episode intensity'),
    episodeLastSeenAt,
    episodeValidUntil,
    agencyFitScore: ratio(input.agencyFitScore, 'Agency Fit score'),
    agencyFitCoverage: ratio(input.agencyFitCoverage, 'Agency Fit coverage'),
    minimumAgencyFitScore: ratio(
      input.minimumAgencyFitScore,
      'minimum Agency Fit score',
    ),
    minimumAgencyFitCoverage: ratio(
      input.minimumAgencyFitCoverage,
      'minimum Agency Fit coverage',
    ),
    propensityScore: ratio(input.propensityScore, 'propensity score'),
    corporateContactPathCategories: safeContactCategories(
      input.corporateContactPathCategories,
    ),
    decisionMakerFunctions: strings(input.decisionMakerFunctions),
    enrichmentCompleteness: ratio(
      input.enrichmentCompleteness,
      'enrichment completeness',
    ),
    fallbackScoringVersion,
    now,
  }
}

function buildFeatureSnapshot(
  input: OpportunityScoringV3Input,
): OpportunityScoringV3FeatureSnapshot {
  return {
    source: {
      agencyDnaMatchSnapshotId: input.agencyDnaMatchSnapshotId,
      agencyDnaMatchGeneration: input.agencyDnaMatchGeneration,
      agencyDnaMatchIdentity: input.agencyDnaMatchIdentity,
      agencyDnaMatchInputHash: input.agencyDnaMatchInputHash,
      propensitySnapshotId: input.propensitySnapshotId,
      propensityGeneration: input.propensityGeneration,
      commercialThesisId: input.commercialThesisId,
      commercialThesisGeneration: input.commercialThesisGeneration,
      signalEpisodeId: input.signalEpisodeId,
      signalEpisodeGeneration: input.signalEpisodeGeneration,
      companyStateSnapshotId: input.companyStateSnapshotId,
      agencyDnaVersion: input.agencyDnaVersion,
      agencyDnaSnapshotHash: input.agencyDnaSnapshotHash,
    },
    quality: {
      organizationIdentityVerified: input.organizationIdentityVerified,
      stateChangeConfirmed: input.stateChangeConfirmed,
      companyStateConfidence: input.companyStateConfidence,
      episodeStage: input.episodeStage,
      episodeIntensity: input.episodeIntensity,
      episodeLastSeenAt: input.episodeLastSeenAt,
      episodeValidUntil: input.episodeValidUntil,
      profileExcluded: input.profileExcluded,
      accountRestriction: input.accountRestriction,
      agencyFitScore: input.agencyFitScore,
      agencyFitCoverage: input.agencyFitCoverage,
      minimumAgencyFitScore: input.minimumAgencyFitScore,
      minimumAgencyFitCoverage: input.minimumAgencyFitCoverage,
      propensityScore: input.propensityScore,
      propensityLevel: input.propensityLevel,
      economicsOutcome: input.economicsOutcome,
      currentCapacity: input.currentCapacity,
      minimumQualityScore: QUALITY_THRESHOLDS[input.currentCapacity],
    },
    actionability: {
      corporateContactPathCategories: input.corporateContactPathCategories,
      decisionMakerFunctions: input.decisionMakerFunctions,
      contactPolicy: input.contactPolicy,
      enrichmentCompleteness: input.enrichmentCompleteness,
    },
    rollout: {
      mode: input.rolloutMode,
      fallbackScoringVersion: input.fallbackScoringVersion,
    },
  }
}

function evaluateHardGates(
  input: OpportunityScoringV3Input,
): OpportunityV3HardGate[] {
  const evidenceIds = input.evidenceIds
  const admissibleEvidence = evidenceIds.length > 0 &&
    input.directEvidenceCount + input.corroborationEvidenceCount > 0
  const agencyFitPasses = input.agencyFitScore >= input.minimumAgencyFitScore &&
    input.agencyFitCoverage >= input.minimumAgencyFitCoverage
  const propensityPasses = input.propensityScore >= MINIMUM_PROPENSITY_SCORE &&
    (input.propensityLevel === 'high' || input.propensityLevel === 'medium')
  return [
    gate(
      'ORGANIZATION_IDENTITY_UNVERIFIED',
      input.organizationIdentityVerified,
      'A stable corporate identity is required.',
      'organization_record',
      [],
    ),
    gate(
      'ADMISSIBLE_EVIDENCE_MISSING',
      admissibleEvidence,
      'Direct or corroborating evidence is required.',
      'evidence',
      evidenceIds,
    ),
    gate(
      'COMPANY_STATE_CHANGE_UNCONFIRMED',
      input.stateChangeConfirmed,
      'An evidenced company state change is required.',
      'evidence',
      evidenceIds,
    ),
    gate(
      'EPISODE_NOT_ACTIVE',
      input.episodeStage === 'active',
      'The Signal Episode is not active.',
      'evidence',
      evidenceIds,
    ),
    gate(
      'PROFILE_EXCLUSION',
      !input.profileExcluded,
      'Agency DNA explicitly excludes the company situation.',
      'policy',
      [],
    ),
    gate(
      'ACCOUNT_RESTRICTION_BLOCKED',
      !isPolicyBlocked(input.accountRestriction),
      'A tenant-scoped do-not-contact or conflict policy blocks action.',
      'policy',
      [],
    ),
    gate(
      'AGENCY_FIT_BELOW_THRESHOLD',
      agencyFitPasses,
      'Agency DNA Fit or coverage is below its capacity policy threshold.',
      'agency_profile',
      [],
    ),
    gate(
      'EXTERNAL_AGENCY_PROPENSITY_BELOW_THRESHOLD',
      propensityPasses,
      'External Agency Propensity is below the shared evidence floor.',
      'evidence',
      evidenceIds,
    ),
    gate(
      'ECONOMICS_CONTRADICTS_AGENCY',
      input.economicsOutcome !== 'mismatch',
      'Evidenced economics contradict Agency DNA constraints.',
      'agency_profile',
      [],
    ),
  ]
}

function buildQualityComponents(
  input: OpportunityScoringV3Input,
): OpportunityScoringV3Result['qualityComponents'] {
  const evidenceIds = input.evidenceIds
  const evidenceIndependence = clamp01(input.evidenceSourceFamilies.length / 2)
  const evidenceConfidence = geometricMean([
    input.companyStateConfidence,
    evidenceIndependence,
  ])
  const timing = input.episodeStage === 'active'
    ? input.episodeIntensity
    : input.episodeStage === 'cooling' ? input.episodeIntensity * 0.5 : 0
  const economics = input.economicsOutcome === 'match' ? 1
    : input.economicsOutcome === 'mismatch' ? 0
      : input.economicsOutcome === 'unknown' ? 0.65 : 0.75
  return {
    agencyFit: component(input.agencyFitScore, reason(
      'AGENCY_FIT_SCORE',
      'Quality uses the evidence-bound Agency DNA Fit score.',
      'agency_profile',
      input.agencyFitScore,
    )),
    externalAgencyPropensity: component(input.propensityScore, reason(
      'EXTERNAL_AGENCY_PROPENSITY_SCORE',
      'Quality uses the External Agency Propensity score.',
      'evidence',
      input.propensityScore,
      evidenceIds,
    )),
    timing: component(timing, reason(
      'ACTIVE_EPISODE_TIMING',
      'Timing is bounded by current episode stage and intensity.',
      'evidence',
      timing,
      evidenceIds,
    )),
    economics: component(economics, reason(
      input.economicsOutcome === 'unknown'
        ? 'ECONOMICS_UNKNOWN'
        : input.economicsOutcome === 'not_configured'
          ? 'ECONOMICS_NOT_CONFIGURED'
          : input.economicsOutcome === 'match'
            ? 'ECONOMICS_MATCH'
            : 'ECONOMICS_MISMATCH',
      'Economics records explicit match, contradiction, or uncertainty.',
      'agency_profile',
      economics,
    )),
    evidenceConfidence: component(evidenceConfidence, reason(
      'EVIDENCE_CONFIDENCE',
      'Evidence confidence combines state confidence and source independence.',
      'evidence',
      evidenceConfidence,
      evidenceIds,
    )),
  }
}

function buildActionabilityComponents(
  input: OpportunityScoringV3Input,
): OpportunityScoringV3Result['actionabilityComponents'] {
  const hasContact = input.corporateContactPathCategories.length > 0
  const hasFunction = input.decisionMakerFunctions.length > 0
  const accountAccess = isPolicyBlocked(input.accountRestriction) ? 0 : 1
  const policyCompatible = hasContact ? 1 : 0
  return {
    corporateContactPath: component(hasContact ? 1 : 0, reason(
      hasContact ? 'CORPORATE_CONTACT_PATH_FOUND' : 'CONTACT_PATH_ENRICHMENT_NEEDED',
      hasContact
        ? 'A policy-safe corporate contact path category is available.'
        : 'No policy-safe corporate contact path is available yet.',
      'enrichment',
      hasContact ? 1 : 0,
    )),
    decisionMakerFunction: component(hasFunction ? 1 : 0, reason(
      hasFunction
        ? 'DECISION_MAKER_FUNCTION_IDENTIFIED'
        : 'DECISION_MAKER_FUNCTION_NEEDED',
      hasFunction
        ? 'A target decision-maker function is identified.'
        : 'A target decision-maker function still requires enrichment.',
      'enrichment',
      hasFunction ? 1 : 0,
    )),
    accountAccess: component(accountAccess, reason(
      accountAccess ? 'ACCOUNT_ACCESS_ALLOWED' : 'ACCOUNT_ACCESS_BLOCKED',
      accountAccess
        ? 'Tenant account policy allows evaluation.'
        : 'Tenant account policy blocks commercial action.',
      'policy',
      accountAccess,
    )),
    contactPolicy: component(policyCompatible, reason(
      policyCompatible ? 'CONTACT_POLICY_COMPATIBLE' : 'CONTACT_POLICY_PENDING',
      policyCompatible
        ? 'Available corporate route is compatible with contact policy.'
        : 'Contact policy cannot be satisfied until a corporate route exists.',
      'policy',
      policyCompatible,
    )),
    enrichmentCompleteness: component(
      input.enrichmentCompleteness,
      reason(
        'ENRICHMENT_COMPLETENESS',
        'Actionability records enrichment completeness separately from quality.',
        'enrichment',
        input.enrichmentCompleteness,
      ),
    ),
  }
}

function resolveStatus(input: {
  input: OpportunityScoringV3Input
  hardGates: OpportunityV3HardGate[]
  qualityScore: number
  actionabilityScore: number
}): OpportunityV3Status {
  if (isPolicyBlocked(input.input.accountRestriction) ||
      input.input.profileExcluded) return 'blocked'
  if (input.input.episodeStage === 'expired') return 'expired'
  if (!input.hardGates.every((item) => item.passed) ||
      input.qualityScore < QUALITY_THRESHOLDS[input.input.currentCapacity]) {
    return 'review'
  }
  const actionable = input.input.corporateContactPathCategories.length > 0 &&
    input.input.decisionMakerFunctions.length > 0 &&
    input.actionabilityScore >= 0.6
  return actionable ? 'qualified_actionable' : 'qualified_needs_enrichment'
}

function legacyStatus(
  status: OpportunityV3Status,
): 'new' | 'review' | 'dismissed' {
  if (status === 'qualified_actionable') return 'new'
  if (status === 'qualified_needs_enrichment' || status === 'review') {
    return 'review'
  }
  return 'dismissed'
}

function gate(
  code: OpportunityV3HardGateCode,
  passed: boolean,
  message: string,
  basis: OpportunityV3ReasonBasis,
  evidenceIds: string[],
): OpportunityV3HardGate {
  return { code, passed, message, basis, evidenceIds: [...evidenceIds] }
}

function gateReason(
  gateResult: OpportunityV3HardGate,
  accountRestriction: AgencyDnaRestrictionType | null,
): OpportunityV3Reason {
  const policyCode = gateResult.code === 'ACCOUNT_RESTRICTION_BLOCKED'
    ? accountRestriction === 'do_not_contact'
      ? 'DO_NOT_CONTACT'
      : accountRestriction === 'conflict'
        ? 'ACCOUNT_CONFLICT'
        : 'ACCOUNT_POLICY_BLOCKED'
    : gateResult.code
  return reason(
    policyCode,
    gateResult.message,
    gateResult.basis,
    -1,
    gateResult.evidenceIds,
  )
}

function component(
  score: number,
  componentReason: OpportunityV3Reason,
): OpportunityV3Component {
  return { score: round(clamp01(score)), reasons: [componentReason] }
}

function reason(
  code: string,
  message: string,
  basis: OpportunityV3ReasonBasis,
  contribution: number,
  evidenceIds: string[] = [],
): OpportunityV3Reason {
  return {
    code,
    message,
    basis,
    contribution: round(contribution),
    evidenceIds: [...evidenceIds],
  }
}

function uniqueReasons(reasons: OpportunityV3Reason[]): OpportunityV3Reason[] {
  const seen = new Set<string>()
  return reasons.filter((item) => {
    const key = `${item.code}:${item.basis}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isPolicyBlocked(
  restriction: AgencyDnaRestrictionType | null,
): boolean {
  return restriction === 'do_not_contact' || restriction === 'conflict'
}

function assertMode(
  mode: OpportunityV3Mode,
  restriction: AgencyDnaRestrictionType | null,
): void {
  const expected = restriction === 'existing_client' ? 'grow'
    : restriction === 'former_client' ? 'reactivate'
      : isPolicyBlocked(restriction) ? 'blocked' : 'find'
  if (mode !== expected) {
    throw new TypeError('Opportunity mode does not match account restriction.')
  }
}

function geometricMean(values: readonly number[]): number {
  if (values.length === 0) return 0
  if (values.some((value) => value <= 0)) return 0
  const logarithmicMean = values.reduce((sum, value) =>
    sum + Math.log(clamp01(value)), 0) / values.length
  return round(Math.exp(logarithmicMean))
}

function safeContactCategories(
  values: readonly string[],
): OpportunityV3SafeContactCategory[] {
  const normalized = strings(values)
  if (normalized.some((value) =>
    !OPPORTUNITY_V3_SAFE_CONTACT_CATEGORIES.includes(
      value as OpportunityV3SafeContactCategory,
    ))) {
    throw new TypeError('Unsafe or unsupported contact category.')
  }
  return normalized as OpportunityV3SafeContactCategory[]
}

function strings(values: readonly string[]): string[] {
  if (!Array.isArray(values)) throw new TypeError('Expected a text array.')
  return [...new Set(values.map((value) => {
    if (typeof value !== 'string') throw new TypeError('Expected text value.')
    return value.trim().toLowerCase()
  }).filter(Boolean))].sort(compareText)
}

function positiveIds(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values)) throw new TypeError(`${label} IDs must be an array.`)
  return [...new Set(values.map((value) => positiveId(value, label)))]
    .sort(compareIds)
}

function positiveId(value: string, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new TypeError(`Invalid ${label} ID.`)
  }
  return BigInt(normalized).toString()
}

function generation(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new TypeError(`${label} must be a positive integer.`)
  }
  return value
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} count must be a non-negative integer.`)
  }
  return value
}

function ratio(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be between 0 and 1.`)
  }
  return round(value)
}

function hash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hash.`)
  }
  return value
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid.`)
  return new Date(parsed).toISOString()
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} is invalid.`)
  }
  return new Date(value.getTime())
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}

function compareIds(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right)
  return difference < 0 ? -1 : difference > 0 ? 1 : 0
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
