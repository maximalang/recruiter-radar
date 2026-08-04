import {
  AGENCY_DNA_RESTRICTION_TYPES,
  type AgencyDnaRestrictionType,
} from './agency-dna'
import { hashCanonicalJson } from './canonical-hash'
import {
  SIGNAL_EPISODE_TYPES,
  signalEpisodeStageAt,
  type SignalEpisodeStage,
  type SignalEpisodeType,
} from './signal-episode'

export const EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION =
  'external-agency-propensity-v1' as const

export const EXTERNAL_AGENCY_PROPENSITY_LEVELS = [
  'high',
  'medium',
  'low',
  'insufficient_evidence',
] as const

export type ExternalAgencyPropensityLevel =
  typeof EXTERNAL_AGENCY_PROPENSITY_LEVELS[number]

export type ExternalAgencyPropensityReasonBasis =
  | 'evidence'
  | 'agency_profile'
  | 'policy'

export type ExternalAgencyPropensityReason = {
  code: string
  message: string
  basis: ExternalAgencyPropensityReasonBasis
  contribution: number
  evidenceIds: string[]
}

export type ExternalAgencyPropensityFeatureSnapshot = {
  episodeType: SignalEpisodeType
  episodeStage: SignalEpisodeStage
  episodeIntensity: number
  roleFamilies: string[]
  roleFamilyCount: number
  seniorityDistribution: Record<string, number>
  hasComplexSeniority: boolean
  evidenceCount: number
  evidenceSourceFamilies: string[]
  evidenceSourceFamilyCount: number
  accountRestriction: AgencyDnaRestrictionType | null
  opportunityMode: 'new' | 'grow' | 'reactivate' | 'blocked'
}

export type ExternalAgencyPropensityInput = {
  organizationId: string
  workspaceId: string
  ownerId: string
  clientProfileId: string
  commercialThesisId: string
  commercialThesisGeneration: number
  thesisIdentity: string
  thesisInputHash: string
  thesisEvidenceHash: string
  agencyDnaVersion: number
  agencyDnaSnapshotHash: string
  episodeType: SignalEpisodeType
  episodeIntensity: number
  episodeLastSeenAt: string
  episodeValidUntil: string
  roleFamilies: string[]
  seniorityDistribution: Record<string, number>
  evidenceIds: string[]
  evidenceSourceFamilies: string[]
  accountRestriction: AgencyDnaRestrictionType | null
}

export type ExternalAgencyPropensityDraft = {
  organizationId: string
  workspaceId: string
  ownerId: string
  clientProfileId: string
  commercialThesisId: string
  commercialThesisGeneration: number
  agencyDnaVersion: number
  agencyDnaSnapshotHash: string
  propensityIdentity: string
  score: number
  level: ExternalAgencyPropensityLevel
  positiveReasons: ExternalAgencyPropensityReason[]
  negativeReasons: ExternalAgencyPropensityReason[]
  evidenceIds: string[]
  featureSnapshot: ExternalAgencyPropensityFeatureSnapshot
  thesisEvidenceHash: string
  inputHash: string
  featureVersion: typeof EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION
}

export type BuildExternalAgencyPropensityOptions = {
  now?: Date
}

type EpisodeRule = {
  code: string
  message: string
  contribution: number
}

const EPISODE_RULES: Record<SignalEpisodeType, EpisodeRule> = {
  vacancy_acceleration: rule(
    'VACANCY_ACCELERATION',
    'Hiring accelerated relative to the company baseline.',
    0.28,
  ),
  persistent_hiring_problem: rule(
    'PERSISTENT_HIRING_PROBLEM',
    'The same hiring need remains visible across repeated or long-running evidence.',
    0.34,
  ),
  role_cluster: rule(
    'RELATED_ROLE_CLUSTER',
    'A coherent cluster of related roles is active.',
    0.25,
  ),
  new_region_expansion: rule(
    'NEW_REGION_EXPANSION',
    'Hiring expanded into a region outside the observed baseline.',
    0.24,
  ),
  hiring_restart: rule(
    'HIRING_RESTART',
    'Hiring resumed after an observed pause.',
    0.28,
  ),
  sustained_hiring: rule(
    'SUSTAINED_HIRING',
    'Hiring remained elevated across multiple observation periods.',
    0.30,
  ),
  leadership_led_expansion: rule(
    'LEADERSHIP_LED_EXPANSION',
    'Leadership context coincides with an evidenced hiring expansion.',
    0.28,
  ),
  recruiting_capacity_gap: rule(
    'RECRUITING_CAPACITY_GAP',
    'Hiring acceleration coincides with an evidenced internal recruiting-capacity gap.',
    0.42,
  ),
  new_unit_buildout: rule(
    'NEW_UNIT_BUILDOUT',
    'A new unit context coincides with an evidenced hiring buildout.',
    0.27,
  ),
  business_expansion: rule(
    'BUSINESS_EXPANSION',
    'A business expansion event coincides with an evidenced hiring change.',
    0.26,
  ),
  reactivation_window: rule(
    'REACTIVATION_WINDOW',
    'Hiring resumed after a slowdown, creating a bounded reactivation window.',
    0.29,
  ),
}

