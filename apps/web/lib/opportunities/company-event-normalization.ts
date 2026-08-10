import { createHash } from 'node:crypto'

import {
  canonicalizeVacancies,
  type CanonicalVacancy,
  type HiringSignalInput,
} from './hiring-episode-detection'

export const COMPANY_EVENT_TYPES = [
  'job_posting',
  'vacancy_repost',
  'vacancy_salary_change',
  'vacancy_cluster',
  'recruiter_vacancy',
  'leadership_change',
  'new_business_unit',
  'new_region',
  'office_opening',
  'product_launch',
  'funding_or_investment',
  'major_contract',
  'career_page_change',
  'hiring_restart',
  'hiring_slowdown',
] as const

export const VACANCY_REPOST_PAYLOAD_VERSION = 'vacancy-repost-v2' as const

export type CompanyEventType = typeof COMPANY_EVENT_TYPES[number]

export interface CompanyEventSourceRecord extends HiringSignalInput {
  firstSeenAt: string
  lastSeenAt: string
  payload: Readonly<Record<string, unknown>>
  confidence?: number | null
}

export interface CompanyEventPublicationDraft {
  sourceRecordId: string
  sourceFamily: string
  sourceUrl: string | null
  externalId: string | null
  occurredAt: string
  firstSeenAt: string
  lastSeenAt: string
  evidenceIds: string[]
  publicationFingerprint: string
  sourceSnapshot: Readonly<Record<string, unknown>>
}

export interface CompanyEventDraft {
  organizationId: string
  eventType: CompanyEventType
  occurredAt: string
  firstSeenAt: string
  lastSeenAt: string
  sourceFamily: string
  sourceRecordId: string
  evidenceIds: string[]
  eventFingerprint: string
  confidence: number | null
  payload: {
    title: string
    region: string | null
    matchKey: string
    [key: string]: unknown
  }
  normalizerVersion: 'company-event-normalizer-v1'
  publications: CompanyEventPublicationDraft[]
}

export type CompanyEventNormalizationRejection = {
  sourceRecordIds: string[]
  reasonCode: 'COMPANY_EVENT_EVIDENCE_MISSING'
}

