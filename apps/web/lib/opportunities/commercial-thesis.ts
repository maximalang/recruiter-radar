import { createHash } from 'node:crypto'

import {
  SIGNAL_EPISODE_ENGINE_VERSION,
  SIGNAL_EPISODE_TYPES,
  signalEpisodeStageAt,
  type SignalEpisodeDirection,
  type SignalEpisodeStage,
  type SignalEpisodeType,
} from './signal-episode'

export const COMMERCIAL_THESIS_ENGINE_VERSION = 'commercial-thesis-v1' as const

export type CommercialThesisStatementClassification =
  | 'confirmed_fact'
  | 'rule_based_inference'
  | 'heuristic_hypothesis'
  | 'unknown'

export type CommercialThesisRejectionCode =
  | 'COMMERCIAL_THESIS_EVIDENCE_MISSING'
  | 'COMMERCIAL_THESIS_EPISODE_FUTURE'
  | 'COMMERCIAL_THESIS_EPISODE_INVALID'

export interface CommercialThesisStatement {
  classification: CommercialThesisStatementClassification
  code: string
  text: string
  evidenceRefs: string[]
}

export interface CommercialThesisEpisodeInput {
  id: string
  organizationId: string
  episodeIdentity: string
  episodeGeneration: number
  episodeType: SignalEpisodeType
  stage: SignalEpisodeStage
  startedAt: string
  lastSeenAt: string
  validUntil: string
  intensity: number
  direction: SignalEpisodeDirection
  baselineDeviation: number | null
  roleFamilies: string[]
  regions: string[]
  seniorityDistribution: Record<string, number>
  problemHypotheses: string[]
  evidenceRefs: string[]
  evidenceHash: string
  inputHash: string
  engineVersion: typeof SIGNAL_EPISODE_ENGINE_VERSION
}

export interface CommercialThesisDraft {
  organizationId: string
  signalEpisodeId: string
  signalEpisodeGeneration: number
  thesisIdentity: string
  whatChanged: CommercialThesisStatement[]
  whyItMatters: CommercialThesisStatement[]
  probableHiringProblem: CommercialThesisStatement[]
  whyExternalAgencyMayBeNeeded: CommercialThesisStatement[]
  whyThisAgencyFits: CommercialThesisStatement[]
  whyNow: CommercialThesisStatement[]
  recommendedService: CommercialThesisStatement[]
  recommendedPersona: CommercialThesisStatement[]
  recommendedAngle: CommercialThesisStatement[]
  risks: CommercialThesisStatement[]
  limitations: CommercialThesisStatement[]
  evidenceRefs: string[]
  evidenceHash: string
  inputHash: string
  engineVersion: typeof COMMERCIAL_THESIS_ENGINE_VERSION
}

export interface CommercialThesisBuildResult {
  theses: CommercialThesisDraft[]
  rejections: Array<{
    signalEpisodeId: string
    reasonCode: CommercialThesisRejectionCode
  }>
}

export interface BuildCommercialThesisOptions {
  now?: Date
}

type EpisodeRule = {
  factCode: string
  factText: string
  mattersCode: string
  mattersText: string
  agencyNeedCode: string
  agencyNeedText: string
  serviceCode: string
  serviceText: string
  personaCode: string
  personaText: string
  angleCode: string
  angleText: string
}

