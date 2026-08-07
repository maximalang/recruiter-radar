import { createHash } from 'node:crypto'

import type { CompanyEventType } from './company-event-normalization'
import type { CompanyStateChangeType } from './company-state'
import { classifyOpportunityRoleFamily } from './hiring-episode-detection'

export const SIGNAL_EPISODE_ENGINE_VERSION = 'signal-episode-v2' as const

export const SIGNAL_EPISODE_TYPES = [
  'vacancy_acceleration',
  'persistent_hiring_problem',
  'role_cluster',
  'new_region_expansion',
  'hiring_restart',
  'sustained_hiring',
  'leadership_led_expansion',
  'recruiting_capacity_gap',
  'new_unit_buildout',
  'business_expansion',
  'reactivation_window',
] as const

export type SignalEpisodeType = typeof SIGNAL_EPISODE_TYPES[number]
export type SignalEpisodeStage = 'active' | 'cooling' | 'expired'
export type SignalEpisodeDirection = 'up' | 'down' | 'new' | 'changed'

export type SignalEpisodeRejectionCode =
  | 'SIGNAL_EPISODE_CHANGE_FUTURE'
  | 'SIGNAL_EPISODE_CHANGE_ID_CONFLICT'
  | 'SIGNAL_EPISODE_CHANGE_INVALID'
  | 'SIGNAL_EPISODE_EVENT_FUTURE'
  | 'SIGNAL_EPISODE_EVENT_ID_CONFLICT'
  | 'SIGNAL_EPISODE_EVENT_INVALID'
  | 'SIGNAL_EPISODE_EVENT_MISSING'
  | 'SIGNAL_EPISODE_EVIDENCE_MISMATCH'
  | 'SIGNAL_EPISODE_EVIDENCE_MISSING'
  | 'SIGNAL_EPISODE_ORGANIZATION_MISMATCH'

export interface SignalEpisodeStateChangeInput {
  id: string
  snapshotId: string
  organizationId: string
  snapshotAt: string
  changeType: CompanyStateChangeType
  direction: 'up' | 'down' | 'new' | 'changed'
  dimension: string
  magnitude: number
  baselineDeviation: number | null
  confidence: number
  eventIds: string[]
  evidenceIds: string[]
  changeFingerprint: string
  payload: Readonly<Record<string, unknown>>
}

