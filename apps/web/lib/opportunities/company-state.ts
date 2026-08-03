import { createHash } from 'node:crypto'

import { classifyOpportunityRoleFamily } from './hiring-episode-detection'
import type { CompanyEventType } from './company-event-normalization'

export const COMPANY_STATE_FEATURE_VERSION = 'company-state-v1' as const

export type CompanyStateClassification =
  | 'insufficient_history'
  | 'accelerating'
  | 'steady'
  | 'slowing'

export type CompanyStateChangeType =
  | 'hiring_acceleration'
  | 'hiring_slowdown'
  | 'hiring_restart'
  | 'new_region'
  | 'role_mix_shift'

export type CompanyStateRejectionCode =
  | 'COMPANY_STATE_EVENT_FUTURE'
  | 'COMPANY_STATE_EVENT_ID_CONFLICT'
  | 'COMPANY_STATE_EVENT_INVALID'
  | 'COMPANY_STATE_EVENT_OUTSIDE_HISTORY'
  | 'COMPANY_STATE_EVIDENCE_MISSING'
  | 'COMPANY_STATE_ORGANIZATION_MISMATCH'

export interface CompanyStateEventInput {
  id: string
  organizationId: string
  eventType: CompanyEventType
  occurredAt: string
  firstSeenAt: string
  lastSeenAt: string
  eventFingerprint: string
  evidenceIds: string[]
  confidence: number | null
  payload: Readonly<Record<string, unknown>>
}

export interface BuildCompanyStateOptions {
  organizationId: string
  snapshotAt?: Date
  historyWindowDays?: number
  currentWindowDays?: number
  minimumHistoryDays?: number
  minimumHistoricalEvents?: number
}

export interface CompanyStateSnapshotDraft {
  organizationId: string
  snapshotAt: string
  observationStartedAt: string
  observationEndedAt: string
  hiringBaseline: {
    vacancies7d: number
    vacancies14d: number
    vacancies30d: number
    medianHiringVelocityPer7d: number
    historyEventCount: number
    historyCoverageDays: number
    historicalPeriodCount: number
    sufficientHistory: boolean
    fallbackReason: 'insufficient_history' | null
  }
  currentHiringVelocity: {
    vacancies7d: number
    vacancies14d: number
    vacancies30d: number
    baselineDeviation14d: number | null
    direction: 'up' | 'steady' | 'down' | 'unknown'
  }
  roleDistribution: {
    current: Record<string, number>
    baseline: Record<string, number>
  }
  seniorityDistribution: {
    current: Record<string, number>
    baseline: Record<string, number>
  }
  regionDistribution: {
    current: Record<string, number>
    baseline: Record<string, number>
    newRegions: string[]
  }
  vacancyLifetime: {
    observedCount: number
    medianDays: number | null
  }
  repostRate: {
    supported: boolean
    observedCount: number
    repostCount: number
    rate: number | null
  }
  recruitingCapacitySignals: {
    currentRecruiterVacancies: number
    baselineRecruiterVacancies: number
  }
  businessChangeSignals: {
    current30d: Record<string, number>
  }
  stateClassification: CompanyStateClassification
  stateConfidence: number
  featureVersion: typeof COMPANY_STATE_FEATURE_VERSION
  eventIds: string[]
  evidenceIds: string[]
  evidenceHash: string
  inputHash: string
}

export interface CompanyStateChangeDraft {
  organizationId: string
  changeType: CompanyStateChangeType
  direction: 'up' | 'down' | 'new' | 'changed'
  dimension: string
  magnitude: number
  baselineDeviation: number | null
  confidence: number
  eventIds: string[]
  evidenceIds: string[]
  evidenceHash: string
  changeFingerprint: string
  featureVersion: typeof COMPANY_STATE_FEATURE_VERSION
  payload: Readonly<Record<string, unknown>>
}

export interface CompanyStateBuildResult {
  snapshot: CompanyStateSnapshotDraft | null
  changes: CompanyStateChangeDraft[]
  rejections: Array<{
    eventIds: string[]
    reasonCode: CompanyStateRejectionCode
  }>
}

