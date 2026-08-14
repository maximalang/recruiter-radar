import { createHash } from 'node:crypto'

import { logEvent } from '@/lib/runtime'
import { canonicalizeOpportunityUrl } from './canonical-hash'

export const HIRING_EPISODE_ENGINE_VERSION = 'hiring-episode-v1' as const

export const HIRING_EPISODE_TYPES = [
  'vacancy_spike',
  'repeated_vacancies',
  'role_cluster',
  'new_region',
  'hiring_restart',
  'sustained_hiring',
] as const

export type HiringEpisodeType = (typeof HIRING_EPISODE_TYPES)[number]
export type HiringEpisodeStatus = 'active' | 'closed'

export interface HiringEpisodeConfig {
  vacancySpikeMinimum: number
  vacancySpikeMultiplier: number
  baselineDays: number
  activeWindowDays: number
  historyWindowDays: number
  repeatedVacancyGapDays: number
  roleClusterMinimum: number
  newRegionMinimum: number
  restartInactivityDays: number
  restartMinimum: number
  sustainedPeriodDays: number
  sustainedPeriods: number
  sustainedMinimumPerPeriod: number
  inactivityCloseDays: number
  continuationGapDays: number
}

export const DEFAULT_HIRING_EPISODE_CONFIG: Readonly<HiringEpisodeConfig> = {
  vacancySpikeMinimum: 4,
  vacancySpikeMultiplier: 2,
  baselineDays: 60,
  activeWindowDays: 14,
  historyWindowDays: 180,
  repeatedVacancyGapDays: 21,
  roleClusterMinimum: 3,
  newRegionMinimum: 2,
  restartInactivityDays: 45,
  restartMinimum: 2,
  sustainedPeriodDays: 7,
  sustainedPeriods: 3,
  sustainedMinimumPerPeriod: 2,
  inactivityCloseDays: 30,
  continuationGapDays: 30,
}

export interface HiringSignalInput {
  id: string
  organizationId: string
  signalType: string
  title: string
  region: string | null
  source: string
  sourceUrl: string | null
  externalVacancyId?: string | null
  occurredAt: string
  lastObservedAt?: string
  evidenceIds: string[]
}

export interface HiringEpisodeCandidate {
  organizationId: string
  episodeType: HiringEpisodeType
  episodeKey: string
  episodeIdentity: string
  episodeGeneration: number
  title: string
  summary: string
  startedAt: string
  lastSeenAt: string
  signalCount: number
  vacancyCount: number
  strengthScore: number
  freshnessScore: number
  evidenceHash: string
  engineVersion: typeof HIRING_EPISODE_ENGINE_VERSION
  signalIds: string[]
  evidenceIds: string[]
  metadata: Record<string, unknown>
}

interface DetectOrganizationInput {
  organizationId: string
  signals: HiringSignalInput[]
  now?: Date
}

interface CandidateFacts {
  episodeType: HiringEpisodeType
  dimension: string
  title: string
  summary: string
  signals: CanonicalVacancy[]
  strengthScore: number
  metadata: Record<string, unknown>
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface CanonicalVacancy extends HiringSignalInput {
  vacancyFingerprint: string
  publications: HiringSignalInput[]
}

export class HiringEpisodeDetectionService {
  constructor(
    private readonly config: Readonly<HiringEpisodeConfig> =
      DEFAULT_HIRING_EPISODE_CONFIG,
  ) {}

