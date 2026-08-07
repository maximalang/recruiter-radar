import type { QueryResult } from 'pg'

import { isCompanyEventsV1Enabled } from './config'
import {
  normalizeJobPostingCompanyEvents,
  type CompanyEventDraft,
  type CompanyEventSourceRecord,
  type CompanyEventType,
} from './company-event-normalization'

export type CompanyEventDb = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<CompanyEventDb & { release: () => void }>
}

export type NormalizeCompanyEventsOptions = {
  env?: Readonly<Record<string, string | undefined>>
  now?: Date
}

export type NormalizeCompanyEventsStats = {
  disabled: boolean
  normalized: number
  rejected: number
  persisted: number
  publicationsAttached: number
  evidenceAttached: number
}

type PersistCompanyEventResult = {
  inserted: boolean
  publicationsAttached: number
  evidenceAttached: number
}

export class CompanyEventMergeConflictError extends Error {
  constructor(organizationId: string) {
    super(`Company event publications overlap multiple events for organization ${organizationId}.`)
    this.name = 'CompanyEventMergeConflictError'
  }
}

export class CompanyEventSplitConflictError extends Error {
  constructor(organizationId: string) {
    super(
      `Company event split conflicts with immutable provenance for organization ${organizationId}.`,
    )
    this.name = 'CompanyEventSplitConflictError'
  }
}

export async function normalizeAndPersistJobPostingEvents(
  sourceRecords: readonly CompanyEventSourceRecord[],
  db: CompanyEventDb,
  options: NormalizeCompanyEventsOptions = {},
): Promise<NormalizeCompanyEventsStats> {
  if (!isCompanyEventsV1Enabled(options.env)) {
    return emptyStats(true)
  }

  const normalized = normalizeJobPostingCompanyEvents(
    sourceRecords,
    options.now,
  )
  const stats = emptyStats(false)
  stats.normalized = normalized.events.length
  stats.rejected = normalized.rejections.length

  const ownsClient = Boolean(db.connect) && !('release' in db)
  const client = ownsClient && db.connect ? await db.connect() : db
  try {
    await assertNoExistingEventSplits(normalized.events, client)
    for (const event of normalized.events) {
      const persisted = await persistCompanyEvent(event, client)
      if (persisted.inserted) stats.persisted += 1
      stats.publicationsAttached += persisted.publicationsAttached
      stats.evidenceAttached += persisted.evidenceAttached
    }
  } finally {
    if (
      ownsClient &&
      'release' in client &&
      typeof client.release === 'function'
    ) {
      client.release()
    }
  }

  return stats
}

