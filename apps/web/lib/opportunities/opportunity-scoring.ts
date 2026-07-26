import type { ScoringReason } from '@/lib/scoring/scoring-reasons'
import type {
  HiringEpisodeCandidate,
  HiringEpisodeStatus,
} from './hiring-episode-detection'

export const OPPORTUNITY_SCORING_VERSION = 'opportunity-v1' as const

export const OPPORTUNITY_STATUSES = [
  'new',
  'review',
  'accepted',
  'dismissed',
  'snoozed',
  'contacted',
  'expired',
] as const

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number]
export type ConfidenceGate = 'A' | 'B' | 'C' | 'D'

export interface OpportunityReason {
  code: string
  message: string
  evidenceIds: string[]
  basis: 'evidence' | 'profile'
}

export interface OpportunityComponentScore {
  score: number
  reasons: OpportunityReason[]
}

export interface OpportunityScoreResult {
  components: {
    agencyFit: OpportunityComponentScore
    hiringIntent: OpportunityComponentScore
    externalAgencyPropensity: OpportunityComponentScore
    timing: OpportunityComponentScore
    reachability: OpportunityComponentScore
    confidence: OpportunityComponentScore
  }
  opportunityScore: number
  confidenceGate: ConfidenceGate
  status: OpportunityStatus
  isMorningBriefEligible: boolean
  scoringVersion: typeof OPPORTUNITY_SCORING_VERSION
}

export interface OpportunityScoringConfig {
  minimumAgencyFit: number
  minimumExternalAgencyPropensity: number
  minimumMorningBriefScore: number
  confidenceReviewThreshold: number
  confidenceGateScores: Record<ConfidenceGate, number>
}

export const DEFAULT_OPPORTUNITY_SCORING_CONFIG: Readonly<OpportunityScoringConfig> = {
  minimumAgencyFit: 0.35,
  minimumExternalAgencyPropensity: 0.35,
  minimumMorningBriefScore: 0.5,
  confidenceReviewThreshold: 0.55,
  confidenceGateScores: {
    A: 1,
    B: 0.78,
    C: 0.45,
    D: 0.1,
  },
}

export interface OpportunityScoringInput {
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
  now?: Date
}

export class OpportunityScoringService {
  constructor(
    private readonly config: Readonly<OpportunityScoringConfig> =
      DEFAULT_OPPORTUNITY_SCORING_CONFIG,
  ) {}

  score(input: OpportunityScoringInput): OpportunityScoreResult {
    const evidenceIds = episodeEvidenceIds(input.episode)
    const agencyFit = this.scoreAgencyFit(input)
    const hiringIntent = scoreHiringIntent(input.episode, evidenceIds)
    const externalAgencyPropensity = scoreExternalAgencyPropensity(
      input.episode,
      input.confidenceGate,
      evidenceIds,
    )
    const timing = scoreTiming(input.episode, evidenceIds)
    const reachability = scoreReachability(input)
    const confidence = this.scoreConfidence(input, evidenceIds)
    const componentValues = [
      agencyFit.score,
      hiringIntent.score,
      externalAgencyPropensity.score,
      timing.score,
      reachability.score,
      confidence.score,
    ]
    const opportunityScore = geometricMean(componentValues)

    let status: OpportunityStatus = 'new'
    if (input.episodeStatus === 'closed') {
      status = 'expired'
    } else if (
      input.profileExcluded ||
      agencyFit.score < this.config.minimumAgencyFit
    ) {
      status = 'dismissed'
    } else if (
      input.confidenceGate === 'C' ||
      input.confidenceGate === 'D' ||
      confidence.score < this.config.confidenceReviewThreshold
    ) {
      status = 'review'
    }

    const isMorningBriefEligible =
      status !== 'expired' &&
      status !== 'dismissed' &&
      input.confidenceGate !== 'D' &&
      agencyFit.score >= this.config.minimumAgencyFit &&
      externalAgencyPropensity.score >= this.config.minimumExternalAgencyPropensity &&
      opportunityScore >= this.config.minimumMorningBriefScore

    return {
      components: {
        agencyFit,
        hiringIntent,
        externalAgencyPropensity,
        timing,
        reachability,
        confidence,
      },
      opportunityScore,
      confidenceGate: input.confidenceGate,
      status,
      isMorningBriefEligible,
      scoringVersion: OPPORTUNITY_SCORING_VERSION,
    }
  }