  detectOrganization(input: DetectOrganizationInput): HiringEpisodeCandidate[] {
    const now = input.now ?? new Date()
    const publications = normalizeSignals(input.signals, input.organizationId, now, this.config)
    const signals = canonicalizeVacancies(publications)
    const activeSignals = signals.filter(
      (item) => ageDays(item.occurredAt, now) <= this.config.activeWindowDays,
    )

    if (activeSignals.length === 0) return []

    const facts = [
      ...detectVacancySpike(signals, activeSignals, this.config, now),
      ...detectRepeatedVacancies(signals, activeSignals, this.config, now),
      ...detectRoleClusters(activeSignals, this.config),
      ...detectNewRegions(signals, activeSignals, this.config, now),
      ...detectHiringRestart(signals, activeSignals, this.config, now),
      ...detectSustainedHiring(signals, this.config, now),
    ]

    return facts
      .map((candidate) => buildEpisodeCandidate(input.organizationId, candidate, now, this.config))
      .sort(compareEpisodes)
  }
}

export function isEpisodeInactive(
  lastSeenAt: string,
  now = new Date(),
  config: Readonly<HiringEpisodeConfig> = DEFAULT_HIRING_EPISODE_CONFIG,
): boolean {
  const timestamp = Date.parse(lastSeenAt)
  if (!Number.isFinite(timestamp)) return true
  return now.getTime() - timestamp > config.inactivityCloseDays * DAY_MS
}

export function isEpisodeContinuation(
  latest: { status: HiringEpisodeStatus; lastSeenAt: string } | null,
  candidateLastSeenAt: string,
  config: Readonly<HiringEpisodeConfig> = DEFAULT_HIRING_EPISODE_CONFIG,
): boolean {
  if (!latest || latest.status !== 'active') return false
  const latestTimestamp = Date.parse(latest.lastSeenAt)
  const candidateTimestamp = Date.parse(candidateLastSeenAt)
  if (!Number.isFinite(latestTimestamp) || !Number.isFinite(candidateTimestamp)) {
    return false
  }
  return Math.abs(candidateTimestamp - latestTimestamp) <=
    config.continuationGapDays * DAY_MS
}

export function classifyOpportunityRoleFamily(title: string): string {
  const value = normalizeText(title)
  const rules: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['backend', ['backend', 'back-end', 'java', 'golang', 'python', 'node.js', 'php', 'бэкенд']],
    ['frontend', ['frontend', 'front-end', 'react', 'vue', 'angular', 'фронтенд']],
    ['data', ['data ', 'analyst', 'analytics', 'machine learning', 'ml ', 'данн', 'аналитик']],
    ['sales', ['sales', 'account executive', 'business development', 'продаж', 'клиент']],
    ['production', ['производств', 'manufacturing', 'станочник', 'оператор линии', 'сварщик']],
    ['finance', ['finance', 'financial', 'accountant', 'бухгалтер', 'финанс', 'аудит']],
    ['hr', ['recruit', 'talent', 'human resources', 'hr ', 'рекрут', 'подбор', 'персонал']],
    ['engineering', ['engineer', 'developer', 'software', 'devops', 'sre', 'инженер', 'разработчик']],
  ]
  return rules.find(([, keywords]) => keywords.some((keyword) => value.includes(keyword)))?.[0] ?? 'other'
}

function normalizeSignals(
  input: HiringSignalInput[],
  organizationId: string,
  now: Date,
  config: Readonly<HiringEpisodeConfig>,
): HiringSignalInput[] {
  const oldestAllowed = now.getTime() - config.historyWindowDays * DAY_MS
  const byId = new Map<string, HiringSignalInput>()

  for (const signal of input) {
    const occurredAt = Date.parse(signal.occurredAt)
    if (
      signal.organizationId !== organizationId ||
      signal.signalType !== 'job_posting' ||
      !signal.id.trim() ||
      !signal.title.trim() ||
      !Number.isFinite(occurredAt) ||
      occurredAt > now.getTime() ||
      occurredAt < oldestAllowed
    ) {
      continue
    }
    byId.set(signal.id, {
      ...signal,
      id: signal.id.trim(),
      title: signal.title.trim(),
      region: signal.region?.trim() || null,
      sourceUrl: canonicalizeOpportunityUrl(signal.sourceUrl),
      externalVacancyId: signal.externalVacancyId?.trim() || null,
      evidenceIds: uniqueSorted(signal.evidenceIds),
      occurredAt: new Date(occurredAt).toISOString(),
    })
  }

  return [...byId.values()].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.id.localeCompare(right.id),
  )
}