export type CompanyEventNormalizationResult = {
  events: CompanyEventDraft[]
  rejections: CompanyEventNormalizationRejection[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const REPOST_MIN_GAP_DAYS = 7
const RESTART_GAP_DAYS = 45
const RECENT_WINDOW_DAYS = 14
const MATERIAL_SALARY_CHANGE = 0.1

/**
 * Normalizes raw vacancy observations and derives only events that can be
 * proven from those observations. No LLM text or inferred business facts are
 * accepted here. `job_posting` remains the atomic observation; commercial
 * meaning is created only by state/episode layers downstream.
 */
export function normalizeJobPostingCompanyEvents(
  sourceRecords: readonly CompanyEventSourceRecord[],
  now = new Date(),
): CompanyEventNormalizationResult {
  const events: CompanyEventDraft[] = []
  const rejections: CompanyEventNormalizationRejection[] = []
  const evidencedRecords = sourceRecords.filter((record) => {
    if (uniqueSorted(record.evidenceIds).length > 0) return true
    rejections.push({
      sourceRecordIds: [record.id],
      reasonCode: 'COMPANY_EVENT_EVIDENCE_MISSING',
    })
    return false
  })
  const recordsById = new Map(
    evidencedRecords.map((record) => [record.id, record]),
  )
  const vacancies = canonicalizeVacancies([...evidencedRecords])

  for (const vacancy of vacancies) {
    const records = vacancyRecords(vacancy, recordsById)
    const event = buildVacancyEvent('job_posting', vacancy, records)
    if (event) events.push(event)

    if (isRecruiterRole(vacancy.title)) {
      const recruiterEvent = buildDerivedEvent({
        eventType: 'recruiter_vacancy',
        vacancy,
        records,
        occurredAt: vacancy.occurredAt,
        firstSeenAt: earliestTimestamp(records.map((record) => record.firstSeenAt)),
        lastSeenAt: latestTimestamp(records.map((record) => record.lastSeenAt)),
        identityParts: [vacancy.vacancyFingerprint],
        payload: {
          reasonCode: 'RECRUITING_ROLE_POSTED',
        },
      })
      if (recruiterEvent) events.push(recruiterEvent)
    }
  }

  const groups = groupVacanciesByMatchKey(vacancies)
  for (const groupedVacancies of groups.values()) {
    const ordered = [...groupedVacancies].sort(compareVacancies)
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]
      const current = ordered[index]
      const previousRecords = vacancyRecords(previous, recordsById)
      const currentRecords = vacancyRecords(current, recordsById)
      if (!hasSameSourceDistinctExternalId(previousRecords, currentRecords)) {
        continue
      }
      const gapDays = daysBetween(previous.occurredAt, current.occurredAt)
      if (gapDays >= REPOST_MIN_GAP_DAYS) {
        const salaryChanged = observedSalaryChanged(previousRecords, currentRecords)
        const lifecycleClassification = classifyRepostLifecycle(
          gapDays,
          salaryChanged,
        )
        const repost = buildDerivedEvent({
          eventType: 'vacancy_repost',
          vacancy: current,
          records: uniqueRecords([...previousRecords, ...currentRecords]),
          occurredAt: current.occurredAt,
          firstSeenAt: earliestTimestamp(currentRecords.map((record) => record.firstSeenAt)),
          lastSeenAt: latestTimestamp(currentRecords.map((record) => record.lastSeenAt)),
          identityParts: [previous.vacancyFingerprint, current.vacancyFingerprint],
          payload: {
            payloadVersion: VACANCY_REPOST_PAYLOAD_VERSION,
            previousVacancyFingerprint: previous.vacancyFingerprint,
            currentVacancyFingerprint: current.vacancyFingerprint,
            intervalDays: round(gapDays),
            lifecycleClassification,
            salaryChanged,
            requirementsChanged: null,
            sourcePublicationChanged: true,
            reasonCodes: ['SAME_ROLE_REAPPEARED_WITH_NEW_SOURCE_ID'],
            repostGapDays: round(gapDays),
            reasonCode: 'SAME_ROLE_REAPPEARED_WITH_NEW_SOURCE_ID',
          },
        })
        if (repost) events.push(repost)
      }

      const salaryChange = deriveSalaryChange(
        previous,
        current,
        previousRecords,
        currentRecords,
      )
      if (salaryChange) events.push(salaryChange)
    }
  }

  events.push(...deriveVacancyClusters(vacancies, recordsById, now))
  events.push(...deriveNewRegions(vacancies, recordsById, now))
  const restart = deriveHiringRestart(vacancies, recordsById, now)
  if (restart) events.push(restart)

  return {
    events: dedupeEvents(events).sort((left, right) =>
      left.eventFingerprint.localeCompare(right.eventFingerprint)),
    rejections: rejections.sort((left, right) =>
      left.sourceRecordIds.join(':').localeCompare(right.sourceRecordIds.join(':'))),
  }
}

function classifyRepostLifecycle(
  gapDays: number,
  salaryChanged: boolean | null,
): 'meaningful' | 'routine_republication' {
  if (salaryChanged === true) return 'meaningful'
  return gapDays >= 25 && gapDays <= 35
    ? 'routine_republication'
    : 'meaningful'
}

function observedSalaryChanged(
  previousRecords: CompanyEventSourceRecord[],
  currentRecords: CompanyEventSourceRecord[],
): boolean | null {
  const previous = bestSalary(previousRecords)
  const current = bestSalary(currentRecords)
  if (!previous || !current || previous.currency !== current.currency) return null
  return previous.min !== current.min || previous.max !== current.max
}

function buildVacancyEvent(
  eventType: 'job_posting',
  vacancy: CanonicalVacancy,
  records: CompanyEventSourceRecord[],
): CompanyEventDraft | null {
  const primary = records[0]
  if (!primary) return null
  const evidenceIds = uniqueSorted(records.flatMap((record) => record.evidenceIds))
  return {
    organizationId: vacancy.organizationId,
    eventType,
    occurredAt: earliestTimestamp(records.map((record) => record.occurredAt)),
    firstSeenAt: earliestTimestamp(records.map((record) => record.firstSeenAt)),
    lastSeenAt: latestTimestamp(records.map((record) => record.lastSeenAt)),
    sourceFamily: primary.source,
    sourceRecordId: primary.id,
    evidenceIds,
    eventFingerprint: sha256([
      'company-event-v1',
      vacancy.organizationId,
      eventType,
      vacancy.vacancyFingerprint,
    ]),
    confidence: conservativeConfidence(records),
    payload: {
      title: vacancy.title.trim(),
      region: vacancy.region,
      matchKey: vacancyMatchKey(
        vacancy.organizationId,
        vacancy.title,
        vacancy.region,
      ),
    },
    normalizerVersion: 'company-event-normalizer-v1',
    publications: records
      .map((record) => toPublicationDraft(record, eventType))
      .sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId)),
  }
}