const EPISODE_RULES: Record<SignalEpisodeType, EpisodeRule> = {
  vacancy_acceleration: rule(
    'vacancy_acceleration_observed',
    'Hiring activity accelerated relative to the company baseline.',
    'delivery_demand_may_be_rising',
    'The company may need to fill roles faster than in its usual hiring cycle.',
    'accelerated_search_may_exceed_internal_capacity',
    'An external agency may add delivery capacity while the hiring wave is active.',
    'project_recruitment',
    'Project recruitment for the accelerated role set.',
    'head_of_talent',
    'Head of Talent or the leader accountable for recruiting delivery.',
    'capacity_during_acceleration',
    'Discuss delivery capacity for the evidenced acceleration, without assuming a mandate.',
  ),
  persistent_hiring_problem: rule(
    'persistent_hiring_problem_observed',
    'The same hiring need remains visible across repeated or long-running evidence.',
    'role_delivery_may_be_blocked',
    'Persistence can indicate a role-specific sourcing or conversion constraint.',
    'specialist_search_may_unblock_delivery',
    'External specialist search may help test channels beyond the current process.',
    'specialist_search',
    'Specialist search for the persistent role family.',
    'head_of_talent',
    'Head of Talent or the hiring leader responsible for the persistent roles.',
    'persistent_role_bottleneck',
    'Lead with the evidenced persistence and a narrow specialist-search hypothesis.',
  ),
  role_cluster: rule(
    'role_cluster_observed',
    'A related role family increased as a coherent cluster.',
    'team_buildout_may_require_specialist_coverage',
    'A concentrated role cluster can create a specialist sourcing requirement.',
    'cluster_search_may_extend_market_coverage',
    'An external agency may extend market coverage for the evidenced role cluster.',
    'team_buildout_search',
    'Team buildout search for the evidenced role family.',
    'functional_hiring_leader',
    'The functional leader accountable for the evidenced team buildout.',
    'role_cluster_coverage',
    'Discuss specialist market coverage for the evidenced cluster.',
  ),
  new_region_expansion: rule(
    'new_region_expansion_observed',
    'Hiring expanded into a region outside the observed company baseline.',
    'regional_market_setup_may_be_needed',
    'A new region can require local sourcing knowledge and delivery capacity.',
    'regional_partner_may_reduce_setup_time',
    'An external agency may support local market access while internal coverage is unknown.',
    'regional_hiring_support',
    'Regional hiring support for the evidenced expansion market.',
    'regional_people_leader',
    'The people or business leader accountable for the new region.',
    'regional_market_entry',
    'Discuss evidence-backed regional market access, not assumed expansion plans.',
  ),
  hiring_restart: rule(
    'hiring_restart_observed',
    'Hiring resumed after an observed pause.',
    'renewed_demand_may_need_fast_reactivation',
    'A restart can require rebuilding sourcing momentum and candidate flow.',
    'external_search_may_accelerate_reactivation',
    'An external agency may help restore delivery speed during the restart window.',
    'hiring_reactivation',
    'Hiring reactivation support for the resumed role set.',
    'head_of_talent',
    'Head of Talent or the leader accountable for the resumed hiring plan.',
    'restart_momentum',
    'Discuss the observed restart and time-to-rebuild candidate flow.',
  ),
  sustained_hiring: rule(
    'sustained_hiring_observed',
    'Hiring remained elevated across multiple observation periods.',
    'sustained_delivery_pressure_may_exist',
    'Sustained hiring can create continuing recruiting delivery pressure.',
    'external_capacity_may_support_the_sustained_load',
    'An external agency may add flexible capacity while elevated demand persists.',
    'embedded_recruiting_support',
    'Embedded or project recruiting support for sustained hiring volume.',
    'head_of_talent',
    'Head of Talent or the recruiting operations leader.',
    'sustained_capacity',
    'Discuss flexible capacity against the evidenced sustained hiring load.',
  ),
  leadership_led_expansion: rule(
    'leadership_led_expansion_observed',
    'A leadership change coincides with an evidenced hiring or role-mix expansion.',
    'leadership_mandate_may_require_team_delivery',
    'A new leadership mandate may depend on building the evidenced team.',
    'specialist_partner_may_support_mandate_delivery',
    'An external agency may support hard-to-fill roles while the mandate is being established.',
    'leadership_team_buildout',
    'Specialist team buildout support linked to the evidenced leadership context.',
    'functional_executive',
    'The functional executive or talent leader accountable for the buildout.',
    'mandate_delivery',
    'Connect the hiring evidence to mandate delivery without treating leadership news alone as demand.',
  ),
  recruiting_capacity_gap: rule(
    'recruiting_capacity_gap_observed',
    'Hiring acceleration coincides with a public internal recruiter vacancy.',
    'internal_recruiting_capacity_may_be_constrained',
    'The company may be adding recruiting capacity while an active hiring wave continues.',
    'interim_external_capacity_may_bridge_the_gap',
    'An external agency may bridge delivery until internal recruiting capacity is established.',
    'recruiting_capacity_support',
    'Interim recruiting capacity or project recruitment support.',
    'head_of_talent',
    'Head of Talent or the leader covering recruiting capacity.',
    'bridge_internal_capacity',
    'Discuss a bounded capacity bridge based on the simultaneous hiring evidence.',
  ),
  new_unit_buildout: rule(
    'new_unit_buildout_observed',
    'A new business unit context coincides with an evidenced hiring or role shift.',
    'new_team_delivery_may_be_required',
    'A new unit may require coordinated delivery across a related role set.',
    'external_team_buildout_may_add_specialist_reach',
    'An external agency may support coordinated specialist search for the new team.',
    'team_buildout_search',
    'Team buildout search for the evidenced unit role set.',
    'business_unit_leader',
    'The business-unit or talent leader accountable for the buildout.',
    'new_unit_delivery',
    'Discuss coordinated team delivery tied to the evidenced hiring change.',
  ),
  business_expansion: rule(
    'business_expansion_observed',
    'A public business expansion event coincides with an evidenced hiring change.',
    'business_growth_may_create_hiring_pressure',
    'The business change may increase the need to deliver the evidenced roles.',
    'external_search_may_support_growth_execution',
    'An external agency may add specialist capacity while growth plans are executed.',
    'growth_hiring_support',
    'Project or specialist recruitment aligned to the evidenced growth hiring.',
    'people_or_business_leader',
    'The people or business leader accountable for growth execution.',
    'growth_execution',
    'Discuss the hiring evidence supporting growth execution, not the context event alone.',
  ),
  reactivation_window: rule(
    'reactivation_window_observed',
    'Hiring resumed after a slowdown within the same commercial situation.',
    'renewed_need_may_reopen_a_delivery_window',
    'The renewed hiring wave may create a time-bounded reactivation opportunity.',
    'external_support_may_restore_candidate_flow',
    'An external agency may help restore candidate flow if the renewed need is confirmed.',
    'hiring_reactivation',
    'Reactivation support for the renewed role set.',
    'head_of_talent',
    'Head of Talent or the hiring leader responsible for the renewed roles.',
    'renewed_hiring_window',
    'Discuss the evidenced renewed wave and confirm whether prior constraints remain.',
  ),
}