async function persistCompanyEvent(
  event: CompanyEventDraft,
  db: CompanyEventDb,
): Promise<PersistCompanyEventResult> {
  const organizationId = positiveBigintId(event.organizationId, 'organizationId')
  const signalIds = uniqueSorted(event.publications.map((publication) =>
    positiveBigintId(publication.sourceRecordId, 'sourceRecordId')))
  const evidenceIds = event.evidenceIds.map((evidenceId) =>
    positiveBigintId(evidenceId, 'evidenceId'))

  await db.query('BEGIN')
  try {
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`company-events:v1:organization:${organizationId}`],
    )

    // One physical source observation may legitimately prove more than one
    // semantic event (for example job_posting + recruiter_vacancy). Overlap is
    // therefore constrained inside the SAME event type, never globally by
    // signal id.
    const overlap = await db.query<{ companyEventId: string }>(
      `SELECT publication.company_event_id::TEXT AS "companyEventId"
       FROM company_event_publications publication
       JOIN company_events existing_event
         ON existing_event.id = publication.company_event_id
        AND existing_event.organization_id = publication.organization_id
       WHERE publication.organization_id = $1
         AND publication.signal_id = ANY($2::BIGINT[])
         AND existing_event.event_type = $3
       FOR UPDATE OF existing_event`,
      [organizationId, signalIds, event.eventType],
    )
    const overlappingEventIds = uniqueSorted(
      overlap.rows.map((row) => row.companyEventId),
    )
    if (overlappingEventIds.length > 1) {
      throw new CompanyEventMergeConflictError(organizationId)
    }

    let companyEventId: string | null = overlappingEventIds[0] ?? null
    let inserted = false
    if (companyEventId) {
      await assertExistingEventCompatible(companyEventId, event, db)
    } else {
      companyEventId = await findCompatibleCompanyEvent(event, db)
    }
    if (!companyEventId) {
      const created = await db.query<{ id: string }>(
        `INSERT INTO company_events (
           organization_id, event_type, occurred_at, first_seen_at,
           last_seen_at, source_family, source_record_id, evidence_ids,
           event_fingerprint, confidence, payload, normalizer_version
         )
         VALUES (
           $1, $2, $3::TIMESTAMPTZ, $4::TIMESTAMPTZ, $5::TIMESTAMPTZ,
           $6, $7, $8::BIGINT[], $9, $10, $11::JSONB, $12
         )
         ON CONFLICT (event_fingerprint) DO NOTHING
         RETURNING id::TEXT AS id`,
        [
          organizationId,
          event.eventType,
          event.occurredAt,
          event.firstSeenAt,
          event.lastSeenAt,
          event.sourceFamily,
          event.sourceRecordId,
          evidenceIds,
          event.eventFingerprint,
          event.confidence,
          JSON.stringify(event.payload),
          event.normalizerVersion,
        ],
      )
      companyEventId = created.rows[0]?.id ?? null
      inserted = Boolean(companyEventId)
    }

    if (!companyEventId) {
      const existing = await db.query<{
        id: string
        organizationId: string
      }>(
        `SELECT id::TEXT AS id, organization_id::TEXT AS "organizationId"
         FROM company_events
         WHERE event_fingerprint = $1
         FOR UPDATE`,
        [event.eventFingerprint],
      )
      companyEventId = existing.rows[0]?.id ?? null
      if (!companyEventId || existing.rows[0].organizationId !== organizationId) {
        throw new Error('Company event fingerprint could not be reconciled.')
      }
    }

    await db.query(
      `UPDATE company_events
       SET
         last_seen_at = GREATEST(last_seen_at, $2::TIMESTAMPTZ),
         evidence_ids = ARRAY(
           SELECT DISTINCT evidence_id
           FROM UNNEST(evidence_ids || $3::BIGINT[]) AS evidence_id
           ORDER BY evidence_id
         ),
         confidence = CASE
           WHEN confidence IS NULL THEN $4
           WHEN $4::DOUBLE PRECISION IS NULL THEN confidence
           ELSE LEAST(confidence, $4::DOUBLE PRECISION)
         END
       WHERE id = $1`,
      [companyEventId, event.lastSeenAt, evidenceIds, event.confidence],
    )

    let publicationsAttached = 0
    for (const publication of event.publications) {
      const publicationEvidenceIds = publication.evidenceIds.map((evidenceId) =>
        positiveBigintId(evidenceId, 'publicationEvidenceId'))
      const stored = await db.query(
        `INSERT INTO company_event_publications (
           company_event_id, organization_id, signal_id, source_family,
           source_record_id, source_url, external_id, occurred_at,
           first_seen_at, last_seen_at, evidence_ids,
           publication_fingerprint, source_snapshot
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8::TIMESTAMPTZ,
           $9::TIMESTAMPTZ, $10::TIMESTAMPTZ, $11::BIGINT[], $12,
           $13::JSONB
         )
         ON CONFLICT (publication_fingerprint)
         DO NOTHING`,
        [
          companyEventId,
          organizationId,
          positiveBigintId(publication.sourceRecordId, 'sourceRecordId'),
          publication.sourceFamily,
          publication.sourceRecordId,
          publication.sourceUrl,
          publication.externalId,
          publication.occurredAt,
          publication.firstSeenAt,
          publication.lastSeenAt,
          publicationEvidenceIds,
          publication.publicationFingerprint,
          JSON.stringify(publication.sourceSnapshot),
        ],
      )
      publicationsAttached += stored.rowCount ?? 0
    }

    let evidenceAttached = 0
    for (const evidenceId of evidenceIds) {
      const stored = await db.query(
        `INSERT INTO company_event_evidence (
           company_event_id, organization_id, evidence_id
         )
         VALUES ($1, $2, $3)
         ON CONFLICT (company_event_id, evidence_id) DO NOTHING`,
        [companyEventId, organizationId, evidenceId],
      )
      evidenceAttached += stored.rowCount ?? 0
    }

    await db.query('COMMIT')
    return {
      inserted,
      publicationsAttached,
      evidenceAttached,
    }
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

type StoredPublicationIdentity = {
  companyEventId: string
  eventType: CompanyEventType
  signalId: string | null
  sourceFamily: string | null
  externalId: string | null
}

