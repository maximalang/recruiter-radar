import type { QueryResult } from 'pg'

import type {
  CompanyStateBuildResult,
  CompanyStateChangeDraft,
  CompanyStateSnapshotDraft,
} from './company-state'

export type CompanyStateDb = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<CompanyStateDb & { release: () => void }>
}

export type CompanyStatePersistenceResult = {
  snapshotId: string | null
  snapshotInserted: boolean
  changesInserted: number
  eventsAttached: number
  evidenceAttached: number
}

export class CompanyStateProvenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompanyStateProvenanceError'
  }
}

export class CompanyStateReplayConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompanyStateReplayConflictError'
  }
}

export async function persistCompanyStateBuild(
  result: CompanyStateBuildResult,
  db: CompanyStateDb,
): Promise<CompanyStatePersistenceResult> {
  if (!result.snapshot) return emptyPersistenceResult()
  validateBuildProvenance(result.snapshot, result.changes)

  const ownsClient = Boolean(db.connect) && !('release' in db)
  const client = ownsClient && db.connect ? await db.connect() : db
  try {
    return await persistBuildTransaction(result.snapshot, result.changes, client)
  } finally {
    if (
      ownsClient &&
      'release' in client &&
      typeof client.release === 'function'
    ) {
      client.release()
    }
  }
}

async function persistBuildTransaction(
  snapshot: CompanyStateSnapshotDraft,
  changes: readonly CompanyStateChangeDraft[],
  db: CompanyStateDb,
): Promise<CompanyStatePersistenceResult> {
  const organizationId = positiveBigintId(
    snapshot.organizationId,
    'organizationId',
  )
  const eventIds = snapshot.eventIds.map((id) =>
    positiveBigintId(id, 'snapshotEventId'))
  const evidenceIds = snapshot.evidenceIds.map((id) =>
    positiveBigintId(id, 'snapshotEvidenceId'))

  await db.query('BEGIN')
  try {
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`company-state:v1:organization:${organizationId}`],
    )
    const createdSnapshot = await db.query<{ id: string }>(
      `INSERT INTO company_state_snapshots (
         organization_id, snapshot_at, observation_started_at,
         observation_ended_at, hiring_baseline, current_hiring_velocity,
         role_distribution, seniority_distribution, region_distribution,
         vacancy_lifetime, repost_rate, recruiting_capacity_signals,
         business_change_signals, state_classification, state_confidence,
         feature_version, evidence_hash, input_hash
       ) VALUES (
         $1, $2::TIMESTAMPTZ, $3::TIMESTAMPTZ, $4::TIMESTAMPTZ,
         $5::JSONB, $6::JSONB, $7::JSONB, $8::JSONB, $9::JSONB,
         $10::JSONB, $11::JSONB, $12::JSONB, $13::JSONB,
         $14, $15, $16, $17, $18
       )
       ON CONFLICT (organization_id, feature_version, input_hash)
       DO NOTHING
       RETURNING id::TEXT AS id`,
      [
        organizationId,
        snapshot.snapshotAt,
        snapshot.observationStartedAt,
        snapshot.observationEndedAt,
        JSON.stringify(snapshot.hiringBaseline),
        JSON.stringify(snapshot.currentHiringVelocity),
        JSON.stringify(snapshot.roleDistribution),
        JSON.stringify(snapshot.seniorityDistribution),
        JSON.stringify(snapshot.regionDistribution),
        JSON.stringify(snapshot.vacancyLifetime),
        JSON.stringify(snapshot.repostRate),
        JSON.stringify(snapshot.recruitingCapacitySignals),
        JSON.stringify(snapshot.businessChangeSignals),
        snapshot.stateClassification,
        snapshot.stateConfidence,
        snapshot.featureVersion,
        snapshot.evidenceHash,
        snapshot.inputHash,
      ],
    )
    const snapshotInserted = Boolean(createdSnapshot.rows[0]?.id)
    let snapshotId = createdSnapshot.rows[0]?.id ?? null
    if (!snapshotId) {
      const existing = await db.query<{
        id: string
        organizationId: string
      }>(
        `SELECT id::TEXT AS id,
                organization_id::TEXT AS "organizationId"
         FROM company_state_snapshots
         WHERE organization_id = $1
           AND feature_version = $2
           AND input_hash = $3
         FOR UPDATE`,
        [organizationId, snapshot.featureVersion, snapshot.inputHash],
      )
      snapshotId = existing.rows[0]?.id ?? null
      if (!snapshotId || existing.rows[0]?.organizationId !== organizationId) {
        throw new CompanyStateReplayConflictError(
          `Company State snapshot replay could not be reconciled for organization ${organizationId}.`,
        )
      }
    }

    const snapshotEvents = await attachSnapshotEvents(
      snapshotId,
      organizationId,
      eventIds,
      db,
    )
    const snapshotEvidence = await attachSnapshotEvidence(
      snapshotId,
      organizationId,
      evidenceIds,
      db,
    )
    let changesInserted = 0
    let changeEvents = 0
    let changeEvidence = 0
    for (const change of changes) {
      const persisted = await persistChange(
        snapshotId,
        organizationId,
        change,
        db,
      )
      changesInserted += persisted.inserted ? 1 : 0
      changeEvents += persisted.eventsAttached
      changeEvidence += persisted.evidenceAttached
    }

    await db.query('COMMIT')
    return {
      snapshotId,
      snapshotInserted,
      changesInserted,
      eventsAttached: snapshotEvents + changeEvents,
      evidenceAttached: snapshotEvidence + changeEvidence,
    }
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function attachSnapshotEvents(
  snapshotId: string,
  organizationId: string,
  eventIds: string[],
  db: CompanyStateDb,
): Promise<number> {
  const result = await db.query(
    `INSERT INTO company_state_snapshot_events (
       snapshot_id, organization_id, company_event_id
     )
     SELECT $1, $2, event_id
     FROM UNNEST($3::BIGINT[]) AS event_id
     ON CONFLICT (snapshot_id, company_event_id) DO NOTHING`,
    [snapshotId, organizationId, eventIds],
  )
  return result.rowCount ?? 0
}