function buildDerivedEvent(input: {
  eventType: Exclude<CompanyEventType, 'job_posting'>
  vacancy: CanonicalVacancy
  records: CompanyEventSourceRecord[]
  occurredAt: string
  firstSeenAt: string
  lastSeenAt: string
  identityParts: string[]
  payload: Record<string, unknown>
}): CompanyEventDraft | null {
  const primary = input.records
    .filter((record) => Date.parse(record.occurredAt) >= Date.parse(input.occurredAt))
    .sort(compareSourceRecords)[0] ?? input.records.sort(compareSourceRecords)[0]
  if (!primary) return null
  return {
    organizationId: input.vacancy.organizationId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    firstSeenAt: input.firstSeenAt,
    lastSeenAt: input.lastSeenAt,
    sourceFamily: primary.source,
    sourceRecordId: primary.id,
    evidenceIds: uniqueSorted(input.records.flatMap((record) => record.evidenceIds)),
    eventFingerprint: sha256([
      'company-event-derived-v1',
      input.vacancy.organizationId,
      input.eventType,
      ...input.identityParts,
    ]),
    confidence: conservativeConfidence(input.records),
    payload: {
      title: input.vacancy.title.trim(),
      region: input.vacancy.region,
      matchKey: vacancyMatchKey(
        input.vacancy.organizationId,
        input.vacancy.title,
        input.vacancy.region,
      ),
      ...input.payload,
    },
    normalizerVersion: 'company-event-normalizer-v1',
    publications: input.records
      .map((record) => toPublicationDraft(record, input.eventType))
      .sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId)),
  }
}

function deriveSalaryChange(
  previous: CanonicalVacancy,
  current: CanonicalVacancy,
  previousRecords: CompanyEventSourceRecord[],
  currentRecords: CompanyEventSourceRecord[],
): CompanyEventDraft | null {
  const previousSalary = bestSalary(previousRecords)
  const currentSalary = bestSalary(currentRecords)
  if (!previousSalary || !currentSalary || previousSalary.currency !== currentSalary.currency) {
    return null
  }
  const previousMidpoint = salaryMidpoint(previousSalary)
  const currentMidpoint = salaryMidpoint(currentSalary)
  if (previousMidpoint === null || currentMidpoint === null || previousMidpoint <= 0) {
    return null
  }
  const relativeChange = (currentMidpoint - previousMidpoint) / previousMidpoint
  if (Math.abs(relativeChange) < MATERIAL_SALARY_CHANGE) return null

  return buildDerivedEvent({
    eventType: 'vacancy_salary_change',
    vacancy: current,
    records: uniqueRecords([...previousRecords, ...currentRecords]),
    occurredAt: current.occurredAt,
    firstSeenAt: earliestTimestamp(currentRecords.map((record) => record.firstSeenAt)),
    lastSeenAt: latestTimestamp(currentRecords.map((record) => record.lastSeenAt)),
    identityParts: [previous.vacancyFingerprint, current.vacancyFingerprint, 'salary'],
    payload: {
      previousSalary,
      currentSalary,
      relativeChange: round(relativeChange),
      reasonCode: relativeChange > 0
        ? 'VACANCY_SALARY_INCREASED_MATERIALLY'
        : 'VACANCY_SALARY_DECREASED_MATERIALLY',
    },
  })
}

