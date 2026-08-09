import type { NegativeEvidenceResult } from './negative-evidence-v1'

export const SIGNAL_CONVERGENCE_VERSION = 'signal-convergence-v1' as const

export const SIGNAL_CONVERGENCE_EVENT_TYPES = [
  'leadership_change',
  'new_unit',
  'new_region',
  'hiring_acceleration',
  'senior_role_cluster',
  'vacancy_repost',
  'salary_change',
  'requirements_change',
  'role_cluster',
  'recruiter_vacancy',
] as const

export type SignalConvergenceEventType =
  typeof SIGNAL_CONVERGENCE_EVENT_TYPES[number]

export type SignalConvergenceEvent = {
  eventId: string
  type: SignalConvergenceEventType
  strength: number
  occurredAt: string
  evidenceIds: string[]
  evidenceIndependenceGroup: string | null
}

export type SignalConvergenceInput = {
  events: SignalConvergenceEvent[]
  negativeEvidence: NegativeEvidenceResult | null
  now: Date
}

export type SignalConvergenceResult = {
  featureVersion: typeof SIGNAL_CONVERGENCE_VERSION
  convergenceScore: number
  coverage: number
  confidence: number
  independentGroupCount: number
  status: 'active' | 'cooling' | 'review' | 'blocked' | 'closed'
  components: {
    coOccurrence: number
    sequence: number
    velocity: number
    recency: number
    contradiction: number
  }
  positiveReasons: string[]
  negativeReasons: string[]
  eventIds: string[]
  evidenceIds: string[]
  affirmativeEvidenceIds: string[]
  excludedFutureEventIds: string[]
}

type NormalizedEvent = SignalConvergenceEvent & {
  occurredAtMs: number
  decay: number
}

const DAY_MS = 86_400_000
const HALF_LIFE_DAYS: Record<SignalConvergenceEventType, number> = {
  leadership_change: 90,
  new_unit: 120,
  new_region: 120,
  hiring_acceleration: 45,
  senior_role_cluster: 45,
  vacancy_repost: 30,
  salary_change: 60,
  requirements_change: 60,
  role_cluster: 45,
  recruiter_vacancy: 45,
}

const EXPANSION_SEQUENCE: SignalConvergenceEventType[] = [
  'leadership_change',
  'new_unit',
  'hiring_acceleration',
  'senior_role_cluster',
]

export function buildSignalConvergence(
  rawInput: SignalConvergenceInput,
): SignalConvergenceResult {
  const now = validDate(rawInput.now)
  const normalized = normalizeEvents(rawInput.events, now)
  const events = normalized.filter((item) => item.occurredAtMs <= now.getTime())
  const future = normalized.filter((item) => item.occurredAtMs > now.getTime())
  const independentGroups = new Set(events.flatMap((item) =>
    item.evidenceIndependenceGroup === null
      ? []
      : [item.evidenceIndependenceGroup],
  ))
  const coverage = ratio(
    events.filter((item) => item.evidenceIndependenceGroup !== null).length,
    events.length,
  )
  const recency = average(events.map((item) => item.decay))
  const baseStrength = average(events.map((item) => item.strength * item.decay))
  const coOccurrence = coOccurrenceScore(events)
  const sequence = sequenceScore(events, EXPANSION_SEQUENCE)
  const velocity = round(Math.min(1, events.length / 4) * recency)
  const contradiction = rawInput.negativeEvidence === null
    ? 0
    : round(1 - rawInput.negativeEvidence.scoreMultiplier)
  const independence = Math.min(1, independentGroups.size / 2)
  const rawScore =
    (baseStrength * 0.45) +
    (coOccurrence * 0.15) +
    (sequence * 0.25) +
    (velocity * 0.1) +
    (independence * 0.05) -
    (contradiction * 0.8)
  const convergenceScore = round(clamp01(rawScore))
  const positiveReasons: string[] = []
  const negativeReasons: string[] = []

  if (sequence > 0) positiveReasons.push('EXPANSION_SEQUENCE_CONVERGENCE')
  if (coOccurrence > 0) positiveReasons.push('SIGNAL_CO_OCCURRENCE')
  if (independentGroups.size >= 2) {
    positiveReasons.push('INDEPENDENT_ORIGIN_CONVERGENCE')
  }
  if (recency < 0.2 && events.length > 0) negativeReasons.push('SIGNALS_STALE')
  if (coverage < 1 && events.length > 0) {
    negativeReasons.push('CONVERGENCE_PROVENANCE_INCOMPLETE')
  }
  if (future.length > 0) negativeReasons.push('FUTURE_EVENT_EXCLUDED')
  if (rawInput.negativeEvidence !== null) {
    negativeReasons.push(...[
      ...rawInput.negativeEvidence.confirmedReasons,
      ...rawInput.negativeEvidence.heuristicReasons,
    ].map((reason) => reason.code))
  }

  return {
    featureVersion: SIGNAL_CONVERGENCE_VERSION,
    convergenceScore,
    coverage,
    confidence: round(coverage * recency),
    independentGroupCount: independentGroups.size,
    status: convergenceStatus(rawInput.negativeEvidence, recency),
    components: {
      coOccurrence,
      sequence,
      velocity,
      recency,
      contradiction,
    },
    positiveReasons: uniqueText(positiveReasons),
    negativeReasons: uniqueText(negativeReasons),
    eventIds: ids(events.map((item) => item.eventId), 'event id'),
    evidenceIds: ids(events.flatMap((item) => item.evidenceIds)),
    affirmativeEvidenceIds: convergenceScore > 0
      ? ids(events.flatMap((item) => item.evidenceIds)) : [],
    excludedFutureEventIds: ids(future.map((item) => item.eventId), 'event id'),
  }
}

