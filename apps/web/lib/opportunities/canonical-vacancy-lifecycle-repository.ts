import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

import type { CanonicalVacancy } from './hiring-episode-detection'
import {
  reconcileVacancyLifecycle,
  type VacancyLifecycleEventType,
  type VacancyLifecycleState,
} from './canonical-vacancy-lifecycle'

type LifecycleDb = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

interface LifecycleRow {
  id: string
  vacancyFingerprint: string
  active: boolean
  firstSeenAt: string
  lastSeenAt: string
  lastSourceSeenAt: string
  closedAt: string | null
  reopenedAt: string | null
  reopenedCount: number
  sourceFamilies: string[]
  successfulAbsenceObservationIds: string[]
}

interface SuccessfulRunRow {
  id: string
  sourceId: string
  startedAt: string
  completedAt: string
}

export interface CanonicalVacancyLifecycleStats {
  observed: number
  opened: number
  closed: number
  reopened: number
}

export async function persistCanonicalVacancyLifecycle(
  organizationId: string,
  vacancies: CanonicalVacancy[],
  observedAt: Date,
  db: LifecycleDb,
): Promise<CanonicalVacancyLifecycleStats> {
  const currentResult = await db.query<LifecycleRow>(
    `SELECT
       id::TEXT AS id,
       vacancy_fingerprint AS "vacancyFingerprint",
       active,
       first_seen_at::TEXT AS "firstSeenAt",
       last_seen_at::TEXT AS "lastSeenAt",
       last_source_seen_at::TEXT AS "lastSourceSeenAt",
       closed_at::TEXT AS "closedAt",
       reopened_at::TEXT AS "reopenedAt",
       reopened_count AS "reopenedCount",
       source_families AS "sourceFamilies",
       successful_absence_observation_ids::TEXT[] AS "successfulAbsenceObservationIds"
     FROM canonical_vacancies_v1
     WHERE organization_id = $1
     ORDER BY id`,
    [organizationId],
  )
  const currentByFingerprint = new Map(
    currentResult.rows.map((row) => [row.vacancyFingerprint, row]),
  )
  const allSources = uniqueStrings([
    ...vacancies.flatMap((vacancy) =>
      vacancy.publications.map((publication) => publication.source)),
    ...currentResult.rows.flatMap((row) => row.sourceFamilies),
  ])
  const successfulRuns = allSources.length === 0
    ? []
    : (await db.query<SuccessfulRunRow>(
      `SELECT
         id::TEXT AS id,
         source_id AS "sourceId",
         started_at::TEXT AS "startedAt",
         completed_at::TEXT AS "completedAt"
       FROM source_run_observations
       WHERE source_id = ANY($1::TEXT[])
         AND outcome = 'success'
         AND action = 'pipeline'
         AND completed_at <= $2::TIMESTAMPTZ
       ORDER BY completed_at, id`,
      [allSources, observedAt.toISOString()],
    )).rows

  const stats: CanonicalVacancyLifecycleStats = {
    observed: 0,
    opened: 0,
    closed: 0,
    reopened: 0,
  }
  const presentFingerprints = new Set<string>()
  for (const vacancy of vacancies) {
    const current = currentByFingerprint.get(vacancy.vacancyFingerprint) ?? null
    if (!vacancyWasPresentInLatestSuccessfulRun(
      vacancy,
      current,
      successfulRuns,
      observedAt,
    )) continue
    presentFingerprints.add(vacancy.vacancyFingerprint)
    const result = reconcileVacancyLifecycle(
      current ? mapLifecycleState(current) : null,
      { observedAt, present: true, successfulObservationIds: [] },
    )
    const vacancyId = await upsertCanonicalVacancy(
      organizationId,
      vacancy,
      result.state,
      db,
    )
    await upsertPublications(vacancyId, organizationId, vacancy, observedAt, db)
    const observationId = await insertObservation({
      vacancyId,
      organizationId,
      vacancyFingerprint: vacancy.vacancyFingerprint,
      observedAt,
      present: true,
      sourceRunObservationIds: [],
      signalIds: vacancy.publications.map((publication) => publication.id),
      evidenceIds: vacancy.evidenceIds,
    }, db)
    stats.observed += 1
    if (result.event && observationId) {
      await insertEvent(
        vacancyId,
        organizationId,
        vacancy.vacancyFingerprint,
        result.event,
        observedAt,
        observationId,
        vacancy.evidenceIds,
        db,
      )
      stats[result.event] += 1
    }
  }

  for (const current of currentResult.rows) {
    if (!current.active || presentFingerprints.has(current.vacancyFingerprint)) {
      continue
    }
    const sourceRunObservationIds = successfulRuns
      .filter((run) =>
        current.sourceFamilies.includes(run.sourceId) &&
        Date.parse(run.completedAt) > Date.parse(current.lastSourceSeenAt))
      .map((run) => Number(run.id))
      .filter(Number.isSafeInteger)
    if (sourceRunObservationIds.length === 0) continue

    const result = reconcileVacancyLifecycle(mapLifecycleState(current), {
      observedAt,
      present: false,
      successfulObservationIds: sourceRunObservationIds,
    })
    await db.query(
      `UPDATE canonical_vacancies_v1
       SET active = $2,
           closed_at = $3,
           successful_absence_observation_ids = $4::BIGINT[],
           updated_at = NOW()
       WHERE id = $1`,
      [
        current.id,
        result.state.status === 'active',
        result.state.closedAt,
        result.state.successfulAbsenceObservationIds,
      ],
    )
    const observationId = await insertObservation({
      vacancyId: current.id,
      organizationId,
      vacancyFingerprint: current.vacancyFingerprint,
      observedAt,
      present: false,
      sourceRunObservationIds,
      signalIds: [],
      evidenceIds: [],
    }, db)
    stats.observed += 1
    if (result.event && observationId) {
      await insertEvent(
        current.id,
        organizationId,
        current.vacancyFingerprint,
        result.event,
        observedAt,
        observationId,
        [],
        db,
      )
      stats[result.event] += 1
    }
  }
  return stats
}

