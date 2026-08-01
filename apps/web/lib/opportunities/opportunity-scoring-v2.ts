import type { ScoringReason } from '@/lib/scoring/scoring-reasons'

import type { AgencyDnaRestrictionType } from './agency-dna'
import type {
  HiringEpisodeCandidate,
  HiringEpisodeStatus,
} from './hiring-episode-detection'
import {
  DEFAULT_OPPORTUNITY_SCORING_CONFIG,
  OpportunityScoringService,
  type ConfidenceGate,
  type OpportunityStatus,
} from './opportunity-scoring'

export const OPPORTUNITY_SCORING_VERSION_V2 = 'opportunity-v2' as const
export const OPPORTUNITY_FEATURE_SCHEMA_V2 = 'opportunity-features-v2' as const
export const OPPORTUNITY_GATE_VERSION_V2 = 'opportunity-gates-v2' as const

export const OPPORTUNITY_SCORING_V2_HARD_GATE_CODES = [
  'PROFILE_EXCLUSION',
  'ENTITY_RESOLUTION_UNVERIFIED',
  'HIRING_EVIDENCE_MISSING',
  'EPISODE_EXPIRED',
  'ACCOUNT_RESTRICTION_BLOCKED',
  'CONTACT_POLICY_BLOCKED',
] as const

export type OpportunityScoringV2HardGateCode =
  typeof OPPORTUNITY_SCORING_V2_HARD_GATE_CODES[number]

export interface OpportunityScoringV2Reason {
  code: string
  message: string
  evidenceIds: string[]
  basis: 'evidence' | 'profile' | 'policy'
}

export interface OpportunityScoringV2Component {
  score: number
  reasons: OpportunityScoringV2Reason[]
}

export interface OpportunityScoringV2HardGate {
  code: OpportunityScoringV2HardGateCode
  passed: boolean
  message: string
  evidenceIds: string[]
  basis: OpportunityScoringV2Reason['basis']
}

export interface OpportunityScoringV2Input {
  episode: HiringEpisodeCandidate
  episodeStatus?: HiringEpisodeStatus
  fiur: {
    fit: number
    reachability: number
    reasons: {
      fit: ScoringReason[]
      reachability: ScoringReason[]
    }
  }
  confidenceGate: ConfidenceGate
  confidenceScore: number
  profileExcluded: boolean
  entityResolutionVerified: boolean
  admissibleHiringEvidence: boolean
  accountRestriction: AgencyDnaRestrictionType | null
  contactPolicyEligible: boolean
  capabilityMatchScore: number | null
  now?: Date
}

export interface OpportunityScoringV2Result {
  components: {
    eligibility: OpportunityScoringV2Component
    evidenceConfidence: OpportunityScoringV2Component
    agencyFit: OpportunityScoringV2Component
    externalSupportNeed: OpportunityScoringV2Component
    timing: OpportunityScoringV2Component
    reachability: OpportunityScoringV2Component
    commercialValue: OpportunityScoringV2Component
  }
  hardGates: OpportunityScoringV2HardGate[]
  rankingScore: number
  confidenceGate: ConfidenceGate
  status: OpportunityStatus
  isActionQueueEligible: boolean
  scoringVersion: typeof OPPORTUNITY_SCORING_VERSION_V2
  featureSchemaVersion: typeof OPPORTUNITY_FEATURE_SCHEMA_V2
  gateVersion: typeof OPPORTUNITY_GATE_VERSION_V2
  modelType: 'heuristic'
  calibrationStatus: 'uncalibrated'
}

export interface OpportunityScoringV2Config {
  minimumAgencyFit: number
  minimumExternalSupportNeed: number
  minimumEvidenceConfidence: number
  minimumActionQueueRankingScore: number
}

export const DEFAULT_OPPORTUNITY_SCORING_V2_CONFIG:
Readonly<OpportunityScoringV2Config> = {
  minimumAgencyFit: DEFAULT_OPPORTUNITY_SCORING_CONFIG.minimumAgencyFit,
  minimumExternalSupportNeed:
    DEFAULT_OPPORTUNITY_SCORING_CONFIG.minimumExternalSupportNeed,
  minimumEvidenceConfidence:
    DEFAULT_OPPORTUNITY_SCORING_CONFIG.confidenceReviewThreshold,
  minimumActionQueueRankingScore: 0.5,
}

export class OpportunityScoringV2Service {
  constructor(
    private readonly config: Readonly<OpportunityScoringV2Config> =
      DEFAULT_OPPORTUNITY_SCORING_V2_CONFIG,
    private readonly v1Scorer = new OpportunityScoringService(),
  ) {}