function detectVacancySpike(
  signals: CanonicalVacancy[],
  activeSignals: CanonicalVacancy[],
  config: Readonly<HiringEpisodeConfig>,
  now: Date,
): CandidateFacts[] {
  if (activeSignals.length < config.vacancySpikeMinimum) return []
  const baseline = signals.filter((item) => {
    const age = ageDays(item.occurredAt, now)
    return age > config.activeWindowDays && age <= config.activeWindowDays + config.baselineDays
  })
  const baselineEquivalent =
    baseline.length * (config.activeWindowDays / Math.max(config.baselineDays, 1))
  const growthMultiplier =
    baselineEquivalent > 0 ? activeSignals.length / baselineEquivalent : activeSignals.length
  if (
    baselineEquivalent > 0 &&
    growthMultiplier < config.vacancySpikeMultiplier
  ) {
    return []
  }

  return [{
    episodeType: 'vacancy_spike',
    dimension: 'all',
    title: 'Компания ускорила найм',
    summary: `За последние ${config.activeWindowDays} дней опубликовано ${activeSignals.length} вакансий.`,
    signals: activeSignals,
    strengthScore: clamp01(
      0.45 +
        Math.min(activeSignals.length / 20, 0.3) +
        Math.min(growthMultiplier / 10, 0.25),
    ),
    metadata: {
      activeWindowDays: config.activeWindowDays,
      baselineDays: config.baselineDays,
      currentCount: activeSignals.length,
      baselineCount: baseline.length,
      growthMultiplier: round(growthMultiplier),
      activityTrend: 'rising',
      roleFamilies: uniqueSorted(activeSignals.map((item) => classifyOpportunityRoleFamily(item.title))),
      regionCount: uniqueSorted(activeSignals.map((item) => item.region).filter(isString)).length,
      seniorRoleCount: activeSignals.filter((item) => isSeniorRole(item.title)).length,
      recruiterVacancyCount: activeSignals.filter((item) => isRecruiterRole(item.title)).length,
    },
  }]
}

function detectRepeatedVacancies(
  signals: CanonicalVacancy[],
  activeSignals: CanonicalVacancy[],
  config: Readonly<HiringEpisodeConfig>,
  now: Date,
): CandidateFacts[] {
  const repeated: Array<{ title: string; signals: CanonicalVacancy[] }> = []

  for (const current of activeSignals) {
    const identity = repeatedVacancyIdentity(current)
    const historical = signals.filter(
      (vacancy) =>
        repeatedVacancyIdentity(vacancy) === identity &&
        (
          ageDays(vacancy.occurredAt, now) >= config.repeatedVacancyGapDays ||
          vacancy.publications.some(
            (publication) =>
              ageDays(publication.occurredAt, now) >= config.repeatedVacancyGapDays,
          )
        ),
    )
    if (historical.length > 0) {
      repeated.push({
        title: current.title,
        signals: uniqueCanonicalVacancies([...historical, current]),
      })
    }
  }
  if (repeated.length === 0) return []

  const supportingSignals = uniqueCanonicalVacancies(repeated.flatMap((item) => item.signals))
  return [{
    episodeType: 'repeated_vacancies',
    dimension: 'all',
    title: repeated.length === 1
      ? `Повторно опубликована вакансия «${repeated[0].title}»`
      : 'Компания повторно опубликовала несколько вакансий',
    summary: `Повторно появились ${repeated.length} ранее опубликованных позиций.`,
    signals: supportingSignals,
    strengthScore: clamp01(0.5 + Math.min(repeated.length * 0.15, 0.4)),
    metadata: {
      repeatedVacancyCount: repeated.length,
      repeatedTitles: repeated.map((item) => item.title).sort(),
      seniorRoleCount: supportingSignals.filter((item) => isSeniorRole(item.title)).length,
      activityTrend: 'repeated',
    },
  }]
}

function detectRoleClusters(
  activeSignals: CanonicalVacancy[],
  config: Readonly<HiringEpisodeConfig>,
): CandidateFacts[] {
  const groups = groupBy(activeSignals, (item) => classifyOpportunityRoleFamily(item.title))
  const candidates: CandidateFacts[] = []

  for (const [family, familySignals] of groups) {
    if (family === 'other' || familySignals.length < config.roleClusterMinimum) continue
    candidates.push({
      episodeType: 'role_cluster',
      dimension: family,
      title: `Компания формирует кластер ролей «${roleFamilyLabel(family)}»`,
      summary: `Одновременно опубликовано ${familySignals.length} вакансий одной функции.`,
      signals: familySignals,
      strengthScore: clamp01(0.5 + Math.min(familySignals.length / 10, 0.5)),
      metadata: {
        roleFamily: family,
        roleFamilies: [family],
        roleCount: familySignals.length,
        seniorRoleCount: familySignals.filter((item) => isSeniorRole(item.title)).length,
      },
    })
  }
  return candidates
}