function deriveVacancyClusters(
  vacancies: CanonicalVacancy[],
  recordsById: Map<string, CompanyEventSourceRecord>,
  now: Date,
): CompanyEventDraft[] {
  const recent = vacancies.filter((vacancy) =>
    ageDays(vacancy.occurredAt, now) <= RECENT_WINDOW_DAYS)
  const byFamily = new Map<string, CanonicalVacancy[]>()
  for (const vacancy of recent) {
    const family = roleFamily(vacancy.title)
    if (!family) continue
    const group = byFamily.get(family) ?? []
    group.push(vacancy)
    byFamily.set(family, group)
  }

  const events: CompanyEventDraft[] = []
  for (const [family, grouped] of byFamily) {
    const distinct = uniqueVacancies(grouped)
    if (distinct.length < 3) continue
    const latest = [...distinct].sort(compareVacancies).at(-1)
    if (!latest) continue
    const records = uniqueRecords(distinct.flatMap((vacancy) =>
      vacancyRecords(vacancy, recordsById)))
    const currentRecords = vacancyRecords(latest, recordsById)
    const event = buildDerivedEvent({
      eventType: 'vacancy_cluster',
      vacancy: latest,
      records,
      occurredAt: earliestTimestamp(distinct.map((vacancy) => vacancy.occurredAt)),
      firstSeenAt: earliestTimestamp(records.map((record) => record.firstSeenAt)),
      lastSeenAt: latestTimestamp(records.map((record) => record.lastSeenAt)),
      identityParts: [
        family,
        ...distinct.map((vacancy) => vacancy.vacancyFingerprint).sort(),
      ],
      payload: {
        roleFamily: family,
        vacancyCount: distinct.length,
        currentSourceRecordIds: currentRecords.map((record) => record.id).sort(),
        reasonCode: 'MULTIPLE_RELATED_ROLES_IN_RECENT_WINDOW',
      },
    })
    if (event) events.push(event)
  }
  return events
}

function deriveNewRegions(
  vacancies: CanonicalVacancy[],
  recordsById: Map<string, CompanyEventSourceRecord>,
  now: Date,
): CompanyEventDraft[] {
  const byRegion = new Map<string, CanonicalVacancy[]>()
  for (const vacancy of vacancies) {
    const region = normalizeMatchText(vacancy.region ?? '')
    if (!region || region === 'remote') continue
    const group = byRegion.get(region) ?? []
    group.push(vacancy)
    byRegion.set(region, group)
  }
  const events: CompanyEventDraft[] = []
  for (const [region, grouped] of byRegion) {
    const ordered = uniqueVacancies(grouped).sort(compareVacancies)
    const recent = ordered.filter((vacancy) =>
      ageDays(vacancy.occurredAt, now) <= RECENT_WINDOW_DAYS)
    const older = ordered.filter((vacancy) =>
      ageDays(vacancy.occurredAt, now) > RECENT_WINDOW_DAYS)
    if (recent.length < 2 || older.length > 0) continue
    const latest = recent.at(-1)
    if (!latest) continue
    const records = uniqueRecords(recent.flatMap((vacancy) =>
      vacancyRecords(vacancy, recordsById)))
    const event = buildDerivedEvent({
      eventType: 'new_region',
      vacancy: latest,
      records,
      occurredAt: earliestTimestamp(recent.map((vacancy) => vacancy.occurredAt)),
      firstSeenAt: earliestTimestamp(records.map((record) => record.firstSeenAt)),
      lastSeenAt: latestTimestamp(records.map((record) => record.lastSeenAt)),
      identityParts: [region, ...recent.map((vacancy) => vacancy.vacancyFingerprint).sort()],
      payload: {
        region: latest.region,
        vacancyCount: recent.length,
        reasonCode: 'MULTIPLE_RECENT_ROLES_IN_PREVIOUSLY_UNSEEN_REGION',
      },
    })
    if (event) events.push(event)
  }
  return events
}