type NormalizedEvent = CompanyStateEventInput & {
  occurredAt: string
  firstSeenAt: string
  lastSeenAt: string
  evidenceIds: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_HISTORY_WINDOW_DAYS = 180
const DEFAULT_CURRENT_WINDOW_DAYS = 14
const DEFAULT_MINIMUM_HISTORY_DAYS = 60
const DEFAULT_MINIMUM_HISTORICAL_EVENTS = 4

export function buildCompanyStateSnapshot(
  input: readonly CompanyStateEventInput[],
  options: BuildCompanyStateOptions,
): CompanyStateBuildResult {
  const snapshotAt = validDate(options.snapshotAt ?? new Date())
  const snapshotBucket = startOfUtcDay(snapshotAt)
  const historyWindowDays = positiveInteger(
    options.historyWindowDays,
    DEFAULT_HISTORY_WINDOW_DAYS,
  )
  const currentWindowDays = positiveInteger(
    options.currentWindowDays,
    DEFAULT_CURRENT_WINDOW_DAYS,
  )
  const minimumHistoryDays = positiveInteger(
    options.minimumHistoryDays,
    DEFAULT_MINIMUM_HISTORY_DAYS,
  )
  const minimumHistoricalEvents = positiveInteger(
    options.minimumHistoricalEvents,
    DEFAULT_MINIMUM_HISTORICAL_EVENTS,
  )
  const { events, rejections } = normalizeEvents(
    input,
    options.organizationId,
    snapshotAt,
    historyWindowDays,
  )
  if (events.length === 0) return { snapshot: null, changes: [], rejections }

  const jobPostings = events.filter((item) => item.eventType === 'job_posting')
  const current7d = inAgeWindow(jobPostings, snapshotAt, 7)
  const current14d = inAgeWindow(jobPostings, snapshotAt, 14)
  const current30d = inAgeWindow(jobPostings, snapshotAt, 30)
  const historical = jobPostings.filter(
    (item) => ageDays(item.occurredAt, snapshotAt) > currentWindowDays,
  )
  const historyCoverageDays = Math.floor(Math.max(
    0,
    ...jobPostings.map((item) => ageDays(item.occurredAt, snapshotAt)),
  ))
  const baseline7d = medianHistoricalCount(
    jobPostings,
    snapshotAt,
    7,
    currentWindowDays,
    historyCoverageDays,
  )
  const baseline14d = medianHistoricalCount(
    jobPostings,
    snapshotAt,
    14,
    currentWindowDays,
    historyCoverageDays,
  )
  const baseline30d = medianHistoricalCount(
    jobPostings,
    snapshotAt,
    30,
    currentWindowDays,
    historyCoverageDays,
  )
  const historicalPeriodCount = Math.floor(
    Math.max(historyCoverageDays - currentWindowDays, 0) / 14,
  )
  const sufficientHistory = historyCoverageDays >= minimumHistoryDays &&
    historical.length >= minimumHistoricalEvents &&
    historicalPeriodCount >= 3
  const baselineDeviation14d = sufficientHistory
    ? round((current14d.length - baseline14d) / Math.max(baseline14d, 1))
    : null
  const stateClassification = classifyState(
    current14d.length,
    baseline14d,
    baselineDeviation14d,
    sufficientHistory,
  )
  const direction = stateClassification === 'accelerating'
    ? 'up'
    : stateClassification === 'slowing'
      ? 'down'
      : stateClassification === 'steady'
        ? 'steady'
        : 'unknown'
  const stateConfidence = stateConfidenceScore(
    events,
    historyCoverageDays,
    jobPostings.length,
    sufficientHistory,
  )
  const currentRegions = regionDistribution(current14d)
  const baselineRegions = regionDistribution(historical)
  const newRegions = Object.keys(currentRegions)
    .filter((region) =>
      !Object.keys(baselineRegions).some(
        (historicalRegion) => normalizeText(historicalRegion) === normalizeText(region),
      ) && currentRegions[region] >= 2)
    .sort((left, right) => left.localeCompare(right))
  const eventIds = uniqueSorted(events.map((item) => item.id))
  const evidenceIds = uniqueSorted(events.flatMap((item) => item.evidenceIds))
  const evidenceHash = hashEvidence(eventIds, evidenceIds)
  const inputHash = sha256([
    COMPANY_STATE_FEATURE_VERSION,
    snapshotBucket.toISOString(),
    ...events.map((item) => item.eventFingerprint),
  ])
  const observationStartedAt = events[0].occurredAt
  const observationEndedAt = [...events]
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))[0]
    .lastSeenAt

  const snapshot: CompanyStateSnapshotDraft = {
    organizationId: options.organizationId,
    snapshotAt: snapshotAt.toISOString(),
    observationStartedAt,
    observationEndedAt,
    hiringBaseline: {
      vacancies7d: baseline7d,
      vacancies14d: baseline14d,
      vacancies30d: baseline30d,
      medianHiringVelocityPer7d: baseline7d,
      historyEventCount: historical.length,
      historyCoverageDays,
      historicalPeriodCount,
      sufficientHistory,
      fallbackReason: sufficientHistory ? null : 'insufficient_history',
    },
    currentHiringVelocity: {
      vacancies7d: current7d.length,
      vacancies14d: current14d.length,
      vacancies30d: current30d.length,
      baselineDeviation14d,
      direction,
    },
    roleDistribution: {
      current: distribution(current14d, (item) => roleFamily(item)),
      baseline: distribution(historical, (item) => roleFamily(item)),
    },
    seniorityDistribution: {
      current: distribution(current14d, (item) => seniority(item)),
      baseline: distribution(historical, (item) => seniority(item)),
    },
    regionDistribution: {
      current: currentRegions,
      baseline: baselineRegions,
      newRegions,
    },
    vacancyLifetime: vacancyLifetime(jobPostings),
    repostRate: repostRate(events),
    recruitingCapacitySignals: {
      currentRecruiterVacancies: current14d.filter(isRecruiterVacancy).length,
      baselineRecruiterVacancies: historical.filter(isRecruiterVacancy).length,
    },
    businessChangeSignals: {
      current30d: distribution(
        inAgeWindow(events.filter((item) => item.eventType !== 'job_posting'), snapshotAt, 30),
        (item) => item.eventType,
      ),
    },
    stateClassification,
    stateConfidence,
    featureVersion: COMPANY_STATE_FEATURE_VERSION,
    eventIds,
    evidenceIds,
    evidenceHash,
    inputHash,
  }
  const changes = sufficientHistory
    ? buildChanges(snapshot, events, current14d, historical)
    : []

  return { snapshot, changes, rejections }
}