function detectNewRegions(
  signals: CanonicalVacancy[],
  activeSignals: CanonicalVacancy[],
  config: Readonly<HiringEpisodeConfig>,
  now: Date,
): CandidateFacts[] {
  const historicalRegions = new Set(
    signals
      .filter((item) => ageDays(item.occurredAt, now) > config.activeWindowDays)
      .map((item) => item.region)
      .filter(isString)
      .map(normalizeText),
  )
  if (historicalRegions.size === 0) return []

  const currentByRegion = groupBy(
    activeSignals.filter((item): item is CanonicalVacancy & { region: string } => Boolean(item.region)),
    (item) => normalizeText(item.region),
  )
  const candidates: CandidateFacts[] = []

  for (const [regionKey, regionSignals] of currentByRegion) {
    if (
      historicalRegions.has(regionKey) ||
      regionSignals.length < config.newRegionMinimum
    ) {
      continue
    }
    const region = regionSignals[0].region
    candidates.push({
      episodeType: 'new_region',
      dimension: stableDimension([regionKey]),
      title: `Компания начала найм в регионе «${region}»`,
      summary: `В доступной истории компании ранее не было вакансий в регионе «${region}».`,
      signals: regionSignals,
      strengthScore: clamp01(0.45 + Math.min(regionSignals.length / 10, 0.4)),
      metadata: {
        region,
        regionCount: 1,
        historicalRegionCount: historicalRegions.size,
        seniorRoleCount: regionSignals.filter((item) => isSeniorRole(item.title)).length,
      },
    })
  }
  return candidates
}

function detectHiringRestart(
  signals: CanonicalVacancy[],
  activeSignals: CanonicalVacancy[],
  config: Readonly<HiringEpisodeConfig>,
  now: Date,
): CandidateFacts[] {
  if (activeSignals.length < config.restartMinimum) return []
  const earliestCurrent = Math.min(...activeSignals.map((item) => Date.parse(item.occurredAt)))
  const historical = signals.filter((item) => Date.parse(item.occurredAt) < earliestCurrent)
  if (historical.length === 0) return []
  const latestHistorical = Math.max(...historical.map((item) => Date.parse(item.occurredAt)))
  const inactivityDays = (earliestCurrent - latestHistorical) / DAY_MS
  if (inactivityDays < config.restartInactivityDays) return []

  return [{
    episodeType: 'hiring_restart',
    dimension: 'all',
    title: 'Компания возобновила найм после паузы',
    summary: `Новые вакансии появились после паузы продолжительностью не менее ${Math.floor(inactivityDays)} дней.`,
    signals: activeSignals,
    strengthScore: clamp01(0.55 + Math.min(activeSignals.length / 12, 0.35)),
    metadata: {
      inactivityDays: Math.floor(inactivityDays),
      currentCount: activeSignals.length,
      activityTrend: 'restart',
      seniorRoleCount: activeSignals.filter((item) => isSeniorRole(item.title)).length,
    },
  }]
}

function detectSustainedHiring(
  signals: CanonicalVacancy[],
  config: Readonly<HiringEpisodeConfig>,
  now: Date,
): CandidateFacts[] {
  const windowDays = config.sustainedPeriodDays * config.sustainedPeriods
  const inWindow = signals.filter((item) => ageDays(item.occurredAt, now) <= windowDays)
  const counts = Array.from({ length: config.sustainedPeriods }, () => 0)

  for (const signal of inWindow) {
    const period = Math.min(
      Math.floor(ageDays(signal.occurredAt, now) / config.sustainedPeriodDays),
      config.sustainedPeriods - 1,
    )
    counts[period] += 1
  }
  if (counts.some((count) => count < config.sustainedMinimumPerPeriod)) return []

  return [{
    episodeType: 'sustained_hiring',
    dimension: 'all',
    title: 'Компания поддерживает устойчивый темп найма',
    summary: `Повышенная активность сохраняется ${config.sustainedPeriods} периода подряд.`,
    signals: inWindow,
    strengthScore: clamp01(0.55 + Math.min(inWindow.length / 20, 0.4)),
    metadata: {
      periodDays: config.sustainedPeriodDays,
      periodCounts: counts,
      currentCount: inWindow.length,
      activityTrend: 'sustained',
      seniorRoleCount: inWindow.filter((item) => isSeniorRole(item.title)).length,
    },
  }]
}