export function buildCommercialThesis(
  rawEpisode: CommercialThesisEpisodeInput,
  options: BuildCommercialThesisOptions = {},
): CommercialThesisBuildResult {
  const now = validDate(options.now ?? new Date())
  const episodeId = String(rawEpisode?.id ?? '')
  if (!Array.isArray(rawEpisode?.evidenceRefs) || rawEpisode.evidenceRefs.length === 0) {
    return rejection(episodeId, 'COMMERCIAL_THESIS_EVIDENCE_MISSING')
  }
  const episode = normalizeEpisode(rawEpisode, now)
  if (!episode) {
    const future = isFutureEpisode(rawEpisode, now)
    return rejection(
      episodeId,
      future
        ? 'COMMERCIAL_THESIS_EPISODE_FUTURE'
        : 'COMMERCIAL_THESIS_EPISODE_INVALID',
    )
  }
  const evidenceRefs = episode.evidenceRefs
  const ruleSet = EPISODE_RULES[episode.episodeType]
  const whyNow = episode.stage === 'expired'
    ? [statement(
        'unknown',
        'episode_expired_no_current_urgency',
        'The episode has expired, so current urgency cannot be claimed.',
        [],
      )]
    : [statement(
        'rule_based_inference',
        episode.stage === 'cooling' ? 'episode_cooling_window' : 'episode_active_window',
        episode.stage === 'cooling'
          ? 'The evidence remains valid but is approaching the end of its defined window.'
          : 'The evidence is inside the episode validity window.',
        evidenceRefs,
      )]
  const risks = [statement(
    'heuristic_hypothesis',
    'commercial_need_is_inferred',
    'Public hiring evidence does not confirm an external recruiting mandate.',
    evidenceRefs,
  )]
  if (episode.stage === 'cooling') {
    risks.push(statement(
      'rule_based_inference',
      'episode_near_expiry',
      'The commercial situation may lose relevance unless refreshed by new evidence.',
      evidenceRefs,
    ))
  }
  if (episode.stage === 'expired') {
    risks.push(statement(
      'rule_based_inference',
      'stale_episode',
      'The episode validity window has ended.',
      evidenceRefs,
    ))
  }
  if (episode.intensity < 0.5) {
    risks.push(statement(
      'rule_based_inference',
      'limited_episode_intensity',
      'The rule-derived episode intensity is limited.',
      evidenceRefs,
    ))
  }

  const probableHiringProblem = episode.problemHypotheses.map((code) =>
    statement(
      'heuristic_hypothesis',
      code,
      hypothesisText(code),
      evidenceRefs,
    ))
  const thesisIdentity = sha256([
    COMMERCIAL_THESIS_ENGINE_VERSION,
    episode.organizationId,
    episode.episodeIdentity,
  ])
  const draftWithoutHash = {
    organizationId: episode.organizationId,
    signalEpisodeId: episode.id,
    signalEpisodeGeneration: episode.episodeGeneration,
    thesisIdentity,
    whatChanged: [
      statement('confirmed_fact', ruleSet.factCode, ruleSet.factText, evidenceRefs),
      ...episodeFactDetails(episode, evidenceRefs),
    ],
    whyItMatters: [statement(
      'rule_based_inference',
      ruleSet.mattersCode,
      ruleSet.mattersText,
      evidenceRefs,
    )],
    probableHiringProblem,
    whyExternalAgencyMayBeNeeded: [statement(
      'heuristic_hypothesis',
      ruleSet.agencyNeedCode,
      ruleSet.agencyNeedText,
      evidenceRefs,
    )],
    whyThisAgencyFits: [statement(
      'unknown',
      'agency_context_not_evaluated',
      'Agency fit is unknown until a tenant-scoped Agency DNA match is evaluated.',
      [],
    )],
    whyNow,
    recommendedService: [statement(
      'rule_based_inference',
      ruleSet.serviceCode,
      ruleSet.serviceText,
      evidenceRefs,
    )],
    recommendedPersona: [statement(
      'rule_based_inference',
      ruleSet.personaCode,
      ruleSet.personaText,
      evidenceRefs,
    )],
    recommendedAngle: [statement(
      'rule_based_inference',
      ruleSet.angleCode,
      ruleSet.angleText,
      evidenceRefs,
    )],
    risks,
    limitations: [
      statement(
        'unknown',
        'facts_limited_to_public_evidence',
        'Internal hiring plans, budget, urgency, and supplier status are unknown.',
        [],
      ),
      statement(
        'unknown',
        'external_agency_propensity_not_calibrated',
        'External agency propensity has not yet been evaluated or calibrated.',
        [],
      ),
      statement(
        'unknown',
        'agency_fit_not_evaluated',
        'No tenant-scoped agency capabilities or exclusions were used.',
        [],
      ),
      ...(episode.stage === 'expired'
        ? [statement(
            'unknown',
            'current_need_not_confirmed',
            'No current need is claimed after the episode validity window.',
            [],
          )]
        : []),
    ],
    evidenceRefs,
    evidenceHash: episode.evidenceHash,
    engineVersion: COMMERCIAL_THESIS_ENGINE_VERSION,
  }
  const inputHash = sha256([
    canonicalJson(draftWithoutHash),
    canonicalJson(episode),
  ])
  return {
    theses: [{ ...draftWithoutHash, inputHash }],
    rejections: [],
  }
}