async function attachSnapshotEvidence(
  snapshotId: string,
  organizationId: string,
  evidenceIds: string[],
  db: CompanyStateDb,
): Promise<number> {
  const result = await db.query(
    `INSERT INTO company_state_snapshot_evidence (
       snapshot_id, organization_id, evidence_id
     )
     SELECT $1, $2, evidence_id
     FROM UNNEST($3::BIGINT[]) AS evidence_id
     ON CONFLICT (snapshot_id, evidence_id) DO NOTHING`,
    [snapshotId, organizationId, evidenceIds],
  )
  return result.rowCount ?? 0
}

async function persistChange(
  snapshotId: string,
  organizationId: string,
  change: CompanyStateChangeDraft,
  db: CompanyStateDb,
): Promise<{
  inserted: boolean
  eventsAttached: number
  evidenceAttached: number
}> {
  const created = await db.query<{ id: string }>(
    `INSERT INTO company_state_changes (
       snapshot_id, organization_id, change_type, direction, dimension,
       magnitude, baseline_deviation, confidence, evidence_hash,
       change_fingerprint, feature_version, payload
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::JSONB
     )
     ON CONFLICT (organization_id, feature_version, change_fingerprint)
     DO NOTHING
     RETURNING id::TEXT AS id`,
    [
      snapshotId,
      organizationId,
      change.changeType,
      change.direction,
      change.dimension,
      change.magnitude,
      change.baselineDeviation,
      change.confidence,
      change.evidenceHash,
      change.changeFingerprint,
      change.featureVersion,
      JSON.stringify(change.payload),
    ],
  )
  const inserted = Boolean(created.rows[0]?.id)
  let changeId = created.rows[0]?.id ?? null
  if (!changeId) {
    const existing = await db.query<{ id: string; snapshotId: string }>(
      `SELECT id::TEXT AS id, snapshot_id::TEXT AS "snapshotId"
       FROM company_state_changes
       WHERE organization_id = $1
         AND feature_version = $2
         AND change_fingerprint = $3
       FOR UPDATE`,
      [organizationId, change.featureVersion, change.changeFingerprint],
    )
    changeId = existing.rows[0]?.id ?? null
    if (!changeId || existing.rows[0]?.snapshotId !== snapshotId) {
      throw new CompanyStateReplayConflictError(
        `Company State change replay could not be reconciled for organization ${organizationId}.`,
      )
    }
  }

  const eventIds = change.eventIds.map((id) =>
    positiveBigintId(id, 'changeEventId'))
  const evidenceIds = change.evidenceIds.map((id) =>
    positiveBigintId(id, 'changeEvidenceId'))
  const events = await db.query(
    `INSERT INTO company_state_change_events (
       change_id, organization_id, company_event_id
     )
     SELECT $1, $2, event_id
     FROM UNNEST($3::BIGINT[]) AS event_id
     ON CONFLICT (change_id, company_event_id) DO NOTHING`,
    [changeId, organizationId, eventIds],
  )
  const evidence = await db.query(
    `INSERT INTO company_state_change_evidence (
       change_id, organization_id, evidence_id
     )
     SELECT $1, $2, evidence_id
     FROM UNNEST($3::BIGINT[]) AS evidence_id
     ON CONFLICT (change_id, evidence_id) DO NOTHING`,
    [changeId, organizationId, evidenceIds],
  )
  return {
    inserted,
    eventsAttached: events.rowCount ?? 0,
    evidenceAttached: evidence.rowCount ?? 0,
  }
}