const COMPLEX_SENIORITIES = new Set(['senior', 'lead', 'executive'])

export function buildExternalAgencyPropensity(
  rawInput: ExternalAgencyPropensityInput,
  options: BuildExternalAgencyPropensityOptions = {},
): ExternalAgencyPropensityDraft {
  const now = validDate(options.now ?? new Date(), 'now')
  const input = normalizeInput(rawInput, now)
  const episodeStage = signalEpisodeStageAt({
    lastSeenAt: input.episodeLastSeenAt,
    validUntil: input.episodeValidUntil,
  }, now)
  const opportunityMode = modeForRestriction(input.accountRestriction)
  const hasComplexSeniority = Object.entries(input.seniorityDistribution)
    .some(([seniority, count]) => COMPLEX_SENIORITIES.has(seniority) && count > 0)
  const featureSnapshot: ExternalAgencyPropensityFeatureSnapshot = {
    episodeType: input.episodeType,
    episodeStage,
    episodeIntensity: input.episodeIntensity,
    roleFamilies: input.roleFamilies,
    roleFamilyCount: input.roleFamilies.length,
    seniorityDistribution: input.seniorityDistribution,
    hasComplexSeniority,
    evidenceCount: input.evidenceIds.length,
    evidenceSourceFamilies: input.evidenceSourceFamilies,
    evidenceSourceFamilyCount: input.evidenceSourceFamilies.length,
    accountRestriction: input.accountRestriction,
    opportunityMode,
  }
  const positiveReasons: ExternalAgencyPropensityReason[] = []
  const negativeReasons: ExternalAgencyPropensityReason[] = []
  const evidenceIds = input.evidenceIds

  const episodeRule = EPISODE_RULES[input.episodeType]
  positiveReasons.push(evidenceReason(episodeRule, evidenceIds))

  const intensity = intensityReason(input.episodeIntensity)
  if (intensity) positiveReasons.push(evidenceReason(intensity, evidenceIds))
  if (input.roleFamilies.length >= 2) {
    positiveReasons.push(evidenceReason(rule(
      'MULTI_ROLE_COMPLEXITY',
      'Several related role families increase delivery complexity.',
      0.10,
    ), evidenceIds))
  }
  if (hasComplexSeniority) {
    positiveReasons.push(evidenceReason(rule(
      'SENIORITY_COMPLEXITY',
      'Senior, lead, or executive hiring is present in the evidenced situation.',
      0.10,
    ), evidenceIds))
  }
  if (input.evidenceSourceFamilies.length >= 2) {
    positiveReasons.push(evidenceReason(rule(
      'INDEPENDENT_EVIDENCE',
      'The situation is supported by more than one evidence source family.',
      0.12,
    ), evidenceIds))
  } else if (input.evidenceSourceFamilies.length === 1) {
    negativeReasons.push(evidenceReason(rule(
      'EVIDENCE_INDEPENDENCE_LIMITED',
      'The situation currently relies on one evidence source family.',
      0,
    ), evidenceIds))
  } else {
    negativeReasons.push(evidenceReason(rule(
      'EVIDENCE_SOURCE_FAMILY_MISSING',
      'Evidence source-family provenance is unavailable.',
      0,
    ), evidenceIds))
  }

  if (input.accountRestriction === 'existing_client') {
    positiveReasons.push(profileReason(
      'KNOWN_EXTERNAL_AGENCY_USE',
      'The company is recorded as a current client in this Agency DNA scope.',
      0.12,
    ))
  } else if (input.accountRestriction === 'former_client') {
    positiveReasons.push(profileReason(
      'HISTORICAL_EXTERNAL_AGENCY_USE',
      'The company is recorded as a former client in this Agency DNA scope.',
      0.08,
    ))
  }

  if (episodeStage === 'cooling') {
    negativeReasons.push(evidenceReason(rule(
      'EPISODE_COOLING',
      'The evidence is in the cooling part of its validity window.',
      -0.18,
    ), evidenceIds))
  } else if (episodeStage === 'expired') {
    negativeReasons.push(evidenceReason(rule(
      'EPISODE_EXPIRED',
      'The evidence validity window has expired.',
      -1,
    ), evidenceIds))
  }

  if (input.accountRestriction === 'do_not_contact') {
    negativeReasons.push(policyReason(
      'DO_NOT_CONTACT',
      'The tenant-scoped account policy forbids commercial contact.',
      -1,
    ))
  } else if (input.accountRestriction === 'conflict') {
    negativeReasons.push(policyReason(
      'ACCOUNT_CONFLICT',
      'The tenant-scoped account is blocked by a recorded conflict.',
      -1,
    ))
  }

  const insufficient = episodeStage === 'expired' ||
    input.evidenceSourceFamilies.length === 0
  const blocked = opportunityMode === 'blocked'
  let score = clamp01(sumContributions(positiveReasons, negativeReasons))
  if (episodeStage === 'cooling') score = Math.min(score, 0.67)
  if (insufficient || blocked) score = 0
  const level = propensityLevel({
    score,
    stage: episodeStage,
    evidenceSourceFamilyCount: input.evidenceSourceFamilies.length,
    insufficient,
    blocked,
  })
  const propensityIdentity = hashCanonicalJson({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    clientProfileId: input.clientProfileId,
    thesisIdentity: input.thesisIdentity,
    featureVersion: EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
  })
  const inputHash = hashCanonicalJson({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    clientProfileId: input.clientProfileId,
    commercialThesisId: input.commercialThesisId,
    commercialThesisGeneration: input.commercialThesisGeneration,
    thesisInputHash: input.thesisInputHash,
    thesisEvidenceHash: input.thesisEvidenceHash,
    agencyDnaVersion: input.agencyDnaVersion,
    agencyDnaSnapshotHash: input.agencyDnaSnapshotHash,
    featureSnapshot,
    featureVersion: EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
  })

  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    clientProfileId: input.clientProfileId,
    commercialThesisId: input.commercialThesisId,
    commercialThesisGeneration: input.commercialThesisGeneration,
    agencyDnaVersion: input.agencyDnaVersion,
    agencyDnaSnapshotHash: input.agencyDnaSnapshotHash,
    propensityIdentity,
    score,
    level,
    positiveReasons,
    negativeReasons,
    evidenceIds,
    featureSnapshot,
    thesisEvidenceHash: input.thesisEvidenceHash,
    inputHash,
    featureVersion: EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
  }
}