  private scoreAgencyFit(input: OpportunityScoringInput): OpportunityComponentScore {
    if (input.profileExcluded) {
      return {
        score: 0,
        reasons: [profileReason(
          'PROFILE_EXCLUSION',
          'Профиль агентства явно исключает эту компанию или направление.',
        )],
      }
    }
    const score = clamp01(input.fiur.fit)
    return {
      score,
      reasons: input.fiur.reasons.fit.length > 0
        ? input.fiur.reasons.fit.map((reason) =>
            profileReason(
              `FIUR_${reason.key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
              'Соответствие рассчитано существующей моделью FIUR Fit.',
            ),
          )
        : [profileReason('FIUR_FIT', 'Соответствие рассчитано существующей моделью FIUR Fit.')],
    }
  }

  private scoreConfidence(
    input: OpportunityScoringInput,
    evidenceIds: string[],
  ): OpportunityComponentScore {
    const score = clamp01(
      Math.min(
        input.confidenceScore,
        this.config.confidenceGateScores[input.confidenceGate],
      ),
    )
    return {
      score,
      reasons: [evidenceReason(
        `CONFIDENCE_GATE_${input.confidenceGate}`,
        `Достоверность ограничена существующим confidence gate ${input.confidenceGate}.`,
        evidenceIds,
      )],
    }
  }
}

function scoreHiringIntent(
  episode: HiringEpisodeCandidate,
  evidenceIds: string[],
): OpportunityComponentScore {
  const typeBoost: Record<HiringEpisodeCandidate['episodeType'], number> = {
    vacancy_spike: 0.18,
    repeated_vacancies: 0.2,
    new_role_cluster: 0.16,
    new_region: 0.08,
    hiring_restart: 0.12,
    sustained_hiring: 0.2,
  }
  const score = clamp01(
    episode.strengthScore * 0.45 +
      episode.freshnessScore * 0.25 +
      Math.min(episode.vacancyCount / 12, 0.2) +
      typeBoost[episode.episodeType],
  )
  return {
    score,
    reasons: [evidenceReason(
      `HIRING_EPISODE_${episode.episodeType.toUpperCase()}`,
      episode.summary,
      evidenceIds,
    )],
  }
}

function scoreExternalAgencyPropensity(
  episode: HiringEpisodeCandidate,
  confidenceGate: ConfidenceGate,
  evidenceIds: string[],
): OpportunityComponentScore {
  const metadata = episode.metadata
  const repeatedCount = numberMetadata(metadata, 'repeatedVacancyCount')
  const seniorCount = numberMetadata(metadata, 'seniorRoleCount')
  const regionCount = numberMetadata(metadata, 'regionCount')
  const recruiterCount = numberMetadata(metadata, 'recruiterVacancyCount')
  let score = 0.1
  const reasons: OpportunityReason[] = []

  if (episode.vacancyCount >= 10) {
    score += 0.3
    reasons.push(evidenceReason('HIGH_VACANCY_VOLUME', 'Одновременно открыто много вакансий.', evidenceIds))
  } else if (episode.vacancyCount >= 4) {
    score += 0.2
    reasons.push(evidenceReason('MULTIPLE_VACANCIES', 'Одновременно открыто несколько вакансий.', evidenceIds))
  }
  if (episode.episodeType === 'vacancy_spike') {
    score += 0.2
    reasons.push(evidenceReason('VACANCY_SPIKE', 'Темп найма заметно вырос относительно baseline.', evidenceIds))
  }
  if (episode.episodeType === 'repeated_vacancies' || repeatedCount > 0) {
    score += 0.25
    reasons.push(evidenceReason('REPEATED_VACANCIES', 'Есть повторно опубликованные позиции.', evidenceIds))
  }
  if (episode.episodeType === 'sustained_hiring') {
    score += 0.18
    reasons.push(evidenceReason('SUSTAINED_HIRING', 'Повышенный спрос сохраняется несколько периодов.', evidenceIds))
  }
  if (seniorCount > 0) {
    score += Math.min(0.05 * seniorCount, 0.15)
    reasons.push(evidenceReason('SENIOR_ROLES', 'В наборе есть сложные или senior-роли.', evidenceIds))
  }
  if (regionCount > 1) {
    score += 0.1
    reasons.push(evidenceReason('MULTI_REGION_HIRING', 'Найм идёт в нескольких регионах.', evidenceIds))
  }
  if (recruiterCount > 0 && episode.vacancyCount >= 5) {
    score += 0.08
    reasons.push(evidenceReason(
      'RECRUITER_WITH_BROAD_HIRING',
      'Вакансия рекрутера появилась на фоне более широкого найма.',
      evidenceIds,
    ))
  }
  if (episode.strengthScore < 0.35) score -= 0.15
  if (confidenceGate === 'C' || confidenceGate === 'D') score -= 0.2

  if (reasons.length === 0) {
    reasons.push(evidenceReason(
      'LIMITED_AGENCY_PROPENSITY',
      'Пока недостаточно признаков возможной потребности во внешнем подборе.',
      evidenceIds,
    ))
  }
  return { score: clamp01(score), reasons }
}

function scoreTiming(
  episode: HiringEpisodeCandidate,
  evidenceIds: string[],
): OpportunityComponentScore {
  const trend = stringMetadata(episode.metadata, 'activityTrend')
  const repeated = numberMetadata(episode.metadata, 'repeatedVacancyCount')
  const score = clamp01(
    episode.freshnessScore * 0.55 +
      episode.strengthScore * 0.25 +
      (trend === 'rising' || trend === 'restart' ? 0.12 : 0) +
      (repeated > 0 || trend === 'repeated' ? 0.08 : 0),
  )
  return {
    score,
    reasons: [evidenceReason(
      episode.freshnessScore >= 0.7 ? 'FRESH_EPISODE' : 'AGING_EPISODE',
      episode.freshnessScore >= 0.7
        ? 'Новые сигналы появились в актуальном окне.'
        : 'Актуальное окно episode приближается к завершению.',
      evidenceIds,
    )],
  }
}

function scoreReachability(input: OpportunityScoringInput): OpportunityComponentScore {
  const score = clamp01(input.fiur.reachability)
  return {
    score,
    reasons: input.fiur.reasons.reachability.length > 0
      ? input.fiur.reasons.reachability.map((reason) =>
          profileReason(
            `FIUR_${reason.key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
            'Доступность корпоративного пути контакта рассчитана FIUR Reachability.',
          ),
        )
      : [profileReason(
          'FIUR_REACHABILITY',
          'Доступность корпоративного пути контакта рассчитана FIUR Reachability.',
        )],
  }
}

function episodeEvidenceIds(episode: HiringEpisodeCandidate): string[] {
  return episode.evidenceIds.length > 0 ? episode.evidenceIds : episode.signalIds
}

function evidenceReason(
  code: string,
  message: string,
  evidenceIds: string[],
): OpportunityReason {
  return {
    code,
    message,
    evidenceIds: [...evidenceIds],
    basis: 'evidence',
  }
}

function profileReason(code: string, message: string): OpportunityReason {
  return {
    code,
    message,
    evidenceIds: [],
    basis: 'profile',
  }
}

function geometricMean(values: number[]): number {
  if (values.length === 0 || values.some((value) => clamp01(value) === 0)) return 0
  const meanLog =
    values.reduce((sum, value) => sum + Math.log(clamp01(value)), 0) /
    values.length
  return round(clamp01(Math.exp(meanLog)))
}

function numberMetadata(metadata: Record<string, unknown>, key: string): number {
  const value = metadata[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key]
  return typeof value === 'string' ? value : ''
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}
