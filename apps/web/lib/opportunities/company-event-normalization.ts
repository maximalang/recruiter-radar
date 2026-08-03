import { createHash } from 'node:crypto'

import {
  canonicalizeVacancies,
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
  eventType: 'job_posting'
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

export function normalizeJobPostingCompanyEvents(
  sourceRecords: readonly CompanyEventSourceRecord[],
  _now = new Date(),
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

  for (const vacancy of canonicalizeVacancies([...evidencedRecords])) {
    const records = vacancy.publications
      .map((publication) => recordsById.get(publication.id))
      .filter((record): record is CompanyEventSourceRecord => Boolean(record))
      .sort(compareSourceRecords)
    const sourceRecordIds = uniqueSorted(records.map((record) => record.id))
    const evidenceIds = uniqueSorted(
      records.flatMap((record) => record.evidenceIds),
    )

    const primary = records[0]
    if (!primary) continue
    const publications = records
      .map(toPublicationDraft)
      .sort((left, right) =>
        left.sourceRecordId.localeCompare(right.sourceRecordId))

    events.push({
      organizationId: vacancy.organizationId,
      eventType: 'job_posting',
      occurredAt: earliestTimestamp(records.map((record) => record.occurredAt)),
      firstSeenAt: earliestTimestamp(records.map((record) => record.firstSeenAt)),
      lastSeenAt: latestTimestamp(records.map((record) => record.lastSeenAt)),
      sourceFamily: primary.source,
      sourceRecordId: primary.id,
      evidenceIds,
      eventFingerprint: sha256([
        'company-event-v1',
        vacancy.organizationId,
        'job_posting',
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
      publications,
    })
  }

  return {
    events: events.sort((left, right) =>
      left.eventFingerprint.localeCompare(right.eventFingerprint)),
    rejections: rejections.sort((left, right) =>
      left.sourceRecordIds.join(':').localeCompare(right.sourceRecordIds.join(':'))),
  }
}

function toPublicationDraft(
  record: CompanyEventSourceRecord,
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
      'company-event-publication-observation-v1',
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

function compareSourceRecords(
  left: CompanyEventSourceRecord,
  right: CompanyEventSourceRecord,
): number {
  return Date.parse(left.firstSeenAt) - Date.parse(right.firstSeenAt) ||
    left.id.localeCompare(right.id)
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
