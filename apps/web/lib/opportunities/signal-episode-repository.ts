import type { QueryResult } from 'pg'

import type { SignalEpisodeDraft } from './signal-episode'

export type SignalEpisodeDb = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<SignalEpisodeDb & { release: () => void }>
}

export interface SignalEpisodePersistenceResult {
  episodeId: string
  episodeGeneration: number
  inserted: boolean
  stateChangesAttached: number
  eventsAttached: number
  evidenceAttached: number
}

export class SignalEpisodeProvenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignalEpisodeProvenanceError'
  }
}

export class SignalEpisodeReplayConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignalEpisodeReplayConflictError'
  }
}

export async function persistSignalEpisode(
  episode: SignalEpisodeDraft,
  db: SignalEpisodeDb,
): Promise<SignalEpisodePersistenceResult> {
  const normalized = validateEpisode(episode)
  const ownsClient = Boolean(db.connect) && !('release' in db)
  const client = ownsClient && db.connect ? await db.connect() : db
  try {
    return await persistEpisodeTransaction(normalized, client)
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

async function persistEpisodeTransaction(
  episode: SignalEpisodeDraft,
  db: SignalEpisodeDb,
): Promise<SignalEpisodePersistenceResult> {
  await db.query('BEGIN')
  try {
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`signal-episodes:v2:${episode.organizationId}:${episode.episodeIdentity}`],
    )
    const replay = await findReplay(episode, db)
    if (replay) {
      await db.query('COMMIT')
      return emptyResult(replay.id, replay.episodeGeneration, false)
    }

    const next = await db.query<{ nextGeneration: number }>(
      `SELECT COALESCE(MAX(episode_generation), 0) + 1 AS "nextGeneration"
       FROM signal_episodes
       WHERE organization_id = $1
         AND engine_version = $2
         AND episode_identity = $3`,
      [episode.organizationId, episode.engineVersion, episode.episodeIdentity],
    )
    const nextGeneration = positiveGeneration(next.rows[0]?.nextGeneration)
    const inserted = await db.query<{
      id: string
      episodeGeneration: number
    }>(
      `INSERT INTO signal_episodes (
         organization_id, episode_identity, episode_generation, episode_type,
         stage, started_at, last_seen_at, valid_until, intensity, direction,
         baseline_deviation, role_families, regions, seniority_distribution,
         problem_hypotheses, evidence_hash, input_hash, engine_version
       ) VALUES (
         $1, $2, $3, $4, $5, $6::TIMESTAMPTZ, $7::TIMESTAMPTZ,
         $8::TIMESTAMPTZ, $9, $10, $11, $12::TEXT[], $13::TEXT[],
         $14::JSONB, $15::TEXT[], $16, $17, $18
       )
       ON CONFLICT (organization_id, engine_version, input_hash) DO NOTHING
       RETURNING id::TEXT AS id, episode_generation AS "episodeGeneration"`,
      [
        episode.organizationId,
        episode.episodeIdentity,
        nextGeneration,
        episode.episodeType,
        episode.stage,
        episode.startedAt,
        episode.lastSeenAt,
        episode.validUntil,
        episode.intensity,
        episode.direction,
        episode.baselineDeviation,
        episode.roleFamilies,
        episode.regions,
        JSON.stringify(episode.seniorityDistribution),
        episode.problemHypotheses,
        episode.evidenceHash,
        episode.inputHash,
        episode.engineVersion,
      ],
    )
    let episodeId = inserted.rows[0]?.id ?? null
    let persistedGeneration = inserted.rows[0]?.episodeGeneration ?? null
    let wasInserted = Boolean(episodeId)
    if (!episodeId || persistedGeneration === null) {
      const reconciled = await findReplay(episode, db)
      if (!reconciled) {
        throw new SignalEpisodeReplayConflictError(
          'Signal Episode input replay could not be reconciled.',
        )
      }
      episodeId = reconciled.id
      persistedGeneration = reconciled.episodeGeneration
      wasInserted = false
    }
    if (!wasInserted) {
      await db.query('COMMIT')
      return emptyResult(episodeId, persistedGeneration, false)
    }

    const stateChanges = await db.query(
      `INSERT INTO signal_episode_state_changes (
         signal_episode_id, organization_id, company_state_change_id
       )
       SELECT $1, $2, state_change_id
       FROM UNNEST($3::BIGINT[]) AS state_change_id
       ON CONFLICT (signal_episode_id, company_state_change_id) DO NOTHING`,
      [episodeId, episode.organizationId, episode.stateChangeIds],
    )
    const events = await db.query(
      `INSERT INTO signal_episode_events (
         signal_episode_id, organization_id, company_event_id
       )
       SELECT $1, $2, company_event_id
       FROM UNNEST($3::BIGINT[]) AS company_event_id
       ON CONFLICT (signal_episode_id, company_event_id) DO NOTHING`,
      [episodeId, episode.organizationId, episode.eventIds],
    )
    const evidence = await db.query(
      `INSERT INTO signal_episode_evidence (
         signal_episode_id, organization_id, evidence_id
       )
       SELECT $1, $2, evidence_id
       FROM UNNEST($3::BIGINT[]) AS evidence_id
       ON CONFLICT (signal_episode_id, evidence_id) DO NOTHING`,
      [episodeId, episode.organizationId, episode.evidenceIds],
    )
    await db.query('COMMIT')
    return {
      episodeId,
      episodeGeneration: persistedGeneration,
      inserted: true,
      stateChangesAttached: stateChanges.rowCount ?? 0,
      eventsAttached: events.rowCount ?? 0,
      evidenceAttached: evidence.rowCount ?? 0,
    }
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

async function findReplay(
  episode: SignalEpisodeDraft,
  db: SignalEpisodeDb,
): Promise<{ id: string; episodeGeneration: number } | null> {
  const existing = await db.query<{
    id: string
    episodeGeneration: number
    episodeIdentity: string
  }>(
    `SELECT
       id::TEXT AS id,
       episode_generation AS "episodeGeneration",
       episode_identity AS "episodeIdentity"
     FROM signal_episodes
     WHERE organization_id = $1
       AND engine_version = $2
       AND input_hash = $3
     FOR UPDATE`,
    [episode.organizationId, episode.engineVersion, episode.inputHash],
  )
  const row = existing.rows[0]
  if (!row) return null
  if (row.episodeIdentity !== undefined && row.episodeIdentity !== episode.episodeIdentity) {
    throw new SignalEpisodeReplayConflictError(
      'Signal Episode input hash resolved to a different episode identity.',
    )
  }
  return {
    id: positiveId(row.id, 'episodeId'),
    episodeGeneration: positiveGeneration(row.episodeGeneration),
  }
}

function validateEpisode(episode: SignalEpisodeDraft): SignalEpisodeDraft {
  const organizationId = positiveId(episode.organizationId, 'organizationId')
  const stateChangeIds = validatedIds(episode.stateChangeIds, 'stateChangeIds')
  const eventIds = validatedIds(episode.eventIds, 'eventIds')
  const evidenceIds = validatedIds(episode.evidenceIds, 'evidenceIds')
  if (stateChangeIds.length === 0) {
    throw new SignalEpisodeProvenanceError(
      'Signal Episode requires at least one Company State Change.',
    )
  }
  if (eventIds.length === 0 || evidenceIds.length === 0) {
    throw new SignalEpisodeProvenanceError(
      'Signal Episode requires event and evidence provenance.',
    )
  }
  for (const [name, value] of [
    ['episodeIdentity', episode.episodeIdentity],
    ['evidenceHash', episode.evidenceHash],
    ['inputHash', episode.inputHash],
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new TypeError(`${name} must be a lowercase SHA-256 hash.`)
    }
  }
  const startedAt = validTimestamp(episode.startedAt, 'startedAt')
  const lastSeenAt = validTimestamp(episode.lastSeenAt, 'lastSeenAt')
  const validUntil = validTimestamp(episode.validUntil, 'validUntil')
  if (Date.parse(startedAt) > Date.parse(lastSeenAt) ||
      Date.parse(lastSeenAt) >= Date.parse(validUntil)) {
    throw new TypeError('Signal Episode time window is invalid.')
  }
  if (!Number.isFinite(episode.intensity) || episode.intensity < 0 || episode.intensity > 1) {
    throw new TypeError('Signal Episode intensity must be between 0 and 1.')
  }
  if (episode.problemHypotheses.length === 0) {
    throw new TypeError('Signal Episode requires a problem hypothesis code.')
  }
  return {
    ...episode,
    organizationId,
    startedAt,
    lastSeenAt,
    validUntil,
    stateChangeIds,
    eventIds,
    evidenceIds,
    roleFamilies: uniqueSortedText(episode.roleFamilies),
    regions: uniqueSortedText(episode.regions),
    problemHypotheses: uniqueSortedText(episode.problemHypotheses),
  }
}

function emptyResult(
  episodeId: string,
  episodeGeneration: number,
  inserted: boolean,
): SignalEpisodePersistenceResult {
  return {
    episodeId,
    episodeGeneration,
    inserted,
    stateChangesAttached: 0,
    eventsAttached: 0,
    evidenceAttached: 0,
  }
}

function validatedIds(values: readonly string[], name: string): string[] {
  if (!Array.isArray(values)) {
    throw new SignalEpisodeProvenanceError(`${name} must be an array.`)
  }
  return [...new Set(values.map((value) => positiveId(value, name)))]
    .sort(compareIds)
}

function positiveId(value: string, name: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new SignalEpisodeProvenanceError(`${name} contains an invalid bigint ID.`)
  }
  return BigInt(normalized).toString()
}

function positiveGeneration(value: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647) {
    throw new SignalEpisodeReplayConflictError(
      'Signal Episode generation could not be allocated.',
    )
  }
  return parsed
}

function validTimestamp(value: string, name: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new TypeError(`${name} must be a timestamp.`)
  return new Date(timestamp).toISOString()
}

function compareIds(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right)
  return difference < 0 ? -1 : difference > 0 ? 1 : 0
}

function uniqueSortedText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
}