function validateBuildProvenance(
  snapshot: CompanyStateSnapshotDraft,
  changes: readonly CompanyStateChangeDraft[],
): void {
  positiveBigintId(snapshot.organizationId, 'organizationId')
  const snapshotEvents = validatedIdSet(snapshot.eventIds, 'snapshotEventId')
  const snapshotEvidence = validatedIdSet(
    snapshot.evidenceIds,
    'snapshotEvidenceId',
  )
  if (snapshotEvents.size === 0 || snapshotEvidence.size === 0) {
    throw new CompanyStateProvenanceError(
      'Company State snapshot requires event and evidence provenance.',
    )
  }
  const fingerprints = new Set<string>()
  for (const change of changes) {
    if (
      change.organizationId !== snapshot.organizationId ||
      change.featureVersion !== snapshot.featureVersion
    ) {
      throw new CompanyStateProvenanceError(
        'Company State change tenant or version does not match its snapshot.',
      )
    }
    const changeEvents = validatedIdSet(change.eventIds, 'changeEventId')
    const changeEvidence = validatedIdSet(
      change.evidenceIds,
      'changeEvidenceId',
    )
    if (
      changeEvents.size === 0 ||
      changeEvidence.size === 0 ||
      [...changeEvents].some((id) => !snapshotEvents.has(id)) ||
      [...changeEvidence].some((id) => !snapshotEvidence.has(id))
    ) {
      throw new CompanyStateProvenanceError(
        'Company State change provenance must be a non-empty subset of its snapshot.',
      )
    }
    if (fingerprints.has(change.changeFingerprint)) {
      throw new CompanyStateProvenanceError(
        'Company State build contains duplicate change fingerprints.',
      )
    }
    fingerprints.add(change.changeFingerprint)
  }
}

function validatedIdSet(ids: readonly string[], field: string): Set<string> {
  const normalized = ids.map((id) => positiveBigintId(id, field))
  if (new Set(normalized).size !== normalized.length) {
    throw new CompanyStateProvenanceError(`${field} contains duplicate ids.`)
  }
  return new Set(normalized)
}

function positiveBigintId(value: string, field: string): string {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new CompanyStateProvenanceError(
      `${field} must be a positive bigint identifier.`,
    )
  }
  return value
}

function emptyPersistenceResult(): CompanyStatePersistenceResult {
  return {
    snapshotId: null,
    snapshotInserted: false,
    changesInserted: 0,
    eventsAttached: 0,
    evidenceAttached: 0,
  }
}