function deriveHiringRestart(
  vacancies: CanonicalVacancy[],
  recordsById: Map<string, CompanyEventSourceRecord>,
  now: Date,
): CompanyEventDraft | null {
  const ordered = uniqueVacancies(vacancies).sort(compareVacancies)
  const recent = ordered.filter((vacancy) =>
    ageDays(vacancy.occurredAt, now) <= RECENT_WINDOW_DAYS)
  if (recent.length < 2) return null
  const recentStart = Date.parse(recent[0].occurredAt)
  const previous = ordered
    .filter((vacancy) => Date.parse(vacancy.occurredAt) < recentStart)
    .at(-1)
  if (!previous) return null
  const gapDays = (recentStart - Date.parse(previous.occurredAt)) / DAY_MS
  if (gapDays < RESTART_GAP_DAYS) return null
  const latest = recent.at(-1)
  if (!latest) return null
  const records = uniqueRecords([
    ...vacancyRecords(previous, recordsById),
    ...recent.flatMap((vacancy) => vacancyRecords(vacancy, recordsById)),
  ])
  const recentRecords = uniqueRecords(recent.flatMap((vacancy) =>
    vacancyRecords(vacancy, recordsById)))
  return buildDerivedEvent({
    eventType: 'hiring_restart',
    vacancy: latest,
    records,
    occurredAt: recent[0].occurredAt,
    firstSeenAt: earliestTimestamp(recentRecords.map((record) => record.firstSeenAt)),
    lastSeenAt: latestTimestamp(recentRecords.map((record) => record.lastSeenAt)),
    identityParts: [
      previous.vacancyFingerprint,
      ...recent.map((vacancy) => vacancy.vacancyFingerprint).sort(),
    ],
    payload: {
      vacancyCount: recent.length,
      precedingGapDays: round(gapDays),
      reasonCode: 'HIRING_RESUMED_AFTER_LONG_OBSERVED_GAP',
    },
  })
}

function toPublicationDraft(
  record: CompanyEventSourceRecord,
  eventType: CompanyEventType,
): CompanyEventPublicationDraft {
  const sourceSnapshot = {
    ...record.payload,
    companyEventObservation: {
      title: record.title,
      region: record.region,
      signalType: record.signalType,
      sourceUrl: record.sourceUrl,
      externalVacancyId: record.externalVacancyId ?? null,
    },
  }
  return {
    sourceRecordId: record.id,
    sourceFamily: record.source,
    sourceUrl: record.sourceUrl,
    externalId: record.externalVacancyId ?? null,
    occurredAt: record.occurredAt,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    evidenceIds: uniqueSorted(record.evidenceIds),
    publicationFingerprint: sha256([
      eventType === 'job_posting'
        ? 'company-event-publication-observation-v1'
        : 'company-event-derived-publication-v1',
      eventType,
      record.organizationId,
      record.source,
      record.id,
      record.sourceUrl ?? '',
      record.externalVacancyId ?? '',
      record.occurredAt,
      record.firstSeenAt,
      record.lastSeenAt,
      uniqueSorted(record.evidenceIds).join(','),
      canonicalJson(sourceSnapshot),
    ]),
    sourceSnapshot,
  }
}

function vacancyRecords(
  vacancy: CanonicalVacancy,
  recordsById: Map<string, CompanyEventSourceRecord>,
): CompanyEventSourceRecord[] {
  return vacancy.publications
    .map((publication) => recordsById.get(publication.id))
    .filter((record): record is CompanyEventSourceRecord => Boolean(record))
    .sort(compareSourceRecords)
}

function groupVacanciesByMatchKey(
  vacancies: CanonicalVacancy[],
): Map<string, CanonicalVacancy[]> {
  const groups = new Map<string, CanonicalVacancy[]>()
  for (const vacancy of vacancies) {
    const key = vacancyMatchKey(
      vacancy.organizationId,
      vacancy.title,
      vacancy.region,
    )
    const group = groups.get(key) ?? []
    group.push(vacancy)
    groups.set(key, group)
  }
  return groups
}

function hasSameSourceDistinctExternalId(
  previous: CompanyEventSourceRecord[],
  current: CompanyEventSourceRecord[],
): boolean {
  return previous.some((left) => current.some((right) =>
    normalizeMatchText(left.source) === normalizeMatchText(right.source) &&
    Boolean(left.externalVacancyId) &&
    Boolean(right.externalVacancyId) &&
    normalizeMatchText(left.externalVacancyId ?? '') !==
      normalizeMatchText(right.externalVacancyId ?? ''),
  ))
}

type SalarySnapshot = {
  min: number | null
  max: number | null
  currency: string
}

function bestSalary(records: CompanyEventSourceRecord[]): SalarySnapshot | null {
  const ranked = records
    .map((record) => salaryFromPayload(record.payload))
    .filter((value): value is SalarySnapshot => value !== null)
    .sort((left, right) => Number(right.min !== null) + Number(right.max !== null) -
      Number(left.min !== null) - Number(left.max !== null))
  return ranked[0] ?? null
}