function normalizeEvents(
  input: readonly CompanyStateEventInput[],
  organizationId: string,
  snapshotAt: Date,
  historyWindowDays: number,
): {
  events: NormalizedEvent[]
  rejections: CompanyStateBuildResult['rejections']
} {
  const byId = new Map<string, NormalizedEvent>()
  const conflictedIds = new Set<string>()
  const rejections: CompanyStateBuildResult['rejections'] = []
  for (const candidate of input) {
    const id = candidate.id.trim()
    if (conflictedIds.has(id)) {
      rejections.push({ eventIds: [id], reasonCode: 'COMPANY_STATE_EVENT_ID_CONFLICT' })
      continue
    }
    if (candidate.organizationId !== organizationId) {
      rejections.push({ eventIds: [id], reasonCode: 'COMPANY_STATE_ORGANIZATION_MISMATCH' })
      continue
    }
    if (uniqueSorted(candidate.evidenceIds).length === 0) {
      rejections.push({ eventIds: [id], reasonCode: 'COMPANY_STATE_EVIDENCE_MISSING' })
      continue
    }
    const occurredAt = Date.parse(candidate.occurredAt)
    const firstSeenAt = Date.parse(candidate.firstSeenAt)
    const lastSeenAt = Date.parse(candidate.lastSeenAt)
    if (
      !id ||
      !/^[a-f0-9]{64}$/.test(candidate.eventFingerprint) ||
      !Number.isFinite(occurredAt) ||
      !Number.isFinite(firstSeenAt) ||
      !Number.isFinite(lastSeenAt) ||
      lastSeenAt < firstSeenAt ||
      firstSeenAt < occurredAt
    ) {
      rejections.push({ eventIds: [id], reasonCode: 'COMPANY_STATE_EVENT_INVALID' })
      continue
    }
    if (occurredAt > snapshotAt.getTime() || lastSeenAt > snapshotAt.getTime()) {
      rejections.push({ eventIds: [id], reasonCode: 'COMPANY_STATE_EVENT_FUTURE' })
      continue
    }
    if ((snapshotAt.getTime() - occurredAt) / DAY_MS > historyWindowDays) {
      rejections.push({ eventIds: [id], reasonCode: 'COMPANY_STATE_EVENT_OUTSIDE_HISTORY' })
      continue
    }
    const normalized: NormalizedEvent = {
      ...candidate,
      id,
      occurredAt: new Date(occurredAt).toISOString(),
      firstSeenAt: new Date(firstSeenAt).toISOString(),
      lastSeenAt: new Date(lastSeenAt).toISOString(),
      evidenceIds: uniqueSorted(candidate.evidenceIds),
      payload: canonicalRecord(candidate.payload),
    }
    const existing = byId.get(id)
    if (existing && canonicalJson(existing) !== canonicalJson(normalized)) {
      byId.delete(id)
      conflictedIds.add(id)
      rejections.push({ eventIds: [id], reasonCode: 'COMPANY_STATE_EVENT_ID_CONFLICT' })
      continue
    }
    if (!existing) byId.set(id, normalized)
  }
  return {
    events: [...byId.values()].sort(compareEvents),
    rejections: rejections.sort((left, right) =>
      left.eventIds.join(':').localeCompare(right.eventIds.join(':')) ||
      left.reasonCode.localeCompare(right.reasonCode)),
  }
}