function normalizeEpisode(
  episode: CommercialThesisEpisodeInput,
  now: Date,
): CommercialThesisEpisodeInput | null {
  const id = positiveId(episode.id)
  const organizationId = positiveId(episode.organizationId)
  const startedAt = timestamp(episode.startedAt)
  const lastSeenAt = timestamp(episode.lastSeenAt)
  const validUntil = timestamp(episode.validUntil)
  const evidenceRefs = validIds(episode.evidenceRefs)
  const roleFamilies = uniqueText(episode.roleFamilies)
  const regions = uniqueText(episode.regions)
  const problemHypotheses = uniqueText(episode.problemHypotheses)
  if (
    !id ||
    !organizationId ||
    !Number.isInteger(episode.episodeGeneration) ||
    episode.episodeGeneration <= 0 ||
    !SIGNAL_EPISODE_TYPES.includes(episode.episodeType) ||
    !startedAt ||
    !lastSeenAt ||
    !validUntil ||
    Date.parse(startedAt) > Date.parse(lastSeenAt) ||
    Date.parse(lastSeenAt) >= Date.parse(validUntil) ||
    Date.parse(lastSeenAt) > now.getTime() ||
    !Number.isFinite(episode.intensity) ||
    episode.intensity < 0 ||
    episode.intensity > 1 ||
    !['up', 'down', 'new', 'changed'].includes(episode.direction) ||
    (episode.baselineDeviation !== null && !Number.isFinite(episode.baselineDeviation)) ||
    !hash(episode.episodeIdentity) ||
    !hash(episode.evidenceHash) ||
    !hash(episode.inputHash) ||
    evidenceRefs.length === 0 ||
    !Array.isArray(episode.roleFamilies) ||
    !Array.isArray(episode.regions) ||
    !Array.isArray(episode.problemHypotheses) ||
    problemHypotheses.length === 0 ||
    problemHypotheses.some((code) => !/^[a-z][a-z0-9_]{1,63}$/.test(code)) ||
    episode.engineVersion !== SIGNAL_EPISODE_ENGINE_VERSION
  ) {
    return null
  }
  const normalizedForStage = { lastSeenAt, validUntil }
  if (signalEpisodeStageAt(normalizedForStage, now) !== episode.stage) return null
  if (!validDistribution(episode.seniorityDistribution)) return null
  return {
    ...episode,
    id,
    organizationId,
    startedAt,
    lastSeenAt,
    validUntil,
    roleFamilies,
    regions,
    seniorityDistribution: canonicalDistribution(episode.seniorityDistribution),
    problemHypotheses,
    evidenceRefs,
  }
}