function mapLifecycleState(row: LifecycleRow): VacancyLifecycleState {
  return {
    status: row.active ? 'active' : 'closed',
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    lastSourceSeenAt: row.lastSourceSeenAt,
    closedAt: row.closedAt,
    reopenedAt: row.reopenedAt,
    reopenedCount: row.reopenedCount,
    successfulAbsenceObservationIds:
      row.successfulAbsenceObservationIds.map(Number).filter(Number.isSafeInteger),
  }
}

async function upsertCanonicalVacancy(
  organizationId: string,
  vacancy: CanonicalVacancy,
  state: VacancyLifecycleState,
  db: LifecycleDb,
): Promise<string> {
  const sourceFamilies = uniqueStrings(
    vacancy.publications.map((publication) => publication.source),
  )
  const sourceExternalIds = Object.fromEntries(sourceFamilies.map((source) => [
    source,
    uniqueStrings(vacancy.publications
      .filter((publication) => publication.source === source)
      .map((publication) => publication.externalVacancyId ?? '')),
  ]))
  const result = await db.query<{ id: string }>(
    `INSERT INTO canonical_vacancies_v1 (
       organization_id, vacancy_fingerprint, normalized_role, location,
       canonical_destination_url, first_seen_at, last_seen_at,
       last_source_seen_at, active, closed_at, reopened_at, reopened_count,
       source_families, source_external_ids, evidence_ids,
       successful_absence_observation_ids
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::JSONB,$15,$16
     )
     ON CONFLICT (organization_id, vacancy_fingerprint) DO UPDATE SET
       normalized_role = EXCLUDED.normalized_role,
       location = EXCLUDED.location,
       canonical_destination_url = COALESCE(EXCLUDED.canonical_destination_url, canonical_vacancies_v1.canonical_destination_url),
       last_seen_at = GREATEST(canonical_vacancies_v1.last_seen_at, EXCLUDED.last_seen_at),
       last_source_seen_at = GREATEST(canonical_vacancies_v1.last_source_seen_at, EXCLUDED.last_source_seen_at),
       active = EXCLUDED.active,
       closed_at = EXCLUDED.closed_at,
       reopened_at = EXCLUDED.reopened_at,
       reopened_count = EXCLUDED.reopened_count,
       source_families = EXCLUDED.source_families,
       source_external_ids = EXCLUDED.source_external_ids,
       evidence_ids = EXCLUDED.evidence_ids,
       successful_absence_observation_ids = EXCLUDED.successful_absence_observation_ids,
       updated_at = NOW()
     RETURNING id::TEXT AS id`,
    [
      organizationId,
      vacancy.vacancyFingerprint,
      vacancy.title,
      vacancy.region,
      vacancy.sourceUrl,
      state.firstSeenAt,
      state.lastSeenAt,
      state.lastSourceSeenAt,
      state.status === 'active',
      state.closedAt,
      state.reopenedAt,
      state.reopenedCount,
      sourceFamilies,
      JSON.stringify(sourceExternalIds),
      vacancy.evidenceIds,
      state.successfulAbsenceObservationIds,
    ],
  )
  const id = result.rows[0]?.id
  if (!id) throw new Error('Canonical vacancy upsert did not return an id.')
  return id
}