function buildChanges(
  snapshot: CompanyStateSnapshotDraft,
  allEvents: NormalizedEvent[],
  current: NormalizedEvent[],
  historical: NormalizedEvent[],
): CompanyStateChangeDraft[] {
  const candidates: Array<{
    changeType: CompanyStateChangeType
    direction: CompanyStateChangeDraft['direction']
    dimension: string
    magnitude: number
    baselineDeviation: number | null
    events: NormalizedEvent[]
    payload: Record<string, unknown>
  }> = []
  const deviation = snapshot.currentHiringVelocity.baselineDeviation14d
  if (snapshot.stateClassification === 'accelerating') {
    candidates.push({
      changeType: 'hiring_acceleration',
      direction: 'up',
      dimension: 'all',
      magnitude: round(
        snapshot.currentHiringVelocity.vacancies14d -
        snapshot.hiringBaseline.vacancies14d,
      ),
      baselineDeviation: deviation,
      events: [...historical, ...current],
      payload: {
        currentVacancies14d: snapshot.currentHiringVelocity.vacancies14d,
        baselineVacancies14d: snapshot.hiringBaseline.vacancies14d,
      },
    })
  }
  if (snapshot.stateClassification === 'slowing') {
    candidates.push({
      changeType: 'hiring_slowdown',
      direction: 'down',
      dimension: 'all',
      magnitude: round(
        snapshot.hiringBaseline.vacancies14d -
        snapshot.currentHiringVelocity.vacancies14d,
      ),
      baselineDeviation: deviation,
      events: [...historical, ...current],
      payload: {
        currentVacancies14d: snapshot.currentHiringVelocity.vacancies14d,
        baselineVacancies14d: snapshot.hiringBaseline.vacancies14d,
      },
    })
  }
  const restartGapDays = hiringRestartGapDays(current, historical)
  if (current.length >= 2 && restartGapDays !== null && restartGapDays >= 45) {
    candidates.push({
      changeType: 'hiring_restart',
      direction: 'up',
      dimension: 'all',
      magnitude: round(restartGapDays),
      baselineDeviation: deviation,
      events: [...historical, ...current],
      payload: { inactivityDays: Math.floor(restartGapDays) },
    })
  }
  for (const region of snapshot.regionDistribution.newRegions) {
    candidates.push({
      changeType: 'new_region',
      direction: 'new',
      dimension: region,
      magnitude: snapshot.regionDistribution.current[region],
      baselineDeviation: null,
      events: [...historical, ...current.filter((item) => eventRegion(item) === region)],
      payload: {
        region,
        currentVacancyCount: snapshot.regionDistribution.current[region],
      },
    })
  }
  const shiftedRole = dominantRoleShift(snapshot)
  if (shiftedRole) {
    candidates.push({
      changeType: 'role_mix_shift',
      direction: 'changed',
      dimension: shiftedRole,
      magnitude: snapshot.roleDistribution.current[shiftedRole],
      baselineDeviation: null,
      events: [
        ...historical,
        ...current.filter((item) => roleFamily(item) === shiftedRole),
      ],
      payload: {
        roleFamily: shiftedRole,
        currentCount: snapshot.roleDistribution.current[shiftedRole],
        baselineCount: snapshot.roleDistribution.baseline[shiftedRole] ?? 0,
      },
    })
  }

  return candidates.map((candidate) => {
    const relevant = uniqueEvents(candidate.events.length > 0 ? candidate.events : allEvents)
    const eventIds = relevant.map((item) => item.id)
    const evidenceIds = uniqueSorted(relevant.flatMap((item) => item.evidenceIds))
    return {
      organizationId: snapshot.organizationId,
      changeType: candidate.changeType,
      direction: candidate.direction,
      dimension: candidate.dimension,
      magnitude: candidate.magnitude,
      baselineDeviation: candidate.baselineDeviation,
      confidence: snapshot.stateConfidence,
      eventIds,
      evidenceIds,
      evidenceHash: hashEvidence(eventIds, evidenceIds),
      changeFingerprint: sha256([
        COMPANY_STATE_FEATURE_VERSION,
        snapshot.organizationId,
        snapshot.inputHash,
        candidate.changeType,
        normalizeText(candidate.dimension),
      ]),
      featureVersion: COMPANY_STATE_FEATURE_VERSION,
      payload: candidate.payload,
    }
  }).sort((left, right) =>
    left.changeFingerprint.localeCompare(right.changeFingerprint))
}