function salaryFromPayload(payload: Readonly<Record<string, unknown>>): SalarySnapshot | null {
  const min = finitePositiveNumber(payload.salary_rub_min)
  const max = finitePositiveNumber(payload.salary_rub_max)
  const currency = String(payload.salary_currency ?? '').trim().toUpperCase()
  if ((!min && !max) || currency !== 'RUB') return null
  return { min, max, currency }
}

function salaryMidpoint(value: SalarySnapshot): number | null {
  if (value.min !== null && value.max !== null) return (value.min + value.max) / 2
  return value.min ?? value.max
}

function finitePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function roleFamily(title: string): string | null {
  const normalized = normalizeMatchText(title)
  const rules: Array<[string, readonly string[]]> = [
    ['hr', ['recruit', 'talent acquisition', 'рекрут', 'сорсер', 'подбор персонала', 'hr']],
    ['data', ['data', 'аналитик данных', 'дата', 'machine learning', 'ml engineer']],
    ['engineering', ['developer', 'разработ', 'программист', 'engineer', 'инженер', 'devops', 'qa']],
    ['product', ['product manager', 'продакт', 'product owner']],
    ['sales', ['sales', 'продаж', 'account manager', 'business development']],
    ['marketing', ['marketing', 'маркет', 'growth']],
    ['finance', ['финанс', 'бухгалтер', 'accountant', 'treasury']],
    ['legal', ['юрист', 'legal', 'lawyer']],
    ['operations', ['operations', 'операцион', 'project manager', 'project lead']],
    ['executive', ['chief', 'director', 'директор', 'руководитель', 'head of', 'vp ']],
  ]
  for (const [family, keywords] of rules) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return family
  }
  return null
}

function isRecruiterRole(title: string): boolean {
  const normalized = normalizeMatchText(title)
  return [
    'recruit',
    'talent acquisition',
    'рекрут',
    'сорсер',
    'подбор персонала',
  ].some((keyword) => normalized.includes(keyword))
}

function compareSourceRecords(
  left: CompanyEventSourceRecord,
  right: CompanyEventSourceRecord,
): number {
  return Date.parse(left.firstSeenAt) - Date.parse(right.firstSeenAt) ||
    left.id.localeCompare(right.id)
}

function compareVacancies(left: CanonicalVacancy, right: CanonicalVacancy): number {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
    left.vacancyFingerprint.localeCompare(right.vacancyFingerprint)
}

function earliestTimestamp(values: readonly string[]): string {
  return [...values].sort((left, right) => Date.parse(left) - Date.parse(right))[0]
}

function latestTimestamp(values: readonly string[]): string {
  return [...values].sort((left, right) => Date.parse(right) - Date.parse(left))[0]
}

function conservativeConfidence(
  records: readonly CompanyEventSourceRecord[],
): number | null {
  const values = records
    .map((record) => record.confidence)
    .filter((value): value is number => typeof value === 'number')
  return values.length > 0 ? Math.min(...values) : null
}

function sha256(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function vacancyMatchKey(
  organizationId: string,
  title: string,
  region: string | null,
): string {
  return sha256([
    'company-event-vacancy-match-v1',
    organizationId,
    normalizeMatchText(title),
    normalizeMatchText(region ?? ''),
  ])
}

function normalizeMatchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function uniqueRecords(records: readonly CompanyEventSourceRecord[]): CompanyEventSourceRecord[] {
  return [...new Map(records.map((record) => [record.id, record])).values()]
    .sort(compareSourceRecords)
}

function uniqueVacancies(vacancies: readonly CanonicalVacancy[]): CanonicalVacancy[] {
  return [...new Map(vacancies.map((vacancy) => [vacancy.vacancyFingerprint, vacancy])).values()]
}

function dedupeEvents(events: readonly CompanyEventDraft[]): CompanyEventDraft[] {
  return [...new Map(events.map((event) => [event.eventFingerprint, event])).values()]
}

function ageDays(timestamp: string, now: Date): number {
  return Math.max(0, (now.getTime() - Date.parse(timestamp)) / DAY_MS)
}

function daysBetween(left: string, right: string): number {
  return Math.max(0, (Date.parse(right) - Date.parse(left)) / DAY_MS)
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