async function assertNoExistingEventSplits(
  events: readonly CompanyEventDraft[],
  db: CompanyEventDb,
): Promise<void> {
  const draftByTypedSignal = new Map<string, number>()
  events.forEach((event, draftIndex) => {
    event.publications.forEach((publication) => {
      draftByTypedSignal.set(
        typedSignalKey(
          event.eventType,
          positiveBigintId(publication.sourceRecordId, 'sourceRecordId'),
        ),
        draftIndex,
      )
    })
  })
  const signalIds = uniqueSorted(events.flatMap((event) =>
    event.publications.map((publication) =>
      positiveBigintId(publication.sourceRecordId, 'sourceRecordId'))))
  if (signalIds.length === 0) return

  const mapped = await db.query<{
    companyEventId: string
    eventType: CompanyEventType
    signalId: string
  }>(
    `SELECT DISTINCT
       publication.company_event_id::TEXT AS "companyEventId",
       event.event_type AS "eventType",
       publication.signal_id::TEXT AS "signalId"
     FROM company_event_publications publication
     JOIN company_events event
       ON event.id = publication.company_event_id
      AND event.organization_id = publication.organization_id
     WHERE publication.signal_id = ANY($1::BIGINT[])`,
    [signalIds],
  )
  const draftsByEvent = new Map<string, Set<number>>()
  for (const row of mapped.rows) {
    const draftIndex = draftByTypedSignal.get(
      typedSignalKey(row.eventType, row.signalId),
    )
    if (draftIndex === undefined) continue
    const draftIndexes = draftsByEvent.get(row.companyEventId) ?? new Set()
    draftIndexes.add(draftIndex)
    draftsByEvent.set(row.companyEventId, draftIndexes)
  }
  if ([...draftsByEvent.values()].some((drafts) => drafts.size > 1)) {
    throw new CompanyEventSplitConflictError(
      events[0]?.organizationId ?? 'unknown',
    )
  }
}

async function assertExistingEventCompatible(
  companyEventId: string,
  event: CompanyEventDraft,
  db: CompanyEventDb,
): Promise<void> {
  const stored = await loadStoredPublicationIdentities(
    `event.id = $1`,
    [companyEventId],
    db,
  )
  if (!publicationsCompatible(event, stored)) {
    throw new CompanyEventSplitConflictError(event.organizationId)
  }
}

async function findCompatibleCompanyEvent(
  event: CompanyEventDraft,
  db: CompanyEventDb,
): Promise<string | null> {
  const stored = await loadStoredPublicationIdentities(
    `event.organization_id = $1
       AND event.event_type = $2
       AND event.payload->>'matchKey' = $3`,
    [event.organizationId, event.eventType, event.payload.matchKey],
    db,
  )
  const byEvent = new Map<string, StoredPublicationIdentity[]>()
  for (const publication of stored) {
    const publications = byEvent.get(publication.companyEventId) ?? []
    publications.push(publication)
    byEvent.set(publication.companyEventId, publications)
  }
  const compatibleEventIds = [...byEvent]
    .filter(([, publications]) => publicationsCompatible(event, publications))
    .map(([companyEventId]) => companyEventId)
  if (compatibleEventIds.length > 1) {
    throw new CompanyEventMergeConflictError(event.organizationId)
  }
  return compatibleEventIds[0] ?? null
}

async function loadStoredPublicationIdentities(
  predicate: string,
  values: unknown[],
  db: CompanyEventDb,
): Promise<StoredPublicationIdentity[]> {
  const result = await db.query<StoredPublicationIdentity>(
    `SELECT
       event.id::TEXT AS "companyEventId",
       event.event_type AS "eventType",
       publication.signal_id::TEXT AS "signalId",
       publication.source_family AS "sourceFamily",
       publication.external_id AS "externalId"
     FROM company_events event
     LEFT JOIN company_event_publications publication
       ON publication.company_event_id = event.id
      AND publication.organization_id = event.organization_id
     WHERE ${predicate}
     FOR UPDATE OF event`,
    values,
  )
  return result.rows
}

function publicationsCompatible(
  event: CompanyEventDraft,
  stored: readonly StoredPublicationIdentity[],
): boolean {
  return event.publications.every((incoming) => stored.every((existing) => {
    if (existing.eventType !== event.eventType) return true
    if (existing.signalId === incoming.sourceRecordId) return true
    if (!existing.sourceFamily || !existing.externalId || !incoming.externalId) {
      return true
    }
    return normalizeIdentity(existing.sourceFamily) !==
      normalizeIdentity(incoming.sourceFamily) ||
      existing.externalId.trim() === incoming.externalId.trim()
  }))
}

function typedSignalKey(eventType: CompanyEventType, signalId: string): string {
  return `${eventType}:${signalId}`
}

function normalizeIdentity(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU')
}

function positiveBigintId(value: string, field: string): string {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new TypeError(`${field} must be a positive bigint identifier.`)
  }
  return value
}

function emptyStats(disabled: boolean): NormalizeCompanyEventsStats {
  return {
    disabled,
    normalized: 0,
    rejected: 0,
    persisted: 0,
    publicationsAttached: 0,
    evidenceAttached: 0,
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}