function classifyState(
  current: number,
  baseline: number,
  deviation: number | null,
  sufficientHistory: boolean,
): CompanyStateClassification {
  if (!sufficientHistory || deviation === null) return 'insufficient_history'
  if (current >= Math.max(2, baseline + 2) && deviation >= 0.75) {
    return 'accelerating'
  }
  if (baseline >= 2 && current <= baseline * 0.5) return 'slowing'
  return 'steady'
}

function stateConfidenceScore(
  events: readonly NormalizedEvent[],
  historyCoverageDays: number,
  sampleCount: number,
  sufficientHistory: boolean,
): number {
  const confidenceValues = events
    .map((item) => item.confidence)
    .filter((value): value is number => typeof value === 'number')
  const sourceConfidence = confidenceValues.length > 0
    ? Math.min(...confidenceValues.map(clamp01))
    : 0.5
  const coverage = clamp01(historyCoverageDays / 90)
  const sample = clamp01(sampleCount / 12)
  const calculated = Math.min(sourceConfidence, 0.2 + coverage * 0.4 + sample * 0.4)
  return round(sufficientHistory ? calculated : Math.min(calculated, 0.35))
}

function medianHistoricalCount(
  events: readonly NormalizedEvent[],
  snapshotAt: Date,
  periodDays: number,
  currentWindowDays: number,
  historyCoverageDays: number,
): number {
  const periodCount = Math.floor(
    Math.max(historyCoverageDays - currentWindowDays, 0) / periodDays,
  )
  if (periodCount === 0) return 0
  const counts = Array.from({ length: periodCount }, () => 0)
  for (const item of events) {
    const age = ageDays(item.occurredAt, snapshotAt)
    if (age <= currentWindowDays) continue
    const index = Math.floor((age - currentWindowDays) / periodDays)
    if (index >= 0 && index < counts.length) counts[index] += 1
  }
  return round(median(counts))
}

function distribution<T>(
  values: readonly T[],
  key: (value: T) => string | null,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) {
    const bucket = key(value)?.trim()
    if (!bucket) continue
    result[bucket] = (result[bucket] ?? 0) + 1
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function regionDistribution(events: readonly NormalizedEvent[]): Record<string, number> {
  return distribution(events, eventRegion)
}

function eventRegion(event: NormalizedEvent): string | null {
  const region = event.payload.region
  return typeof region === 'string' && region.trim() ? region.trim() : null
}

function eventTitle(event: NormalizedEvent): string {
  return typeof event.payload.title === 'string' ? event.payload.title.trim() : ''
}

function roleFamily(event: NormalizedEvent): string {
  return classifyOpportunityRoleFamily(eventTitle(event))
}

function seniority(event: NormalizedEvent): string {
  const title = normalizeText(eventTitle(event))
  if (
    /\b(ceo|cto|cfo|chief|director|head|vp|vice president)\b/.test(title) ||
    includesAny(title, ['директор', 'руководител'])
  ) {
    return 'executive'
  }
  if (
    /\b(lead|principal|senior|sr\.?)\b/.test(title) ||
    includesAny(title, ['ведущ', 'старш'])
  ) {
    return 'senior'
  }
  if (
    /\b(junior|jr\.?)\b/.test(title) ||
    includesAny(title, ['младш', 'стаж'])
  ) return 'junior'
  return 'unspecified'
}

function isRecruiterVacancy(event: NormalizedEvent): boolean {
  const title = normalizeText(eventTitle(event))
  return /\b(recruit|recruiter|talent acquisition|hr)\b/.test(title) ||
    includesAny(title, ['рекрут', 'подбор'])
}

function includesAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate))
}