function normalizeEvents(
  input: readonly SignalConvergenceEvent[],
  now: Date,
): NormalizedEvent[] {
  const seen = new Set<string>()
  return input.map((item) => {
    const eventId = positiveId(item.eventId, 'event id')
    if (seen.has(eventId)) throw new Error(`duplicate convergence event ${eventId}`)
    seen.add(eventId)
    const occurredAt = timestamp(item.occurredAt, 'event occurred at')
    const occurredAtMs = new Date(occurredAt).getTime()
    const ageDays = Math.max(0, (now.getTime() - occurredAtMs) / DAY_MS)
    const decay = round(Math.pow(0.5, ageDays / HALF_LIFE_DAYS[item.type]))
    const independenceGroup = item.evidenceIndependenceGroup
    if (
      independenceGroup !== null &&
      !/^[a-f0-9]{64}$/.test(independenceGroup)
    ) {
      throw new Error('evidence independence group must be a sha256 hash')
    }
    return {
      eventId,
      type: item.type,
      strength: unitInterval(item.strength, 'event strength'),
      occurredAt,
      occurredAtMs,
      evidenceIds: requiredIds(item.evidenceIds),
      evidenceIndependenceGroup: independenceGroup,
      decay,
    }
  }).sort((left, right) =>
    left.occurredAtMs - right.occurredAtMs ||
    compareIds(left.eventId, right.eventId),
  )
}

function coOccurrenceScore(events: readonly NormalizedEvent[]): number {
  let independentPairs = 0
  for (let left = 0; left < events.length; left += 1) {
    for (let right = left + 1; right < events.length; right += 1) {
      const leftEvent = events[left]!
      const rightEvent = events[right]!
      const distanceDays = Math.abs(
        rightEvent.occurredAtMs - leftEvent.occurredAtMs,
      ) / DAY_MS
      if (
        distanceDays <= 30 &&
        leftEvent.evidenceIndependenceGroup !== null &&
        rightEvent.evidenceIndependenceGroup !== null &&
        leftEvent.evidenceIndependenceGroup !==
          rightEvent.evidenceIndependenceGroup
      ) independentPairs += 1
    }
  }
  return round(Math.min(1, independentPairs / 3))
}

function sequenceScore(
  events: readonly NormalizedEvent[],
  sequence: readonly SignalConvergenceEventType[],
): number {
  let sequenceIndex = 0
  let previousTime: number | null = null
  for (const item of events) {
    if (item.type !== sequence[sequenceIndex]) continue
    if (
      previousTime !== null &&
      (item.occurredAtMs - previousTime) / DAY_MS > 45
    ) {
      sequenceIndex = item.type === sequence[0] ? 1 : 0
      previousTime = sequenceIndex === 1 ? item.occurredAtMs : null
      continue
    }
    sequenceIndex += 1
    previousTime = item.occurredAtMs
    if (sequenceIndex === sequence.length) return 1
  }
  return 0
}

function convergenceStatus(
  negative: NegativeEvidenceResult | null,
  recency: number,
): SignalConvergenceResult['status'] {
  if (negative?.action === 'block') return 'blocked'
  if (negative?.action === 'close') return 'closed'
  if (negative?.action === 'review') return 'review'
  return recency < 0.35 ? 'cooling' : 'active'
}

function requiredIds(values: readonly string[]): string[] {
  const result = ids(values)
  if (result.length === 0) throw new Error('convergence evidence is required')
  return result
}

function ids(values: readonly string[], label = 'evidence id'): string[] {
  return [...new Set(values.map((value) => positiveId(value, label)))]
    .sort(compareIds)
}

function positiveId(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`)
  return value
}

function compareIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, 'en')
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error('convergence clock is invalid')
  return value
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return value
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0
  return round(values.reduce((total, value) => total + value, 0) / values.length)
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator)
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}