function buildEpisodeCandidate(
  organizationId: string,
  facts: CandidateFacts,
  now: Date,
  config: Readonly<HiringEpisodeConfig>,
): HiringEpisodeCandidate {
  const canonicalVacancies = uniqueCanonicalVacancies(facts.signals)
  const signals = uniqueSignals(
    canonicalVacancies.flatMap((vacancy) => vacancy.publications),
  )
  const startedAt = signals[0].occurredAt
  const lastSeenAt = signals[signals.length - 1].occurredAt
  const signalIds = signals.map((item) => item.id)
  const evidenceIds = uniqueSorted(signals.flatMap((item) => item.evidenceIds))
  const episodeDimension = stableDimension([facts.dimension])
  const episodeIdentity =
    `${organizationId}:${facts.episodeType}:${episodeDimension}`

  return {
    organizationId,
    episodeType: facts.episodeType,
    episodeKey: `${facts.episodeType}:${episodeDimension}`,
    episodeIdentity,
    episodeGeneration: 1,
    title: facts.title,
    summary: facts.summary,
    startedAt,
    lastSeenAt,
    signalCount: signalIds.length,
    vacancyCount: canonicalVacancies.length,
    strengthScore: round(clamp01(facts.strengthScore)),
    freshnessScore: round(clamp01(1 - ageDays(lastSeenAt, now) / config.activeWindowDays)),
    evidenceHash: hashEpisodeEvidence(signalIds, evidenceIds),
    engineVersion: HIRING_EPISODE_ENGINE_VERSION,
    signalIds,
    evidenceIds,
    metadata: {
      ...facts.metadata,
      episodeDimension: facts.dimension,
      publicationCount: signals.length,
      canonicalVacancyFingerprints: canonicalVacancies.map(
        (vacancy) => vacancy.vacancyFingerprint,
      ),
    },
  }
}

export function hashEpisodeEvidence(
  signalIds: string[],
  evidenceIds: string[],
): string {
  const canonical = [
    ...signalIds.map((id) => `signal:${id}`),
    ...evidenceIds.map((id) => `evidence:${id}`),
  ].sort()
  return createHash('sha256').update(canonical.join('\n')).digest('hex')
}

function stableDimension(values: string[]): string {
  const normalized = uniqueSorted(values.map(normalizeText).filter(Boolean))
  if (normalized.length === 0) return 'all'
  const readable = normalized.join('-').replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '')
  if (readable.length <= 48) return readable
  return createHash('sha256').update(normalized.join('|')).digest('hex').slice(0, 16)
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const groupKey = key(value)
    const group = groups.get(groupKey) ?? []
    group.push(value)
    groups.set(groupKey, group)
  }
  return groups
}

function uniqueSignals(signals: HiringSignalInput[]): HiringSignalInput[] {
  return [...new Map(signals.map((item) => [item.id, item])).values()].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.id.localeCompare(right.id),
  )
}

function uniqueCanonicalVacancies(vacancies: CanonicalVacancy[]): CanonicalVacancy[] {
  return [...new Map(
    vacancies.map((vacancy) => [vacancy.vacancyFingerprint, vacancy]),
  ).values()].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.vacancyFingerprint.localeCompare(right.vacancyFingerprint),
  )
}