function vacancyLifetime(events: readonly NormalizedEvent[]): {
  observedCount: number
  medianDays: number | null
} {
  const lifetimes = events
    .map((item) => (Date.parse(item.lastSeenAt) - Date.parse(item.firstSeenAt)) / DAY_MS)
    .filter((value) => Number.isFinite(value) && value >= 0)
  return {
    observedCount: lifetimes.length,
    medianDays: lifetimes.length > 0 ? round(median(lifetimes)) : null,
  }
}

function repostRate(events: readonly NormalizedEvent[]): {
  supported: boolean
  observedCount: number
  repostCount: number
  rate: number | null
} {
  const vacancyEvents = events.filter((item) =>
    item.eventType === 'job_posting' || item.eventType === 'vacancy_repost')
  const repostCount = vacancyEvents.filter((item) => item.eventType === 'vacancy_repost').length
  const supported = repostCount > 0
  return {
    supported,
    observedCount: vacancyEvents.length,
    repostCount,
    rate: supported ? round(repostCount / Math.max(vacancyEvents.length, 1)) : null,
  }
}

function dominantRoleShift(snapshot: CompanyStateSnapshotDraft): string | null {
  const currentEntries = Object.entries(snapshot.roleDistribution.current)
    .filter(([family]) => family !== 'other')
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  const [dominant] = currentEntries
  if (!dominant || dominant[1] < 3) return null
  const currentTotal = Object.values(snapshot.roleDistribution.current)
    .reduce((sum, value) => sum + value, 0)
  const baselineTotal = Object.values(snapshot.roleDistribution.baseline)
    .reduce((sum, value) => sum + value, 0)
  const currentShare = dominant[1] / Math.max(currentTotal, 1)
  const baselineShare = (snapshot.roleDistribution.baseline[dominant[0]] ?? 0) /
    Math.max(baselineTotal, 1)
  return currentShare >= 0.6 && baselineShare < 0.3 ? dominant[0] : null
}

function hiringRestartGapDays(
  current: readonly NormalizedEvent[],
  historical: readonly NormalizedEvent[],
): number | null {
  if (current.length === 0 || historical.length === 0) return null
  const earliestCurrent = Math.min(...current.map((item) => Date.parse(item.occurredAt)))
  const earlier = historical
    .map((item) => Date.parse(item.occurredAt))
    .filter((timestamp) => timestamp < earliestCurrent)
  if (earlier.length === 0) return null
  return (earliestCurrent - Math.max(...earlier)) / DAY_MS
}

function inAgeWindow<T extends { occurredAt: string }>(
  events: readonly T[],
  snapshotAt: Date,
  days: number,
): T[] {
  return events.filter((item) => {
    const age = ageDays(item.occurredAt, snapshotAt)
    return age >= 0 && age <= days
  })
}

function uniqueEvents(events: readonly NormalizedEvent[]): NormalizedEvent[] {
  return [...new Map(events.map((item) => [item.id, item])).values()]
    .sort(compareEvents)
}

function compareEvents(left: NormalizedEvent, right: NormalizedEvent): number {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
    left.id.localeCompare(right.id)
}

function hashEvidence(eventIds: readonly string[], evidenceIds: readonly string[]): string {
  return sha256([
    ...eventIds.map((id) => `event:${id}`),
    ...evidenceIds.map((id) => `evidence:${id}`),
  ].sort())
}

function sha256(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function canonicalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : {}
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ))
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('Company State snapshotAt must be a valid Date.')
  }
  return new Date(value.getTime())
}

function ageDays(timestamp: string, now: Date): number {
  return (now.getTime() - Date.parse(timestamp)) / DAY_MS
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.trunc(Number(value))
    : fallback
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
}