export interface SignalEpisodeEventInput {
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

export interface BuildSignalEpisodeInput {
  stateChanges: readonly SignalEpisodeStateChangeInput[]
  events: readonly SignalEpisodeEventInput[]
}

export interface BuildSignalEpisodeOptions {
  organizationId: string
  now?: Date
  episodeLookbackDays?: number
  continuityWindowDays?: number
  contextWindowDays?: number
}

export interface SignalEpisodeDraft {
  organizationId: string
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
  stateChangeIds: string[]
  eventIds: string[]
  evidenceIds: string[]
  evidenceHash: string
  episodeIdentity: string
  inputHash: string
  engineVersion: typeof SIGNAL_EPISODE_ENGINE_VERSION
}

export interface SignalEpisodeBuildResult {
  episodes: SignalEpisodeDraft[]
  rejections: Array<{
    stateChangeIds: string[]
    eventIds: string[]
    reasonCode: SignalEpisodeRejectionCode
  }>
}

type Rejection = SignalEpisodeBuildResult['rejections'][number]
type NormalizedChange = SignalEpisodeStateChangeInput & {
  snapshotAt: string
  eventIds: string[]
  evidenceIds: string[]
}
type NormalizedEvent = SignalEpisodeEventInput & {
  occurredAt: string
  firstSeenAt: string
  lastSeenAt: string
  evidenceIds: string[]
}

const DAY_MS = 86_400_000
const DEFAULT_EPISODE_LOOKBACK_DAYS = 90
const DEFAULT_CONTINUITY_WINDOW_DAYS = 45
const DEFAULT_CONTEXT_WINDOW_DAYS = 30
const MEANINGFUL_CHANGE_TYPES = new Set<CompanyStateChangeType>([
  'hiring_acceleration',
  'hiring_restart',
  'new_region',
  'role_mix_shift',
])
const BUSINESS_EVENT_TYPES = new Set<CompanyEventType>([
  'office_opening',
  'product_launch',
  'funding_or_investment',
  'major_contract',
])
const CONTEXT_EVENT_TYPES = new Set<CompanyEventType>([
  'vacancy_repost',
  'recruiter_vacancy',
  'leadership_change',
  'new_business_unit',
  ...BUSINESS_EVENT_TYPES,
])

export function buildSignalEpisodes(
  input: BuildSignalEpisodeInput,
  options: BuildSignalEpisodeOptions,
): SignalEpisodeBuildResult {
  const now = validDate(options.now ?? new Date())
  const organizationId = positiveId(options.organizationId)
  const rejections: Rejection[] = []
  const events = normalizeEvents(input.events, organizationId, now, rejections)
  const eventById = new Map(events.map((item) => [item.id, item]))
  const changes = normalizeChanges(
    input.stateChanges,
    organizationId,
    now,
    eventById,
    rejections,
  )
  const episodeLookbackDays = positiveInteger(
    options.episodeLookbackDays,
    DEFAULT_EPISODE_LOOKBACK_DAYS,
  )
  const continuityWindowDays = positiveInteger(
    options.continuityWindowDays,
    DEFAULT_CONTINUITY_WINDOW_DAYS,
  )
  const contextWindowDays = positiveInteger(
    options.contextWindowDays,
    DEFAULT_CONTEXT_WINDOW_DAYS,
  )
  const triggering = changes.filter((item) =>
    MEANINGFUL_CHANGE_TYPES.has(item.changeType) &&
    ageDays(item.snapshotAt, now) <= episodeLookbackDays)
  if (triggering.length === 0) return { episodes: [], rejections: sortRejections(rejections) }

  const latestTriggerAt = Math.max(
    ...triggering.map((item) => Date.parse(item.snapshotAt)),
  )
  const cluster = changes.filter((item) => {
    const distance = (latestTriggerAt - Date.parse(item.snapshotAt)) / DAY_MS
    return distance >= 0 && distance <= continuityWindowDays
  })
  const clusterTriggering = cluster.filter((item) =>
    MEANINGFUL_CHANGE_TYPES.has(item.changeType))
  if (clusterTriggering.length === 0) {
    return { episodes: [], rejections: sortRejections(rejections) }
  }

  const referencedIds = uniqueSorted(cluster.flatMap((item) => item.eventIds))
  const referencedEvents = referencedIds
    .map((id) => eventById.get(id))
    .filter((item): item is NormalizedEvent => Boolean(item))
  const contextEvents = events.filter((item) => {
    if (!CONTEXT_EVENT_TYPES.has(item.eventType)) return false
    const distance = Math.abs(latestTriggerAt - Date.parse(item.occurredAt)) / DAY_MS
    return distance <= contextWindowDays
  })
  const episodeEvents = uniqueEvents([...referencedEvents, ...contextEvents])
  const episodeType = classifyEpisode(cluster, contextEvents)
  const stateChangeIds = uniqueSorted(cluster.map((item) => item.id))
  const eventIds = uniqueSorted(episodeEvents.map((item) => item.id))
  const evidenceIds = uniqueSorted([
    ...cluster.flatMap((item) => item.evidenceIds),
    ...episodeEvents.flatMap((item) => item.evidenceIds),
  ])
  if (evidenceIds.length === 0 || eventIds.length === 0) {
    rejections.push({
      stateChangeIds,
      eventIds,
      reasonCode: 'SIGNAL_EPISODE_EVIDENCE_MISSING',
    })
    return { episodes: [], rejections: sortRejections(rejections) }
  }

  const startedAt = new Date(Math.min(
    ...clusterTriggering.map((item) => Date.parse(item.snapshotAt)),
  )).toISOString()
  const lastSeenAt = new Date(Math.max(
    ...cluster.map((item) => Date.parse(item.snapshotAt)),
    ...episodeEvents.map((item) => Date.parse(item.lastSeenAt)),
  )).toISOString()
  const validUntil = new Date(
    Date.parse(lastSeenAt) + validityDays(episodeType) * DAY_MS,
  ).toISOString()
  const stage = stageForDates(lastSeenAt, validUntil, now)
  const firstTrigger = [...clusterTriggering].sort(compareChanges)[0]
  const baselineDeviation = strongestDeviation(cluster)
  const roleFamilies = uniqueSorted([
    ...episodeEvents
      .filter(isVacancyEvent)
      .map((item) => classifyOpportunityRoleFamily(eventTitle(item))),
    ...cluster
      .filter((item) => item.changeType === 'role_mix_shift')
      .map((item) => item.dimension),
  ].filter((value) => value && value !== 'all'))
  const regions = uniqueSorted([
    ...episodeEvents.map(eventRegion).filter((value): value is string => Boolean(value)),
    ...cluster
      .filter((item) => item.changeType === 'new_region')
      .map((item) => item.dimension),
  ].filter((value) => value && value !== 'all'))
  const episodeIdentity = sha256([
    SIGNAL_EPISODE_ENGINE_VERSION,
    organizationId,
    'situation',
    firstTrigger.id,
  ])
  const evidenceHash = hashEvidence(stateChangeIds, eventIds, evidenceIds)
  const draftWithoutHash = {
    organizationId,
    episodeType,
    stage,
    startedAt,
    lastSeenAt,
    validUntil,
    intensity: episodeIntensity(cluster, episodeType),
    direction: episodeDirection(episodeType),
    baselineDeviation,
    roleFamilies,
    regions,
    seniorityDistribution: distribution(
      episodeEvents.filter(isVacancyEvent),
      seniority,
    ),
    problemHypotheses: problemHypotheses(episodeType),
    stateChangeIds,
    eventIds,
    evidenceIds,
    evidenceHash,
    episodeIdentity,
    engineVersion: SIGNAL_EPISODE_ENGINE_VERSION,
  }
  const inputHash = sha256([
    canonicalJson(draftWithoutHash),
    ...cluster.map(canonicalChangeState),
    ...episodeEvents.map(canonicalEventState),
  ])

  return {
    episodes: [{ ...draftWithoutHash, inputHash }],
    rejections: sortRejections(rejections),
  }
}

export function signalEpisodeStageAt(
  episode: Pick<SignalEpisodeDraft, 'lastSeenAt' | 'validUntil'>,
  evaluatedAt = new Date(),
): SignalEpisodeStage {
  return stageForDates(episode.lastSeenAt, episode.validUntil, validDate(evaluatedAt))
}

function stageForDates(
  lastSeenAt: string,
  validUntilAt: string,
  evaluatedAt: Date,
): SignalEpisodeStage {
  const now = evaluatedAt.getTime()
  const lastSeen = Date.parse(lastSeenAt)
  const validUntil = Date.parse(validUntilAt)
  if (!Number.isFinite(lastSeen) || !Number.isFinite(validUntil) || validUntil <= lastSeen) {
    return 'expired'
  }
  if (now >= validUntil) return 'expired'
  const coolingAt = lastSeen + (validUntil - lastSeen) * 0.75
  return now >= coolingAt ? 'cooling' : 'active'
}

function normalizeEvents(
  input: readonly SignalEpisodeEventInput[],
  organizationId: string,
  now: Date,
  rejections: Rejection[],
): NormalizedEvent[] {
  const normalized: NormalizedEvent[] = []
  for (const group of groupById(input)) {
    if (hasConflictingState(group)) {
      rejections.push({
        stateChangeIds: [],
        eventIds: [String(group[0]?.id ?? '')].filter(Boolean),
        reasonCode: 'SIGNAL_EPISODE_EVENT_ID_CONFLICT',
      })
      continue
    }
    const item = group[0]
    const eventIds = [String(item.id ?? '')].filter(Boolean)
    if (String(item.organizationId) !== organizationId) {
      rejections.push({
        stateChangeIds: [],
        eventIds,
        reasonCode: 'SIGNAL_EPISODE_ORGANIZATION_MISMATCH',
      })
      continue
    }
    const occurredAt = parseTimestamp(item.occurredAt)
    const firstSeenAt = parseTimestamp(item.firstSeenAt)
    const lastSeenAt = parseTimestamp(item.lastSeenAt)
    const evidenceIds = validIds(item.evidenceIds)
    if (
      !positiveIdOrNull(item.id) ||
      !occurredAt ||
      !firstSeenAt ||
      !lastSeenAt ||
      Date.parse(firstSeenAt) > Date.parse(lastSeenAt) ||
      !/^[a-f0-9]{64}$/i.test(item.eventFingerprint) ||
      (item.confidence !== null && !isConfidence(item.confidence))
    ) {
      rejections.push({
        stateChangeIds: [],
        eventIds,
        reasonCode: 'SIGNAL_EPISODE_EVENT_INVALID',
      })
      continue
    }
    if (Date.parse(occurredAt) > now.getTime() || Date.parse(lastSeenAt) > now.getTime()) {
      rejections.push({
        stateChangeIds: [],
        eventIds,
        reasonCode: 'SIGNAL_EPISODE_EVENT_FUTURE',
      })
      continue
    }
    if (evidenceIds.length === 0) {
      rejections.push({
        stateChangeIds: [],
        eventIds,
        reasonCode: 'SIGNAL_EPISODE_EVIDENCE_MISSING',
      })
      continue
    }
    normalized.push({
      ...item,
      id: positiveId(item.id),
      organizationId,
      occurredAt,
      firstSeenAt,
      lastSeenAt,
      evidenceIds,
      payload: canonicalRecord(item.payload),
    })
  }
  return normalized.sort(compareEvents)
}

function normalizeChanges(
  input: readonly SignalEpisodeStateChangeInput[],
  organizationId: string,
  now: Date,
  eventById: ReadonlyMap<string, NormalizedEvent>,
  rejections: Rejection[],
): NormalizedChange[] {
  const normalized: NormalizedChange[] = []
  for (const group of groupById(input)) {
    if (hasConflictingState(group)) {
      rejections.push({
        stateChangeIds: [String(group[0]?.id ?? '')].filter(Boolean),
        eventIds: [],
        reasonCode: 'SIGNAL_EPISODE_CHANGE_ID_CONFLICT',
      })
      continue
    }
    const item = group[0]
    const stateChangeIds = [String(item.id ?? '')].filter(Boolean)
    if (String(item.organizationId) !== organizationId) {
      rejections.push({
        stateChangeIds,
        eventIds: [],
        reasonCode: 'SIGNAL_EPISODE_ORGANIZATION_MISMATCH',
      })
      continue
    }
    const snapshotAt = parseTimestamp(item.snapshotAt)
    const eventIds = validIds(item.eventIds)
    const evidenceIds = validIds(item.evidenceIds)
    if (
      !positiveIdOrNull(item.id) ||
      !positiveIdOrNull(item.snapshotId) ||
      !snapshotAt ||
      !item.dimension?.trim() ||
      !Number.isFinite(item.magnitude) ||
      item.magnitude < 0 ||
      (item.baselineDeviation !== null && !Number.isFinite(item.baselineDeviation)) ||
      !isConfidence(item.confidence) ||
      !/^[a-f0-9]{64}$/i.test(item.changeFingerprint) ||
      eventIds.length === 0
    ) {
      rejections.push({
        stateChangeIds,
        eventIds,
        reasonCode: 'SIGNAL_EPISODE_CHANGE_INVALID',
      })
      continue
    }
    if (Date.parse(snapshotAt) > now.getTime()) {
      rejections.push({
        stateChangeIds,
        eventIds,
        reasonCode: 'SIGNAL_EPISODE_CHANGE_FUTURE',
      })
      continue
    }
    if (evidenceIds.length === 0) {
      rejections.push({
        stateChangeIds,
        eventIds,
        reasonCode: 'SIGNAL_EPISODE_EVIDENCE_MISSING',
      })
      continue
    }
    const missingEventIds = eventIds.filter((id) => !eventById.has(id))
    if (missingEventIds.length > 0) {
      rejections.push({
        stateChangeIds,
        eventIds: missingEventIds,
        reasonCode: 'SIGNAL_EPISODE_EVENT_MISSING',
      })
      continue
    }
    const linkedEvidence = new Set(
      eventIds.flatMap((id) => eventById.get(id)?.evidenceIds ?? []),
    )
    if (evidenceIds.some((id) => !linkedEvidence.has(id))) {
      rejections.push({
        stateChangeIds,
        eventIds,
        reasonCode: 'SIGNAL_EPISODE_EVIDENCE_MISMATCH',
      })
      continue
    }
    normalized.push({
      ...item,
      id: positiveId(item.id),
      snapshotId: positiveId(item.snapshotId),
      organizationId,
      snapshotAt,
      dimension: item.dimension.trim(),
      eventIds,
      evidenceIds,
      payload: canonicalRecord(item.payload),
    })
  }
  return normalized.sort(compareChanges)
}

function classifyEpisode(
  changes: readonly NormalizedChange[],
  contextEvents: readonly NormalizedEvent[],
): SignalEpisodeType {
  const acceleration = changes.filter((item) => item.changeType === 'hiring_acceleration')
  const hasAcceleration = acceleration.length > 0
  const hasRoleShift = changes.some((item) => item.changeType === 'role_mix_shift')
  const hasNewRegion = changes.some((item) => item.changeType === 'new_region')
  const hasRestart = changes.some((item) => item.changeType === 'hiring_restart')
  const hasSlowdown = changes.some((item) => item.changeType === 'hiring_slowdown')
  const hasLeadership = contextEvents.some((item) => item.eventType === 'leadership_change')
  const hasRecruiter = contextEvents.some((item) => item.eventType === 'recruiter_vacancy')
  const hasNewUnit = contextEvents.some((item) => item.eventType === 'new_business_unit')
  const hasBusinessExpansion = contextEvents.some((item) =>
    BUSINESS_EVENT_TYPES.has(item.eventType))
  const repostCount = contextEvents.filter((item) => item.eventType === 'vacancy_repost').length
  const sustained = acceleration.length >= 2 &&
    dateSpanDays(acceleration.map((item) => item.snapshotAt)) >= 14

  if (hasLeadership && (hasAcceleration || hasRoleShift)) return 'leadership_led_expansion'
  if (hasRecruiter && hasAcceleration) return 'recruiting_capacity_gap'
  if (hasNewUnit && (hasAcceleration || hasRoleShift)) return 'new_unit_buildout'
  if (hasBusinessExpansion && (hasAcceleration || hasRoleShift || hasNewRegion)) {
    return 'business_expansion'
  }
  if (hasRestart && hasSlowdown) return 'reactivation_window'
  if (repostCount >= 2 && (hasAcceleration || hasRoleShift)) {
    return 'persistent_hiring_problem'
  }
  if (sustained) return 'sustained_hiring'
  if (hasRestart) return 'hiring_restart'
  if (hasNewRegion) return 'new_region_expansion'
  if (hasRoleShift) return 'role_cluster'
  return 'vacancy_acceleration'
}

function episodeDirection(type: SignalEpisodeType): SignalEpisodeDirection {
  if (type === 'new_region_expansion') return 'new'
  if (type === 'role_cluster') return 'changed'
  return 'up'
}

function validityDays(type: SignalEpisodeType): number {
  if (type === 'sustained_hiring' || type === 'persistent_hiring_problem') return 45
  if (type === 'hiring_restart' || type === 'reactivation_window') return 30
  return 21
}

function problemHypotheses(type: SignalEpisodeType): string[] {
  const hypotheses: Record<SignalEpisodeType, string> = {
    vacancy_acceleration: 'delivery_capacity_pressure',
    persistent_hiring_problem: 'persistent_specialist_supply_gap',
    role_cluster: 'specialist_team_buildout',
    new_region_expansion: 'regional_hiring_setup',
    hiring_restart: 'renewed_hiring_demand',
    sustained_hiring: 'sustained_delivery_capacity_pressure',
    leadership_led_expansion: 'leadership_mandate_delivery_gap',
    recruiting_capacity_gap: 'internal_recruiting_capacity_gap',
    new_unit_buildout: 'new_team_buildout',
    business_expansion: 'business_growth_hiring_pressure',
    reactivation_window: 'renewed_hiring_demand',
  }
  return [hypotheses[type]]
}

function episodeIntensity(
  changes: readonly NormalizedChange[],
  type: SignalEpisodeType,
): number {
  const confidence = Math.min(...changes.map((item) => item.confidence))
  const deviation = Math.min(
    Math.max(0, ...changes.map((item) => Math.abs(item.baselineDeviation ?? 0))) / 2,
    1,
  )
  const magnitude = Math.min(Math.max(...changes.map((item) => item.magnitude)) / 5, 1)
  const combination = type === 'vacancy_acceleration' ? 0 : 1
  return round(clamp01(
    confidence * 0.35 + deviation * 0.3 + magnitude * 0.2 + combination * 0.15,
  ))
}

function strongestDeviation(changes: readonly NormalizedChange[]): number | null {
  const deviations = changes
    .map((item) => item.baselineDeviation)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((left, right) => Math.abs(right) - Math.abs(left) || right - left)
  return deviations.length > 0 ? round(deviations[0]) : null
}

function isVacancyEvent(event: NormalizedEvent): boolean {
  return [
    'job_posting',
    'vacancy_repost',
    'vacancy_salary_change',
    'vacancy_cluster',
    'recruiter_vacancy',
  ].includes(event.eventType)
}

function eventTitle(event: NormalizedEvent): string {
  return typeof event.payload.title === 'string' ? event.payload.title.trim() : ''
}

function eventRegion(event: NormalizedEvent): string | null {
  const region = event.payload.region
  return typeof region === 'string' && region.trim() ? region.trim() : null
}

function seniority(event: NormalizedEvent): string {
  const title = normalizeText(eventTitle(event))
  if (/\b(ceo|cto|cfo|chief|director|head|vp|vice president)\b/.test(title)) {
    return 'executive'
  }
  if (/\b(lead|principal|senior|sr\.?)\b/.test(title)) return 'senior'
  if (/\b(junior|jr\.?)\b/.test(title)) return 'junior'
  return 'unspecified'
}

function distribution<T>(
  values: readonly T[],
  key: (value: T) => string | null,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) {
    const bucket = key(value)?.trim()
    if (bucket) result[bucket] = (result[bucket] ?? 0) + 1
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function groupById<T extends { id: string }>(input: readonly T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const item of input) {
    const id = String(item.id ?? '')
    const group = groups.get(id) ?? []
    group.push(item)
    groups.set(id, group)
  }
  return [...groups.values()].sort((left, right) =>
    compareIds(String(left[0]?.id ?? ''), String(right[0]?.id ?? '')))
}

function hasConflictingState<T>(group: readonly T[]): boolean {
  return new Set(group.map(canonicalJson)).size > 1
}

function uniqueEvents(events: readonly NormalizedEvent[]): NormalizedEvent[] {
  return [...new Map(events.map((item) => [item.id, item])).values()]
    .sort(compareEvents)
}

function compareEvents(left: NormalizedEvent, right: NormalizedEvent): number {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
    compareIds(left.id, right.id)
}

function compareChanges(left: NormalizedChange, right: NormalizedChange): number {
  return Date.parse(left.snapshotAt) - Date.parse(right.snapshotAt) ||
    compareIds(left.id, right.id)
}

function sortRejections(rejections: readonly Rejection[]): Rejection[] {
  return [...rejections].sort((left, right) =>
    left.reasonCode.localeCompare(right.reasonCode) ||
    compareIds(left.stateChangeIds[0] ?? left.eventIds[0] ?? '0',
      right.stateChangeIds[0] ?? right.eventIds[0] ?? '0'))
}

function canonicalChangeState(change: NormalizedChange): string {
  return canonicalJson({
    ...change,
    eventIds: uniqueSorted(change.eventIds),
    evidenceIds: uniqueSorted(change.evidenceIds),
  })
}

function canonicalEventState(event: NormalizedEvent): string {
  return canonicalJson({
    ...event,
    evidenceIds: uniqueSorted(event.evidenceIds),
  })
}

function hashEvidence(
  stateChangeIds: readonly string[],
  eventIds: readonly string[],
  evidenceIds: readonly string[],
): string {
  return sha256([
    ...stateChangeIds.map((id) => `change:${id}`),
    ...eventIds.map((id) => `event:${id}`),
    ...evidenceIds.map((id) => `evidence:${id}`),
  ].sort())
}

function dateSpanDays(values: readonly string[]): number {
  if (values.length < 2) return 0
  const timestamps = values.map(Date.parse)
  return (Math.max(...timestamps) - Math.min(...timestamps)) / DAY_MS
}

function ageDays(value: string, now: Date): number {
  return (now.getTime() - Date.parse(value)) / DAY_MS
}

function parseTimestamp(value: string): string | null {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function isConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function positiveId(value: string): string {
  if (!positiveIdOrNull(value)) throw new TypeError('Signal Episode IDs must be positive bigint values.')
  return BigInt(value).toString()
}

function positiveIdOrNull(value: string): string | null {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized)) return null
  return BigInt(normalized) <= BigInt('9223372036854775807')
    ? BigInt(normalized).toString()
    : null
}

function validIds(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.some((value) => !positiveIdOrNull(value))) return []
  return uniqueSorted(values.map(positiveId))
}

function compareIds(left: string, right: string): number {
  const leftId = positiveIdOrNull(left)
  const rightId = positiveIdOrNull(right)
  if (leftId && rightId) {
    const difference = BigInt(leftId) - BigInt(rightId)
    return difference < 0 ? -1 : difference > 0 ? 1 : 0
  }
  return left.localeCompare(right)
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareIds)
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

function sha256(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('Signal Episode now must be a valid Date.')
  }
  return value
}