export function canonicalizeVacancies(
  signals: HiringSignalInput[],
): CanonicalVacancy[] {
  const parent = signals.map((_, index) => index)
  const explicitIdsByProvider = signals.map(explicitIdsForSignal)
  const publicationTimes = signals.map((signal) => Date.parse(signal.occurredAt))
  const earliestPublicationByRoot = publicationTimes.map((timestamp) =>
    Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY)
  const latestPublicationByRoot = publicationTimes.map((timestamp) =>
    Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY)
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  const union = (left: number, right: number, enforcePublicationWindow: boolean) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot === rightRoot) return
    const conflictProvider = findConflictingExplicitIdProvider(
      explicitIdsByProvider[leftRoot],
      explicitIdsByProvider[rightRoot],
    )
    if (conflictProvider) {
      logEvent('canonical_vacancy.merge_rejected', {
        organizationId: signals[left].organizationId,
        provider: conflictProvider,
        reasonCode: 'conflicting_provider_external_ids',
      })
      return
    }
    if (enforcePublicationWindow) {
      const earliestPublication = Math.min(
        earliestPublicationByRoot[leftRoot],
        earliestPublicationByRoot[rightRoot],
      )
      const latestPublication = Math.max(
        latestPublicationByRoot[leftRoot],
        latestPublicationByRoot[rightRoot],
      )
      if (latestPublication - earliestPublication > VACANCY_PUBLICATION_WINDOW_MS) return
    }
    parent[rightRoot] = leftRoot
    earliestPublicationByRoot[leftRoot] = Math.min(
      earliestPublicationByRoot[leftRoot],
      earliestPublicationByRoot[rightRoot],
    )
    latestPublicationByRoot[leftRoot] = Math.max(
      latestPublicationByRoot[leftRoot],
      latestPublicationByRoot[rightRoot],
    )
    explicitIdsByProvider[leftRoot] = mergeExplicitIdsByProvider(
      explicitIdsByProvider[leftRoot],
      explicitIdsByProvider[rightRoot],
    )
  }

  signals.forEach((signal, index) => {
    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      const matchKind = vacancyPublicationMatchKind(signal, signals[otherIndex])
      if (matchKind) union(index, otherIndex, matchKind === 'fallback')
    }
  })

  const groups = new Map<number, HiringSignalInput[]>()
  signals.forEach((signal, index) => {
    const root = find(index)
    const publications = groups.get(root) ?? []
    publications.push(signal)
    groups.set(root, publications)
  })

  const canonical = [...groups.values()].map((publications) =>
    buildCanonicalVacancy(publications, canonicalVacancyIdentity(publications)))

  return canonical.sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.vacancyFingerprint.localeCompare(right.vacancyFingerprint),
  )
}

type ExplicitIdsByProvider = Map<string, Set<string>>

function explicitIdsForSignal(signal: HiringSignalInput): ExplicitIdsByProvider {
  if (!signal.externalVacancyId) return new Map()
  return new Map([[
    normalizeText(signal.source),
    new Set([normalizeExternalVacancyId(signal.externalVacancyId)]),
  ]])
}

function findConflictingExplicitIdProvider(
  left: ExplicitIdsByProvider,
  right: ExplicitIdsByProvider,
): string | null {
  for (const [provider, leftIds] of left) {
    const rightIds = right.get(provider)
    if (!rightIds) continue
    if (new Set([...leftIds, ...rightIds]).size > 1) return provider
  }
  return null
}

function mergeExplicitIdsByProvider(
  left: ExplicitIdsByProvider,
  right: ExplicitIdsByProvider,
): ExplicitIdsByProvider {
  const merged = new Map(
    [...left].map(([provider, ids]) => [provider, new Set(ids)]),
  )
  for (const [provider, ids] of right) {
    merged.set(provider, new Set([...(merged.get(provider) ?? []), ...ids]))
  }
  return merged
}

function buildCanonicalVacancy(
  publications: HiringSignalInput[],
  identity: string,
): CanonicalVacancy {
  const sorted = uniqueSignals(publications)
  const latest = sorted[sorted.length - 1]
  return {
    ...latest,
    vacancyFingerprint: createHash('sha256').update(identity).digest('hex'),
    publications: sorted,
    evidenceIds: uniqueSorted(sorted.flatMap((publication) => publication.evidenceIds)),
  }
}

function explicitVacancyIdentity(signal: HiringSignalInput): string | null {
  if (signal.externalVacancyId) {
    return `external:${normalizeText(signal.source)}:${normalizeExternalVacancyId(signal.externalVacancyId)}`
  }
  const canonicalUrl = canonicalVacancyUrl(signal.sourceUrl)
  return canonicalUrl ? `url:${canonicalUrl}` : null
}

