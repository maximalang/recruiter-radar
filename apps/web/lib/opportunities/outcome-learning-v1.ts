export const OUTCOME_LEARNING_VERSION = 'outcome-learning-v1' as const

export const OUTCOME_LEARNING_TYPES = [
  'shown',
  'accepted',
  'contacted',
  'replied',
  'meeting',
  'proposal',
  'won',
  'lost',
] as const

export type OutcomeLearningType = typeof OUTCOME_LEARNING_TYPES[number]

export type OutcomeLearningEvent = {
  eventId: string
  type: OutcomeLearningType
  occurredAt: string
  reasonCode: string | null
  effective: boolean
}

export type OutcomeLearningCandidate = {
  candidateId: string
  opportunityId: string
  lineageId: string
  workspaceId: string
  agencyProfileKey: string
  episodeType: string
  archetypes: string[]
  queryPlanKeys: string[]
  caseSimilarity: number | null
  score: number
  shownAt: string
  outcomes: OutcomeLearningEvent[]
}

export type OutcomeLearningMetric = {
  numerator: number
  denominator: number
  rate: number | null
}

export type OutcomeLearningSlice = {
  key: string
  sampleCount: number
  accepted: number
  replied: number
  meetings: number
  won: number
}

export type OutcomeLearningResult = {
  featureVersion: typeof OUTCOME_LEARNING_VERSION
  workspaceId: string
  sampleCount: number
  candidateIds: string[]
  excludedFutureOutcomeCount: number
  excludedCorrectedOutcomeCount: number
  excludedFutureCandidateCount: number
  funnel: Record<OutcomeLearningType, OutcomeLearningMetric> & {
    noReplyMatured: OutcomeLearningMetric
  }
  lostReasons: Array<{ reasonCode: string; count: number }>
  slices: {
    episodeType: OutcomeLearningSlice[]
    archetype: OutcomeLearningSlice[]
    queryPlan: OutcomeLearningSlice[]
    caseSimilarityBand: OutcomeLearningSlice[]
    scoreDecile: OutcomeLearningSlice[]
  }
  learningStatus: 'insufficient_data' | 'shadow_review_ready'
  shadowRecommendations: Array<{
    dimension: string
    key: string
    reasonCode: string
  }>
  automaticWeightUpdates: false
  modelType: 'analytics_only'
}

type NormalizedCandidate = Omit<OutcomeLearningCandidate, 'outcomes'> & {
  shownAtMs: number
  outcomes: Array<OutcomeLearningEvent & { occurredAtMs: number }>
}

const DAY_MS = 86_400_000
const DEFAULT_REPLY_MATURITY_DAYS = 21
const MINIMUM_SHADOW_SAMPLE = 30
const MINIMUM_MATURE_OUTCOMES = 10