function episodeFactDetails(
  episode: CommercialThesisEpisodeInput,
  evidenceRefs: string[],
): CommercialThesisStatement[] {
  const details: CommercialThesisStatement[] = []
  if (episode.roleFamilies.length > 0) {
    details.push(statement(
      'confirmed_fact',
      'role_families_observed',
      `Observed role families: ${episode.roleFamilies.join(', ')}.`,
      evidenceRefs,
    ))
  }
  if (episode.regions.length > 0) {
    details.push(statement(
      'confirmed_fact',
      'regions_observed',
      `Observed regions: ${episode.regions.join(', ')}.`,
      evidenceRefs,
    ))
  }
  if (episode.baselineDeviation !== null) {
    details.push(statement(
      'confirmed_fact',
      'baseline_deviation_calculated',
      `Rule engine baseline deviation: ${episode.baselineDeviation}.`,
      evidenceRefs,
    ))
  }
  return details
}

function statement(
  classification: CommercialThesisStatementClassification,
  code: string,
  text: string,
  evidenceRefs: readonly string[],
): CommercialThesisStatement {
  return { classification, code, text, evidenceRefs: [...evidenceRefs] }
}

function rule(...values: [
  string, string, string, string, string, string,
  string, string, string, string, string, string,
]): EpisodeRule {
  return {
    factCode: values[0],
    factText: values[1],
    mattersCode: values[2],
    mattersText: values[3],
    agencyNeedCode: values[4],
    agencyNeedText: values[5],
    serviceCode: values[6],
    serviceText: values[7],
    personaCode: values[8],
    personaText: values[9],
    angleCode: values[10],
    angleText: values[11],
  }
}

function hypothesisText(code: string): string {
  const text: Record<string, string> = {
    delivery_capacity_pressure: 'Hiring delivery capacity may be under pressure.',
    persistent_specialist_supply_gap: 'The company may face a persistent specialist supply gap.',
    specialist_team_buildout: 'The company may be building a specialist team.',
    regional_hiring_setup: 'The company may need to establish regional hiring coverage.',
    renewed_hiring_demand: 'The company may have renewed hiring demand.',
    sustained_delivery_capacity_pressure: 'Sustained hiring may be pressuring recruiting delivery capacity.',
    leadership_mandate_delivery_gap: 'A leadership mandate may depend on filling the evidenced roles.',
    internal_recruiting_capacity_gap: 'Internal recruiting capacity may lag the evidenced hiring load.',
    new_team_buildout: 'The company may need to build a new team.',
    business_growth_hiring_pressure: 'Business growth may be creating hiring pressure.',
  }
  return text[code] ?? `Rule engine hypothesis: ${code}.`
}

function rejection(
  signalEpisodeId: string,
  reasonCode: CommercialThesisRejectionCode,
): CommercialThesisBuildResult {
  return {
    theses: [],
    rejections: [{ signalEpisodeId, reasonCode }],
  }
}

function isFutureEpisode(
  episode: CommercialThesisEpisodeInput,
  now: Date,
): boolean {
  return [episode.startedAt, episode.lastSeenAt]
    .map((value) => Date.parse(value))
    .some((value) => Number.isFinite(value) && value > now.getTime())
}

function positiveId(value: string): string | null {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized)) return null
  return BigInt(normalized) <= BigInt('9223372036854775807')
    ? BigInt(normalized).toString()
    : null
}

function validIds(values: readonly string[]): string[] {
  if (!Array.isArray(values)) return []
  const normalized = values.map(positiveId)
  if (normalized.some((value) => value === null)) return []
  return [...new Set(normalized as string[])].sort(compareIds)
}

function timestamp(value: string): string | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function hash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}

function validDistribution(value: Record<string, number>): boolean {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([key, count]) =>
      key.trim().length > 0 && Number.isFinite(count) && count >= 0)
}

function canonicalDistribution(
  value: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function uniqueText(values: readonly string[]): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
}

function compareIds(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right)
  return difference < 0 ? -1 : difference > 0 ? 1 : 0
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(parts: readonly string[]): string {
  const digest = createHash('sha256')
  for (const part of parts) digest.update(part).update('\0')
  return digest.digest('hex')
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('Commercial Thesis now must be a valid date.')
  }
  return value
}