function normalizeInput(
  input: ExternalAgencyPropensityInput,
  now: Date,
): ExternalAgencyPropensityInput {
  const episodeLastSeenAt = validTimestamp(input.episodeLastSeenAt, 'last seen date')
  const episodeValidUntil = validTimestamp(input.episodeValidUntil, 'valid-until date')
  if (Date.parse(episodeLastSeenAt) > now.getTime()) {
    throw new TypeError('Episode last seen date cannot be in the future.')
  }
  if (Date.parse(episodeValidUntil) <= Date.parse(episodeLastSeenAt)) {
    throw new TypeError('Episode valid-until date must follow last seen date.')
  }
  if (!SIGNAL_EPISODE_TYPES.includes(input.episodeType)) {
    throw new TypeError('Unsupported Signal Episode type.')
  }
  if (!Number.isFinite(input.episodeIntensity) ||
      input.episodeIntensity < 0 || input.episodeIntensity > 1) {
    throw new TypeError('Episode intensity must be between 0 and 1.')
  }
  if (input.accountRestriction !== null &&
      !AGENCY_DNA_RESTRICTION_TYPES.includes(input.accountRestriction)) {
    throw new TypeError('Unsupported Agency DNA account restriction.')
  }
  const evidenceIds = positiveIds(input.evidenceIds, 'evidence')
  if (evidenceIds.length === 0) {
    throw new TypeError('At least one evidence id is required.')
  }

  return {
    ...input,
    organizationId: positiveId(input.organizationId, 'organization'),
    workspaceId: positiveId(input.workspaceId, 'workspace'),
    ownerId: positiveId(input.ownerId, 'owner'),
    clientProfileId: positiveId(input.clientProfileId, 'client profile'),
    commercialThesisId: positiveId(input.commercialThesisId, 'commercial thesis'),
    commercialThesisGeneration: positiveInteger(
      input.commercialThesisGeneration,
      'commercial thesis generation',
    ),
    thesisIdentity: hash(input.thesisIdentity, 'thesis identity hash'),
    thesisInputHash: hash(input.thesisInputHash, 'thesis input hash'),
    thesisEvidenceHash: hash(input.thesisEvidenceHash, 'thesis evidence hash'),
    agencyDnaVersion: positiveInteger(input.agencyDnaVersion, 'Agency DNA version'),
    agencyDnaSnapshotHash: hash(
      input.agencyDnaSnapshotHash,
      'Agency DNA snapshot hash',
    ),
    episodeLastSeenAt,
    episodeValidUntil,
    episodeIntensity: input.episodeIntensity,
    roleFamilies: normalizedStrings(input.roleFamilies),
    seniorityDistribution: normalizedNumberRecord(input.seniorityDistribution),
    evidenceIds,
    evidenceSourceFamilies: normalizedStrings(input.evidenceSourceFamilies),
  }
}

