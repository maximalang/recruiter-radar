import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  clampSignalEpisodesJobBatchSize,
  isSignalEpisodesV2Enabled,
  SIGNAL_EPISODES_V2_LIMITS,
} from './config'
import {
  buildSignalEpisodes,
  SIGNAL_EPISODE_ENGINE_VERSION,
  type SignalEpisodeEventInput,
  type SignalEpisodeStage,
  type SignalEpisodeStateChangeInput,
} from './signal-episode'
import {
  persistSignalEpisode,
  type SignalEpisodeDb,
} from './signal-episode-repository'

export type SignalEpisodesJobDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type SignalEpisodesJobOptions = {
  organizationId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  now?: Date
  enabled?: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export type SignalEpisodesJobStats = {
  enabled: boolean
  dryRun: boolean
  scanned: number
  built: number
  active: number
  cooling: number
  expired: number
  episodesPersisted: number
  replayed: number
  rejected: number
  failed: number
}

export class SignalEpisodesApplyScopeRequiredError extends Error {
  constructor() {
    super('Signal Episodes apply requires one explicit organization.')
    this.name = 'SignalEpisodesApplyScopeRequiredError'
  }
}

export class SignalEpisodesHistoryLimitExceededError extends Error {
  constructor(organizationId: string, source: 'state changes' | 'events') {
    super(
      `Signal Episodes ${source} exceed the bounded limit for organization ${organizationId}.`,
    )
    this.name = 'SignalEpisodesHistoryLimitExceededError'
  }
}

type SignalEpisodeStateChangeRow = SignalEpisodeStateChangeInput
type SignalEpisodeEventRow = SignalEpisodeEventInput

export async function buildSignalEpisodesJob(
  options: SignalEpisodesJobOptions = {},
  providedDb: SignalEpisodesJobDb | null = null,
): Promise<SignalEpisodesJobStats> {
  const enabled = options.enabled !== false &&
    isSignalEpisodesV2Enabled(options.env)
  const stats = emptyJobStats(enabled, options.dryRun !== false)
  if (!enabled) return stats
  if (!stats.dryRun && options.organizationId == null) {
    throw new SignalEpisodesApplyScopeRequiredError()
  }

  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')
  const batchSize = clampSignalEpisodesJobBatchSize(
    options.batchSize ?? SIGNAL_EPISODES_V2_LIMITS.defaultJobBatchSize,
  )
  const now = validDate(options.now ?? new Date())
  const ownsClient = 'connect' in database && !('release' in database)
  const jobDb = ownsClient && 'connect' in database
    ? await database.connect()
    : database
  try {
    await jobDb.query(
      `SELECT set_config('statement_timeout', $1, false)`,
      [`${SIGNAL_EPISODES_V2_LIMITS.statementTimeoutMs}ms`],
    )
    return await executeSignalEpisodesJob(options, stats, batchSize, now, jobDb)
  } finally {
    await jobDb.query('RESET statement_timeout').catch((error) => {
      logError('signal_episodes.statement_timeout_reset_failed', error)
    })
    if (ownsClient && 'release' in jobDb) jobDb.release()
  }
}

async function executeSignalEpisodesJob(
  options: SignalEpisodesJobOptions,
  stats: SignalEpisodesJobStats,
  batchSize: number,
  now: Date,
  database: SignalEpisodesJobDb,
): Promise<SignalEpisodesJobStats> {
  const historyStartedAt = new Date(
    now.getTime() -
      SIGNAL_EPISODES_V2_LIMITS.inputHistoryWindowDays * 86_400_000,
  )
  const contextStartedAt = new Date(
    now.getTime() - SIGNAL_EPISODES_V2_LIMITS.contextWindowDays * 86_400_000,
  )
  const organizations = await database.query<{ organizationId: string }>(
    `SELECT change.organization_id::TEXT AS "organizationId"
     FROM company_state_changes change
     JOIN company_state_snapshots snapshot
       ON snapshot.id = change.snapshot_id
      AND snapshot.organization_id = change.organization_id
     LEFT JOIN LATERAL (
       SELECT episode.id, episode.stage, episode.last_seen_at, episode.valid_until
       FROM signal_episodes episode
       WHERE episode.organization_id = change.organization_id
         AND episode.engine_version = $3
       ORDER BY episode.created_at DESC, episode.id DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE ($1::BIGINT IS NULL OR change.organization_id = $1)
       AND snapshot.snapshot_at >= $2::TIMESTAMPTZ
       AND snapshot.snapshot_at <= $4::TIMESTAMPTZ
       AND (
         latest.id IS NULL
         OR NOT EXISTS (
           SELECT 1
           FROM signal_episode_state_changes linked_change
           WHERE linked_change.signal_episode_id = latest.id
             AND linked_change.organization_id = change.organization_id
             AND linked_change.company_state_change_id = change.id
         )
         OR EXISTS (
           SELECT 1
           FROM company_events candidate_event
           WHERE candidate_event.organization_id = change.organization_id
             AND candidate_event.occurred_at >= $5::TIMESTAMPTZ
             AND candidate_event.last_seen_at <= $4::TIMESTAMPTZ
             AND candidate_event.event_type IN (
               'vacancy_repost',
               'recruiter_vacancy',
               'leadership_change',
               'new_business_unit',
               'office_opening',
               'product_launch',
               'funding_or_investment',
               'major_contract'
             )
             AND NOT EXISTS (
               SELECT 1
               FROM signal_episode_events linked_event
               WHERE linked_event.signal_episode_id = latest.id
                 AND linked_event.organization_id = change.organization_id
                 AND linked_event.company_event_id = candidate_event.id
             )
         )
         OR latest.stage <> CASE
           WHEN $4::TIMESTAMPTZ >= latest.valid_until THEN 'expired'
           WHEN $4::TIMESTAMPTZ >= latest.last_seen_at +
             (latest.valid_until - latest.last_seen_at) * 0.75 THEN 'cooling'
           ELSE 'active'
         END
       )
     GROUP BY change.organization_id
     ORDER BY MIN(change.id)
     LIMIT $6`,
    [
      options.organizationId == null ? null : String(options.organizationId),
      historyStartedAt.toISOString(),
      SIGNAL_EPISODE_ENGINE_VERSION,
      now.toISOString(),
      contextStartedAt.toISOString(),
      batchSize,
    ],
  )

  for (const organization of organizations.rows) {
    stats.scanned += 1
    try {
      const stateChanges = await loadStateChanges(
        organization.organizationId,
        historyStartedAt,
        now,
        database,
      )
      if (
        stateChanges.length >
        SIGNAL_EPISODES_V2_LIMITS.maximumStateChangesPerOrganization
      ) {
        throw new SignalEpisodesHistoryLimitExceededError(
          organization.organizationId,
          'state changes',
        )
      }
      const events = await loadEvents(
        organization.organizationId,
        historyStartedAt,
        now,
        database,
      )
      if (events.length > SIGNAL_EPISODES_V2_LIMITS.maximumEventsPerOrganization) {
        throw new SignalEpisodesHistoryLimitExceededError(
          organization.organizationId,
          'events',
        )
      }

      const build = buildSignalEpisodes(
        { stateChanges, events },
        {
          organizationId: organization.organizationId,
          now,
          episodeLookbackDays: SIGNAL_EPISODES_V2_LIMITS.episodeLookbackDays,
          contextWindowDays: SIGNAL_EPISODES_V2_LIMITS.contextWindowDays,
        },
      )
      stats.rejected += build.rejections.length
      for (const episode of build.episodes) {
        stats.built += 1
        incrementStage(stats, episode.stage)
        if (stats.dryRun) continue
        const persisted = await persistSignalEpisode(
          episode,
          database as SignalEpisodeDb,
        )
        if (persisted.inserted) stats.episodesPersisted += 1
        else stats.replayed += 1
      }
    } catch (error) {
      stats.failed += 1
      logError('signal_episodes.build_failed', error, {
        organizationId: organization.organizationId,
      })
    }
  }

  logEvent('signal_episodes.build_completed', {
    dryRun: stats.dryRun,
    scanned: stats.scanned,
    built: stats.built,
    active: stats.active,
    cooling: stats.cooling,
    expired: stats.expired,
    episodesPersisted: stats.episodesPersisted,
    replayed: stats.replayed,
    rejected: stats.rejected,
    failed: stats.failed,
  })
  return stats
}

async function loadStateChanges(
  organizationId: string,
  historyStartedAt: Date,
  now: Date,
  db: SignalEpisodesJobDb,
): Promise<SignalEpisodeStateChangeInput[]> {
  const result = await db.query<SignalEpisodeStateChangeRow>(
    `SELECT
       change.id::TEXT AS id,
       change.snapshot_id::TEXT AS "snapshotId",
       change.organization_id::TEXT AS "organizationId",
       snapshot.snapshot_at::TEXT AS "snapshotAt",
       change.change_type AS "changeType",
       change.direction,
       change.dimension,
       change.magnitude,
       change.baseline_deviation AS "baselineDeviation",
       change.confidence,
       COALESCE((
         SELECT ARRAY_AGG(link.company_event_id::TEXT ORDER BY link.company_event_id)
         FROM company_state_change_events link
         WHERE link.change_id = change.id
           AND link.organization_id = change.organization_id
       ), ARRAY[]::TEXT[]) AS "eventIds",
       COALESCE((
         SELECT ARRAY_AGG(link.evidence_id::TEXT ORDER BY link.evidence_id)
         FROM company_state_change_evidence link
         WHERE link.change_id = change.id
           AND link.organization_id = change.organization_id
       ), ARRAY[]::TEXT[]) AS "evidenceIds",
       change.change_fingerprint AS "changeFingerprint",
       change.payload
     FROM company_state_changes change
     JOIN company_state_snapshots snapshot
       ON snapshot.id = change.snapshot_id
      AND snapshot.organization_id = change.organization_id
     WHERE change.organization_id = $1
       AND snapshot.snapshot_at >= $2::TIMESTAMPTZ
       AND snapshot.snapshot_at <= $3::TIMESTAMPTZ
     ORDER BY snapshot.snapshot_at ASC, change.id ASC
     LIMIT $4`,
    [
      organizationId,
      historyStartedAt.toISOString(),
      now.toISOString(),
      SIGNAL_EPISODES_V2_LIMITS.maximumStateChangesPerOrganization + 1,
    ],
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    snapshotId: String(row.snapshotId),
    organizationId: String(row.organizationId),
    snapshotAt: String(row.snapshotAt),
    changeType: row.changeType,
    direction: row.direction,
    dimension: String(row.dimension),
    magnitude: Number(row.magnitude),
    baselineDeviation: row.baselineDeviation === null
      ? null
      : Number(row.baselineDeviation),
    confidence: Number(row.confidence),
    eventIds: stringArray(row.eventIds),
    evidenceIds: stringArray(row.evidenceIds),
    changeFingerprint: String(row.changeFingerprint),
    payload: record(row.payload),
  }))
}