async function upsertPublications(
  vacancyId: string,
  organizationId: string,
  vacancy: CanonicalVacancy,
  observedAt: Date,
  db: LifecycleDb,
): Promise<void> {
  for (const publication of vacancy.publications) {
    await db.query(
      `INSERT INTO canonical_vacancy_publications_v1 (
         canonical_vacancy_id, organization_id, signal_id, source_family,
         external_vacancy_id, destination_url, first_seen_at, last_seen_at,
         evidence_ids
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (signal_id) DO UPDATE SET
         last_seen_at = GREATEST(canonical_vacancy_publications_v1.last_seen_at, EXCLUDED.last_seen_at),
         evidence_ids = EXCLUDED.evidence_ids,
         updated_at = NOW()`,
      [
        vacancyId,
        organizationId,
        publication.id,
        publication.source,
        publication.externalVacancyId,
        publication.sourceUrl,
        publication.occurredAt,
        observedAt.toISOString(),
        publication.evidenceIds,
      ],
    )
  }
}

interface ObservationInput {
  vacancyId: string
  organizationId: string
  vacancyFingerprint: string
  observedAt: Date
  present: boolean
  sourceRunObservationIds: number[]
  signalIds: string[]
  evidenceIds: string[]
}

async function insertObservation(
  input: ObservationInput,
  db: LifecycleDb,
): Promise<string | null> {
  const fingerprint = hash([
    input.vacancyFingerprint,
    input.observedAt.toISOString(),
    input.present,
    input.sourceRunObservationIds,
    input.signalIds,
  ])
  const result = await db.query<{ id: string }>(
    `INSERT INTO canonical_vacancy_observations_v1 (
       canonical_vacancy_id, organization_id, observed_at, present,
       source_run_observation_ids, signal_ids, evidence_ids, basis,
       observation_fingerprint
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::JSONB,$9)
     ON CONFLICT (observation_fingerprint) DO NOTHING
     RETURNING id::TEXT AS id`,
    [
      input.vacancyId,
      input.organizationId,
      input.observedAt.toISOString(),
      input.present,
      input.sourceRunObservationIds,
      input.signalIds,
      input.evidenceIds,
      JSON.stringify({
        rule: input.present ? 'canonical-publication-present' : 'ttl-and-successful-source-runs',
      }),
      fingerprint,
    ],
  )
  return result.rows[0]?.id ?? null
}

async function insertEvent(
  vacancyId: string,
  organizationId: string,
  vacancyFingerprint: string,
  eventType: VacancyLifecycleEventType,
  occurredAt: Date,
  observationId: string,
  evidenceIds: string[],
  db: LifecycleDb,
): Promise<void> {
  await db.query(
    `INSERT INTO canonical_vacancy_events_v1 (
       canonical_vacancy_id, organization_id, event_type, occurred_at,
       observation_id, evidence_ids, details, event_fingerprint
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::JSONB,$8)
     ON CONFLICT (event_fingerprint) DO NOTHING`,
    [
      vacancyId,
      organizationId,
      eventType,
      occurredAt.toISOString(),
      observationId,
      evidenceIds,
      JSON.stringify({ vacancyFingerprint }),
      hash([vacancyFingerprint, eventType, observationId]),
    ],
  )
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function vacancyWasPresentInLatestSuccessfulRun(
  vacancy: CanonicalVacancy,
  current: LifecycleRow | null,
  successfulRuns: SuccessfulRunRow[],
  observedAt: Date,
): boolean {
  for (const publication of vacancy.publications) {
    const latestRun = successfulRuns
      .filter((run) => run.sourceId === publication.source)
      .sort((left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
        Number(right.id) - Number(left.id))[0]
    if (!latestRun) {
      if (current) return true
      const publicationAge = observedAt.getTime() - Date.parse(publication.occurredAt)
      if (publicationAge <= 14 * 86_400_000) return true
      continue
    }
    const lastObservedAt = Date.parse(publication.lastObservedAt ?? '')
    if (Number.isFinite(lastObservedAt) &&
        lastObservedAt >= Date.parse(latestRun.startedAt)) return true
  }
  return false
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