function intensityReason(intensity: number): EpisodeRule | null {
  if (intensity >= 0.8) {
    return rule(
      'HIGH_EPISODE_INTENSITY',
      'The evidenced situation has high rule-engine intensity.',
      0.18,
    )
  }
  if (intensity >= 0.6) {
    return rule(
      'MODERATE_EPISODE_INTENSITY',
      'The evidenced situation has moderate rule-engine intensity.',
      0.12,
    )
  }
  if (intensity >= 0.4) {
    return rule(
      'SUPPORTED_EPISODE_INTENSITY',
      'The evidenced situation clears the supported intensity floor.',
      0.06,
    )
  }
  return null
}

function propensityLevel(input: {
  score: number
  stage: SignalEpisodeStage
  evidenceSourceFamilyCount: number
  insufficient: boolean
  blocked: boolean
}): ExternalAgencyPropensityLevel {
  if (input.insufficient) return 'insufficient_evidence'
  if (input.blocked) return 'low'
  if (
    input.stage === 'active' &&
    input.evidenceSourceFamilyCount >= 2 &&
    input.score >= 0.68
  ) return 'high'
  if (input.score >= 0.4) return 'medium'
  return 'low'
}

function modeForRestriction(
  restriction: AgencyDnaRestrictionType | null,
): ExternalAgencyPropensityFeatureSnapshot['opportunityMode'] {
  if (restriction === 'existing_client') return 'grow'
  if (restriction === 'former_client') return 'reactivate'
  if (restriction === 'do_not_contact' || restriction === 'conflict') {
    return 'blocked'
  }
  return 'new'
}

function evidenceReason(
  item: EpisodeRule,
  evidenceIds: string[],
): ExternalAgencyPropensityReason {
  return { ...item, basis: 'evidence', evidenceIds: [...evidenceIds] }
}

function profileReason(
  code: string,
  message: string,
  contribution: number,
): ExternalAgencyPropensityReason {
  return { code, message, contribution, basis: 'agency_profile', evidenceIds: [] }
}

function policyReason(
  code: string,
  message: string,
  contribution: number,
): ExternalAgencyPropensityReason {
  return { code, message, contribution, basis: 'policy', evidenceIds: [] }
}

function sumContributions(
  positive: ExternalAgencyPropensityReason[],
  negative: ExternalAgencyPropensityReason[],
): number {
  return [...positive, ...negative]
    .reduce((total, reason) => total + reason.contribution, 0)
}

function normalizedStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase())
    .filter(Boolean))).sort(compareStrings)
}

function normalizedNumberRecord(
  value: Readonly<Record<string, number>>,
): Record<string, number> {
  const normalized = new Map<string, number>()
  for (const [rawKey, rawCount] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase()
    if (!key || !Number.isFinite(rawCount) || rawCount < 0) {
      throw new TypeError('Seniority distribution contains an invalid count.')
    }
    normalized.set(key, (normalized.get(key) ?? 0) + rawCount)
  }
  return Object.fromEntries([...normalized.entries()].sort(([left], [right]) =>
    compareStrings(left, right)))
}

function positiveIds(values: readonly string[], label: string): string[] {
  return Array.from(new Set(values.map((value) => positiveId(value, label))))
    .sort(comparePositiveIds)
}

function positiveId(value: string, label: string): string {
  const normalized = String(value)
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new TypeError(`Invalid ${label} id.`)
  }
  return normalized
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`)
  }
  return value
}

function hash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`Invalid ${label}.`)
  return value
}

function validTimestamp(value: string, label: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new TypeError(`Invalid ${label}.`)
  return new Date(timestamp).toISOString()
}

function validDate(value: Date, label: string): Date {
  if (!Number.isFinite(value.getTime())) throw new TypeError(`Invalid ${label} date.`)
  return value
}

function clamp01(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function comparePositiveIds(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length
  return compareStrings(left, right)
}

function rule(
  code: string,
  message: string,
  contribution: number,
): EpisodeRule {
  return { code, message, contribution }
}