async function loadEvents(
  organizationId: string,
  historyStartedAt: Date,
  now: Date,
  db: SignalEpisodesJobDb,
): Promise<SignalEpisodeEventInput[]> {
  const result = await db.query<SignalEpisodeEventRow>(
    `SELECT
       event.id::TEXT AS id,
       event.organization_id::TEXT AS "organizationId",
       event.event_type AS "eventType",
       event.occurred_at::TEXT AS "occurredAt",
       event.first_seen_at::TEXT AS "firstSeenAt",
       event.last_seen_at::TEXT AS "lastSeenAt",
       event.event_fingerprint AS "eventFingerprint",
       event.evidence_ids::TEXT[] AS "evidenceIds",
       event.confidence,
       event.payload
     FROM company_events event
     WHERE event.organization_id = $1
       AND event.last_seen_at <= $3::TIMESTAMPTZ
       AND (
         event.occurred_at >= $2::TIMESTAMPTZ
         OR EXISTS (
           SELECT 1
           FROM company_state_change_events change_event
           JOIN company_state_changes change
             ON change.id = change_event.change_id
            AND change.organization_id = change_event.organization_id
           JOIN company_state_snapshots snapshot
             ON snapshot.id = change.snapshot_id
            AND snapshot.organization_id = change.organization_id
           WHERE change_event.company_event_id = event.id
             AND change_event.organization_id = event.organization_id
             AND snapshot.snapshot_at >= $2::TIMESTAMPTZ
             AND snapshot.snapshot_at <= $3::TIMESTAMPTZ
         )
       )
     ORDER BY event.occurred_at ASC, event.id ASC
     LIMIT $4`,
    [
      organizationId,
      historyStartedAt.toISOString(),
      now.toISOString(),
      SIGNAL_EPISODES_V2_LIMITS.maximumEventsPerOrganization + 1,
    ],
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    organizationId: String(row.organizationId),
    eventType: row.eventType,
    occurredAt: String(row.occurredAt),
    firstSeenAt: String(row.firstSeenAt),
    lastSeenAt: String(row.lastSeenAt),
    eventFingerprint: String(row.eventFingerprint),
    evidenceIds: stringArray(row.evidenceIds),
    confidence: row.confidence === null ? null : Number(row.confidence),
    payload: record(row.payload),
  }))
}

function emptyJobStats(
  enabled: boolean,
  dryRun: boolean,
): SignalEpisodesJobStats {
  return {
    enabled,
    dryRun,
    scanned: 0,
    built: 0,
    active: 0,
    cooling: 0,
    expired: 0,
    episodesPersisted: 0,
    replayed: 0,
    rejected: 0,
    failed: 0,
  }
}

function incrementStage(
  stats: SignalEpisodesJobStats,
  stage: SignalEpisodeStage,
): void {
  stats[stage] += 1
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('Signal Episodes job now must be a valid date.')
  }
  return value
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : {}
}