  score(input: OpportunityScoringV2Input): OpportunityScoringV2Result {
    const evidenceIds = episodeEvidenceIds(input.episode)
    const baseline = this.v1Scorer.score({
      episode: input.episode,
      episodeStatus: input.episodeStatus,
      fiur: input.fiur,
      confidenceGate: input.confidenceGate,
      confidenceScore: input.confidenceScore,
      profileExcluded: input.profileExcluded,
      now: input.now,
    })
    const hardGates = evaluateHardGates(input, evidenceIds)
    const failedGates = hardGates.filter((gate) => !gate.passed)
    const eligibility: OpportunityScoringV2Component = {
      score: failedGates.length === 0 ? 1 : 0,
      reasons: failedGates.length === 0
        ? [policyReason(
          'ELIGIBILITY_GATES_PASSED',
          'Все обязательные evidence, profile и contact-policy gates пройдены.',
        )]
        : failedGates.map((gate) => ({
          code: gate.code,
          message: gate.message,
          evidenceIds: [...gate.evidenceIds],
          basis: gate.basis,
        })),
    }
    const evidenceConfidence = copyComponent(baseline.components.confidence)
    const agencyFit = scoreAgencyFit(
      baseline.components.agencyFit,
      input.capabilityMatchScore,
    )
    const externalSupportNeed = copyComponent(
      baseline.components.externalSupportNeed,
    )
    const timing = copyComponent(baseline.components.timing)
    const reachability = copyComponent(baseline.components.reachability)
    const commercialValue = scoreCommercialValueSignal({
      episode: input.episode,
      hiringIntentScore: baseline.components.hiringIntent.score,
      externalSupportNeedScore: externalSupportNeed.score,
      evidenceIds,
    })
    const components = {
      eligibility,
      evidenceConfidence,
      agencyFit,
      externalSupportNeed,
      timing,
      reachability,
      commercialValue,
    }
    const rankingScore = geometricMean(
      Object.values(components).map((component) => component.score),
    )
    const status = resolveStatus(input, failedGates, evidenceConfidence.score)
    const isActionQueueEligible =
      failedGates.length === 0 &&
      (input.confidenceGate === 'A' || input.confidenceGate === 'B') &&
      evidenceConfidence.score >= this.config.minimumEvidenceConfidence &&
      agencyFit.score >= this.config.minimumAgencyFit &&
      externalSupportNeed.score >= this.config.minimumExternalSupportNeed &&
      rankingScore >= this.config.minimumActionQueueRankingScore

    return {
      components,
      hardGates,
      rankingScore,
      confidenceGate: input.confidenceGate,
      status,
      isActionQueueEligible,
      scoringVersion: OPPORTUNITY_SCORING_VERSION_V2,
      featureSchemaVersion: OPPORTUNITY_FEATURE_SCHEMA_V2,
      gateVersion: OPPORTUNITY_GATE_VERSION_V2,
      modelType: 'heuristic',
      calibrationStatus: 'uncalibrated',
    }
  }
}

function evaluateHardGates(
  input: OpportunityScoringV2Input,
  evidenceIds: string[],
): OpportunityScoringV2HardGate[] {
  const blockedRestriction = input.accountRestriction === 'do_not_contact' ||
    input.accountRestriction === 'conflict'
  const hasEvidence = input.admissibleHiringEvidence && evidenceIds.length > 0
  return [
    gate(
      'PROFILE_EXCLUSION',
      !input.profileExcluded,
      'Профиль агентства явно исключает эту возможность.',
      [],
      'profile',
    ),
    gate(
      'ENTITY_RESOLUTION_UNVERIFIED',
      input.entityResolutionVerified,
      'Entity resolution не подтверждает устойчивую корпоративную идентичность.',
      evidenceIds,
      'evidence',
    ),
    gate(
      'HIRING_EVIDENCE_MISSING',
      hasEvidence,
      'Нет допустимого hiring evidence для коммерческого действия.',
      evidenceIds,
      'evidence',
    ),
    gate(
      'EPISODE_EXPIRED',
      input.episodeStatus !== 'closed',
      'Hiring episode завершён или истёк.',
      evidenceIds,
      'evidence',
    ),
    gate(
      'ACCOUNT_RESTRICTION_BLOCKED',
      !blockedRestriction,
      'Account restriction запрещает коммерческое действие.',
      [],
      'profile',
    ),
    gate(
      'CONTACT_POLICY_BLOCKED',
      input.contactPolicyEligible,
      'Нет корпоративного contact path, допустимого политикой агентства.',
      [],
      'policy',
    ),
  ]
}