function vacancyPublicationMatchKind(
  left: HiringSignalInput,
  right: HiringSignalInput,
): 'explicit' | 'url' | 'fallback' | null {
  const leftExplicit = explicitVacancyIdentity(left)
  const rightExplicit = explicitVacancyIdentity(right)
  if (leftExplicit && leftExplicit === rightExplicit) return 'explicit'
  const leftUrl = canonicalVacancyUrl(left.sourceUrl)
  const rightUrl = canonicalVacancyUrl(right.sourceUrl)
  if (leftUrl && leftUrl === rightUrl) return 'url'
  if (fallbackVacancyFingerprint(left) !== fallbackVacancyFingerprint(right)) {
    return null
  }
  if (!withinPublicationWindow(left.occurredAt, right.occurredAt)) return null
  const conflictingSameSourceIds =
    normalizeText(left.source) === normalizeText(right.source) &&
    Boolean(left.externalVacancyId) &&
    Boolean(right.externalVacancyId) &&
    normalizeExternalVacancyId(left.externalVacancyId ?? '') !==
      normalizeExternalVacancyId(right.externalVacancyId ?? '')
  return conflictingSameSourceIds ? null : 'fallback'
}

function canonicalVacancyIdentity(publications: HiringSignalInput[]): string {
  const externalIds = uniqueSorted(publications.flatMap((publication) =>
    publication.externalVacancyId
      ? [`${normalizeText(publication.source)}:${normalizeExternalVacancyId(publication.externalVacancyId)}`]
      : [],
  ))
  if (externalIds.length === 1) return `external:${externalIds[0]}`

  const urls = uniqueSorted(publications.flatMap((publication) => {
    const url = canonicalVacancyUrl(publication.sourceUrl)
    return url ? [url] : []
  }))
  if (urls.length === 1) return `url:${urls[0]}`

  const fallbacks = uniqueSorted(publications.map(fallbackVacancyFingerprint))
  const firstPublication = [...publications]
    .map((publication) => Date.parse(publication.occurredAt))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0]
  const windowAnchor = typeof firstPublication === 'number' && Number.isFinite(firstPublication)
    ? new Date(firstPublication).toISOString().slice(0, 10)
    : 'unknown'
  return `fallback:${fallbacks.join('||')}:window:${windowAnchor}`
}

function fallbackVacancyFingerprint(signal: HiringSignalInput): string {
  return [
    signal.organizationId,
    normalizeRoleTitle(signal.title),
    normalizeRoleTitle(signal.region ?? ''),
  ].join('|')
}

const VACANCY_PUBLICATION_WINDOW_MS = 21 * DAY_MS

function withinPublicationWindow(left: string, right: string): boolean {
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime)
    && Number.isFinite(rightTime)
    && Math.abs(leftTime - rightTime) <= VACANCY_PUBLICATION_WINDOW_MS
}

function canonicalVacancyUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['ref', 'from', 'source', 'campaign'].includes(key.toLowerCase())) {
        url.searchParams.delete(key)
      }
    }
    url.searchParams.sort()
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return null
  }
}

function repeatedVacancyIdentity(signal: HiringSignalInput): string {
  return `role:${fallbackVacancyFingerprint(signal)}`
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function normalizeRoleTitle(value: string): string {
  return normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU')
}

function normalizeExternalVacancyId(value: string): string {
  return value.trim()
}

function ageDays(timestamp: string, now: Date): number {
  return Math.max(0, (now.getTime() - Date.parse(timestamp)) / DAY_MS)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}

function isString(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0
}

function isSeniorRole(title: string): boolean {
  return [
    'senior',
    'lead',
    'head',
    'director',
    'chief',
    'руководитель',
    'директор',
    'главный',
    'ведущий',
  ].some((keyword) => normalizeText(title).includes(keyword))
}

function isRecruiterRole(title: string): boolean {
  return ['recruit', 'talent acquisition', 'рекрут', 'подбор персонала'].some((keyword) =>
    normalizeText(title).includes(keyword),
  )
}

function roleFamilyLabel(family: string): string {
  const labels: Record<string, string> = {
    backend: 'backend',
    frontend: 'frontend',
    data: 'data',
    sales: 'продажи',
    engineering: 'инженерия',
    production: 'производство',
    finance: 'финансы',
    hr: 'HR',
  }
  return labels[family] ?? family
}

function compareEpisodes(left: HiringEpisodeCandidate, right: HiringEpisodeCandidate): number {
  return (
    HIRING_EPISODE_TYPES.indexOf(left.episodeType) -
      HIRING_EPISODE_TYPES.indexOf(right.episodeType) ||
    left.episodeKey.localeCompare(right.episodeKey)
  )
}