export function buildOutcomeLearningV1(input: {
  workspaceId: string
  candidates: OutcomeLearningCandidate[]
  now: Date
  replyMaturityDays?: number
}): OutcomeLearningResult {
  const workspaceId = positiveId(input.workspaceId, 'workspace id')
  const now = validDate(input.now)
  const maturityDays = positiveInteger(
    input.replyMaturityDays ?? DEFAULT_REPLY_MATURITY_DAYS,
    'reply maturity days',
  )
  const all = input.candidates.map(normalizeCandidate)
  const workspaceScoped = all.filter((item) => item.workspaceId === workspaceId)
  const scoped = workspaceScoped.filter((item) => item.shownAtMs <= now.getTime())
    .sort((left, right) => compareIds(left.candidateId, right.candidateId))
  if (new Set(scoped.map((item) => item.candidateId)).size !== scoped.length) {
    throw new Error('duplicate candidate outcome lineage')
  }
  const futureCount = scoped.reduce((total, item) => total +
    item.outcomes.filter((event) => event.occurredAtMs > now.getTime()).length, 0)
  const correctedCount = scoped.reduce((total, item) => total +
    item.outcomes.filter((event) => !event.effective).length, 0)
  const historical = scoped.map((item) => ({
    ...item,
    outcomes: item.outcomes.filter((event) =>
      event.effective && event.occurredAtMs <= now.getTime()),
  }))
  const funnel = Object.fromEntries(OUTCOME_LEARNING_TYPES.map((type) => [
    type,
    rate(
      historical.filter((item) => hasOutcome(item, type)).length,
      historical.length,
    ),
  ])) as Record<OutcomeLearningType, OutcomeLearningMetric>
  const contactedMatured = historical.filter((item) => {
    const contactedAt = firstOutcomeAt(item, 'contacted')
    return contactedAt !== null &&
      now.getTime() - contactedAt >= maturityDays * DAY_MS
  })
  const noReplyMatured = rate(
    contactedMatured.filter((item) => !hasOutcome(item, 'replied')).length,
    contactedMatured.length,
  )
  const lostReasons = countText(historical.flatMap((item) =>
    item.outcomes
      .filter((event) => event.type === 'lost' && event.reasonCode !== null)
      .map((event) => event.reasonCode as string),
  )).map(({ key, count }) => ({ reasonCode: key, count }))
  const slices = {
    episodeType: buildSlices(historical.flatMap((item) => [{
      key: item.episodeType,
      item,
    }])),
    archetype: buildSlices(historical.flatMap((item) =>
      item.archetypes.map((key) => ({ key, item })))),
    queryPlan: buildSlices(historical.flatMap((item) =>
      item.queryPlanKeys.map((key) => ({ key, item })))),
    caseSimilarityBand: buildSlices(historical.map((item) => ({
      key: caseSimilarityBand(item.caseSimilarity),
      item,
    }))),
    scoreDecile: buildSlices(historical.map((item) => ({
      key: `decile_${Math.min(9, Math.floor(item.score * 10))}`,
      item,
    }))),
  }
  const matureOutcomes = historical.filter((item) =>
    hasOutcome(item, 'replied') || hasOutcome(item, 'meeting') ||
    hasOutcome(item, 'proposal') || hasOutcome(item, 'won') ||
    hasOutcome(item, 'lost'),
  ).length
  const learningStatus = historical.length >= MINIMUM_SHADOW_SAMPLE &&
    matureOutcomes >= MINIMUM_MATURE_OUTCOMES
    ? 'shadow_review_ready'
    : 'insufficient_data'

  return {
    featureVersion: OUTCOME_LEARNING_VERSION,
    workspaceId,
    sampleCount: historical.length,
    candidateIds: historical.map((item) => item.candidateId),
    excludedFutureOutcomeCount: futureCount,
    excludedCorrectedOutcomeCount: correctedCount,
    excludedFutureCandidateCount: workspaceScoped.length - scoped.length,
    funnel: { ...funnel, noReplyMatured },
    lostReasons,
    slices,
    learningStatus,
    shadowRecommendations: learningStatus === 'shadow_review_ready'
      ? buildShadowRecommendations(slices)
      : [],
    automaticWeightUpdates: false,
    modelType: 'analytics_only',
  }
}