function gate(
  code: OpportunityScoringV2HardGateCode,
  passed: boolean,
  message: string,
  evidenceIds: string[],
  basis: OpportunityScoringV2Reason['basis'],
): OpportunityScoringV2HardGate {
  return { code, passed, message, evidenceIds: [...evidenceIds], basis }
}

function scoreAgencyFit(
  baseline: { score: number; reasons: Array<{
    code: string
    message: string
    evidenceIds: string[]
    basis: 'evidence' | 'profile'
  }> },
  capabilityMatchScore: number | null,
): OpportunityScoringV2Component {
  if (capabilityMatchScore === null) return copyComponent(baseline)
  const normalizedCapabilityScore = clamp01(capabilityMatchScore)
  return {
    score: geometricMean([baseline.score, normalizedCapabilityScore]),
    reasons: [
      ...baseline.reasons.map(copyReason),
      profileReason(
        'AGENCY_DNA_CAPABILITY_MATCH',
        'Agency Fit учитывает только структурированные совпадения Agency DNA.',
      ),
    ],
  }
}

function scoreCommercialValueSignal(input: {
  episode: HiringEpisodeCandidate
  hiringIntentScore: number
  externalSupportNeedScore: number
  evidenceIds: string[]
}): OpportunityScoringV2Component {
  const volumeSignal = Math.min(input.episode.vacancyCount / 10, 1)
  const score = round(clamp01(
    input.hiringIntentScore * 0.45 +
      input.externalSupportNeedScore * 0.35 +
      volumeSignal * 0.2,
  ))
  return {
    score,
    reasons: [evidenceReason(
      'COMMERCIAL_VALUE_SIGNAL',
      'Компонент отражает масштаб подтверждённого найма, а не бюджет, вероятность или прогноз сделки.',
      input.evidenceIds,
    )],
  }
}

function resolveStatus(
  input: OpportunityScoringV2Input,
  failedGates: OpportunityScoringV2HardGate[],
  evidenceConfidenceScore: number,
): OpportunityStatus {
  if (input.episodeStatus === 'closed') return 'expired'
  if (failedGates.some((gate) =>
    gate.code === 'PROFILE_EXCLUSION' ||
    gate.code === 'ACCOUNT_RESTRICTION_BLOCKED' ||
    gate.code === 'CONTACT_POLICY_BLOCKED')) {
    return 'dismissed'
  }
  if (
    failedGates.length > 0 ||
    input.confidenceGate === 'C' ||
    input.confidenceGate === 'D' ||
    evidenceConfidenceScore <
      DEFAULT_OPPORTUNITY_SCORING_V2_CONFIG.minimumEvidenceConfidence
  ) {
    return 'review'
  }
  return 'new'
}

function copyComponent(component: {
  score: number
  reasons: Array<{
    code: string
    message: string
    evidenceIds: string[]
    basis: 'evidence' | 'profile'
  }>
}): OpportunityScoringV2Component {
  return {
    score: round(clamp01(component.score)),
    reasons: component.reasons.map(copyReason),
  }
}

function copyReason(reason: {
  code: string
  message: string
  evidenceIds: string[]
  basis: 'evidence' | 'profile'
}): OpportunityScoringV2Reason {
  return { ...reason, evidenceIds: [...reason.evidenceIds] }
}

function episodeEvidenceIds(episode: HiringEpisodeCandidate): string[] {
  return episode.evidenceIds.length > 0
    ? [...episode.evidenceIds]
    : [...episode.signalIds]
}

function geometricMean(values: number[]): number {
  if (values.length === 0 || values.some((value) => clamp01(value) === 0)) return 0
  return round(clamp01(Math.exp(
    values.reduce((sum, value) => sum + Math.log(clamp01(value)), 0) /
      values.length,
  )))
}

function evidenceReason(
  code: string,
  message: string,
  evidenceIds: string[],
): OpportunityScoringV2Reason {
  return { code, message, evidenceIds: [...evidenceIds], basis: 'evidence' }
}

function profileReason(
  code: string,
  message: string,
): OpportunityScoringV2Reason {
  return { code, message, evidenceIds: [], basis: 'profile' }
}

function policyReason(
  code: string,
  message: string,
): OpportunityScoringV2Reason {
  return { code, message, evidenceIds: [], basis: 'policy' }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}