function normalizeCandidate(input: OutcomeLearningCandidate): NormalizedCandidate {
  const shownAt = timestamp(input.shownAt, 'shown at')
  const outcomes = input.outcomes.map((event) => {
    if (!OUTCOME_LEARNING_TYPES.includes(event.type)) {
      throw new Error('outcome type is invalid')
    }
    if (event.type === 'lost' && event.reasonCode === null) {
      throw new Error('lost outcome reason code is required')
    }
    return {
      eventId: positiveId(event.eventId, 'outcome event id'),
      type: event.type,
      occurredAt: timestamp(event.occurredAt, 'outcome occurred at'),
      occurredAtMs: Date.parse(event.occurredAt),
      reasonCode: event.reasonCode === null
        ? null
        : identifier(event.reasonCode, 'outcome reason code'),
      effective: event.effective === true,
    }
  }).sort((left, right) =>
    left.occurredAtMs - right.occurredAtMs ||
    left.type.localeCompare(right.type, 'en'),
  )
  if (new Set(outcomes.map((event) => event.eventId)).size !== outcomes.length) {
    throw new Error('duplicate outcome event lineage')
  }
  if (outcomes.some((event) => event.occurredAtMs < Date.parse(shownAt))) {
    throw new Error('outcome cannot precede shown lineage')
  }
  return {
    candidateId: positiveId(input.candidateId, 'candidate id'),
    opportunityId: positiveId(input.opportunityId, 'opportunity id'),
    lineageId: positiveId(input.lineageId, 'lineage id'),
    workspaceId: positiveId(input.workspaceId, 'workspace id'),
    agencyProfileKey: identifier(input.agencyProfileKey, 'agency profile key'),
    episodeType: identifier(input.episodeType, 'episode type'),
    archetypes: uniqueText(input.archetypes.map((item) =>
      identifier(item, 'archetype'),
    )),
    queryPlanKeys: uniqueText(input.queryPlanKeys.map((item) =>
      identifier(item, 'query plan key'),
    )),
    caseSimilarity: input.caseSimilarity === null
      ? null
      : unitInterval(input.caseSimilarity, 'case similarity'),
    score: unitInterval(input.score, 'quality score'),
    shownAt,
    shownAtMs: Date.parse(shownAt),
    outcomes,
  }
}

function buildSlices(entries: Array<{
  key: string
  item: NormalizedCandidate
}>): OutcomeLearningSlice[] {
  const groups = new Map<string, NormalizedCandidate[]>()
  for (const entry of entries) {
    groups.set(entry.key, [...(groups.get(entry.key) ?? []), entry.item])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, items]) => ({
      key,
      sampleCount: items.length,
      accepted: items.filter((item) => hasOutcome(item, 'accepted')).length,
      replied: items.filter((item) => hasOutcome(item, 'replied')).length,
      meetings: items.filter((item) => hasOutcome(item, 'meeting')).length,
      won: items.filter((item) => hasOutcome(item, 'won')).length,
    }))
}

function buildShadowRecommendations(
  slices: OutcomeLearningResult['slices'],
): OutcomeLearningResult['shadowRecommendations'] {
  return Object.entries(slices).flatMap(([dimension, values]) =>
    values
      .filter((item) => item.sampleCount >= MINIMUM_MATURE_OUTCOMES)
      .map((item) => ({
        dimension,
        key: item.key,
        reasonCode: item.won > 0 || item.meetings / item.sampleCount >= 0.2
          ? 'SHADOW_REVIEW_POSSIBLE_POSITIVE_YIELD'
          : 'SHADOW_REVIEW_POSSIBLE_LOW_YIELD',
      })),
  ).sort((left, right) =>
    left.dimension.localeCompare(right.dimension, 'en') ||
    left.key.localeCompare(right.key, 'en'),
  )
}

function hasOutcome(
  input: NormalizedCandidate,
  type: OutcomeLearningType,
): boolean {
  return input.outcomes.some((event) => event.type === type)
}

function firstOutcomeAt(
  input: NormalizedCandidate,
  type: OutcomeLearningType,
): number | null {
  return input.outcomes.find((event) => event.type === type)?.occurredAtMs ?? null
}

function caseSimilarityBand(value: number | null): string {
  if (value === null) return 'unknown'
  if (value >= 0.75) return 'high'
  if (value >= 0.5) return 'medium'
  return 'low'
}

function rate(numerator: number, denominator: number): OutcomeLearningMetric {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? null : round(numerator / denominator),
  }
}

function countText(values: readonly string[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, count]) => ({ key, count }))
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error('outcome clock is invalid')
  return value
}

function positiveId(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`)
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function identifier(value: string, label: string): string {
  const normalized = value.trim()
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(normalized)) {
    throw new Error(`${label} is invalid`)
  }
  return normalized
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return value
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function compareIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, 'en')
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}
