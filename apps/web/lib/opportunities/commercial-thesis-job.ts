import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  COMMERCIAL_THESIS_V1_LIMITS,
  clampCommercialThesisJobBatchSize,
  isCommercialThesisV1Enabled,
} from './config'
import {
  buildCommercialThesis,
  COMMERCIAL_THESIS_ENGINE_VERSION,
  type CommercialThesisEpisodeInput,
} from './commercial-thesis'
import {
  persistCommercialThesis,
  type CommercialThesisDb,
} from './commercial-thesis-repository'
import { SIGNAL_EPISODE_ENGINE_VERSION } from './signal-episode'

export type CommercialThesisJobDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type CommercialThesisJobOptions = {
  organizationId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  now?: Date
  enabled?: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export type CommercialThesisJobStats = {
  enabled: boolean
  dryRun: boolean
  scanned: number
  episodesScanned: number
  built: number
  active: number
  cooling: number
  expired: number
  thesesPersisted: number
  replayed: number
  rejected: number
  failed: number
}

export class CommercialThesisApplyScopeRequiredError extends Error {
  constructor() {
    super('Commercial Thesis apply requires one explicit organization.')
    this.name = 'CommercialThesisApplyScopeRequiredError'
  }
}

export class CommercialThesisHistoryLimitExceededError extends Error {
  constructor(organizationId: string) {
    super(
      `Commercial Thesis episode input exceeds the bounded limit for organization ${organizationId}.`,
    )
    this.name = 'CommercialThesisHistoryLimitExceededError'
  }
}

type CommercialThesisEpisodeRow = CommercialThesisEpisodeInput

export async function buildCommercialThesesJob(
  options: CommercialThesisJobOptions = {},
  providedDb: CommercialThesisJobDb | null = null,
): Promise<CommercialThesisJobStats> {
  const enabled = options.enabled !== false &&
    isCommercialThesisV1Enabled(options.env)
  const stats = emptyStats(enabled, options.dryRun !== false)
  if (!enabled) return stats
  if (!stats.dryRun && options.organizationId == null) {
    throw new CommercialThesisApplyScopeRequiredError()
  }

  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')
  const batchSize = clampCommercialThesisJobBatchSize(
    options.batchSize ?? COMMERCIAL_THESIS_V1_LIMITS.defaultJobBatchSize,
  )
  const now = validDate(options.now ?? new Date())
  const ownsClient = 'connect' in database && !('release' in database)
  const jobDb = ownsClient && 'connect' in database
    ? await database.connect()
    : database
  try {
    await jobDb.query(
      `SELECT set_config('statement_timeout', $1, false)`,
      [`${COMMERCIAL_THESIS_V1_LIMITS.statementTimeoutMs}ms`],
    )
    return await executeJob(options, stats, batchSize, now, jobDb)
  } finally {
    await jobDb.query('RESET statement_timeout').catch((error) => {
      logError('commercial_thesis.statement_timeout_reset_failed', error)
    })
    if (ownsClient && 'release' in jobDb) jobDb.release()
  }
}

async function executeJob(
  options: CommercialThesisJobOptions,
  stats: CommercialThesisJobStats,
  batchSize: number,
  now: Date,
  database: CommercialThesisJobDb,
): Promise<CommercialThesisJobStats> {
  const organizations = await database.query<{ organizationId: string }>(
    `WITH latest AS (
       SELECT DISTINCT ON (episode.organization_id, episode.episode_identity)
         episode.id,
         episode.organization_id
       FROM signal_episodes episode
       WHERE episode.engine_version = $2
       ORDER BY
         episode.organization_id,
         episode.episode_identity,
         episode.episode_generation DESC,
         episode.id DESC
     )
     SELECT latest.organization_id::TEXT AS "organizationId"
     FROM latest
     WHERE ($1::BIGINT IS NULL OR latest.organization_id = $1)
       AND NOT EXISTS (
         SELECT 1
         FROM commercial_theses thesis
         WHERE thesis.signal_episode_id = latest.id
           AND thesis.organization_id = latest.organization_id
           AND thesis.engine_version = $3
       )
     GROUP BY latest.organization_id
     ORDER BY MIN(latest.id)
     LIMIT $4`,
    [
      options.organizationId == null ? null : String(options.organizationId),
      SIGNAL_EPISODE_ENGINE_VERSION,
      COMMERCIAL_THESIS_ENGINE_VERSION,
      batchSize,
    ],
  )

  for (const organization of organizations.rows) {
    stats.scanned += 1
    try {
      const episodes = await loadLatestEpisodes(
        organization.organizationId,
        database,
      )
      if (
        episodes.length >
        COMMERCIAL_THESIS_V1_LIMITS.maximumEpisodesPerOrganization
      ) {
        throw new CommercialThesisHistoryLimitExceededError(
          organization.organizationId,
        )
      }
      for (const episode of episodes) {
        stats.episodesScanned += 1
        const build = buildCommercialThesis(episode, { now })
        stats.rejected += build.rejections.length
        for (const thesis of build.theses) {
          stats.built += 1
          stats[episode.stage] += 1
          if (stats.dryRun) continue
          const persisted = await persistCommercialThesis(
            thesis,
            database as CommercialThesisDb,
          )
          if (persisted.inserted) stats.thesesPersisted += 1
          else stats.replayed += 1
        }
      }
    } catch (error) {
      stats.failed += 1
      logError('commercial_thesis.build_failed', error, {
        organizationId: organization.organizationId,
      })
    }
  }

  logEvent('commercial_thesis.build_completed', {
    dryRun: stats.dryRun,
    scanned: stats.scanned,
    episodesScanned: stats.episodesScanned,
    built: stats.built,
    active: stats.active,
    cooling: stats.cooling,
    expired: stats.expired,
    thesesPersisted: stats.thesesPersisted,
    replayed: stats.replayed,
    rejected: stats.rejected,
    failed: stats.failed,
  })
  return stats
}

async function loadLatestEpisodes(
  organizationId: string,
  database: CommercialThesisJobDb,
): Promise<CommercialThesisEpisodeInput[]> {
  const result = await database.query<CommercialThesisEpisodeRow>(
    `WITH latest AS (
       SELECT DISTINCT ON (episode.organization_id, episode.episode_identity)
         episode.id
       FROM signal_episodes episode
       WHERE episode.organization_id = $1
         AND episode.engine_version = $2
       ORDER BY
         episode.organization_id,
         episode.episode_identity,
         episode.episode_generation DESC,
         episode.id DESC
     )
     SELECT
       episode.id::TEXT AS id,
       episode.organization_id::TEXT AS "organizationId",
       episode.episode_identity AS "episodeIdentity",
       episode.episode_generation AS "episodeGeneration",
       episode.episode_type AS "episodeType",
       episode.stage,
       episode.started_at::TEXT AS "startedAt",
       episode.last_seen_at::TEXT AS "lastSeenAt",
       episode.valid_until::TEXT AS "validUntil",
       episode.intensity,
       episode.direction,
       episode.baseline_deviation AS "baselineDeviation",
       episode.role_families AS "roleFamilies",
       episode.regions,
       episode.seniority_distribution AS "seniorityDistribution",
       episode.problem_hypotheses AS "problemHypotheses",
       COALESCE((
         SELECT ARRAY_AGG(link.evidence_id::TEXT ORDER BY link.evidence_id)
         FROM signal_episode_evidence link
         WHERE link.signal_episode_id = episode.id
           AND link.organization_id = episode.organization_id
       ), ARRAY[]::TEXT[]) AS "evidenceRefs",
       episode.evidence_hash AS "evidenceHash",
       episode.input_hash AS "inputHash",
       episode.engine_version AS "engineVersion"
     FROM signal_episodes episode
     JOIN latest ON latest.id = episode.id
     WHERE NOT EXISTS (
       SELECT 1
       FROM commercial_theses thesis
       WHERE thesis.signal_episode_id = episode.id
         AND thesis.organization_id = episode.organization_id
         AND thesis.engine_version = $3
     )
     ORDER BY episode.id
     LIMIT $4`,
    [
      organizationId,
      SIGNAL_EPISODE_ENGINE_VERSION,
      COMMERCIAL_THESIS_ENGINE_VERSION,
      COMMERCIAL_THESIS_V1_LIMITS.maximumEpisodesPerOrganization + 1,
    ],
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    organizationId: String(row.organizationId),
    episodeIdentity: String(row.episodeIdentity),
    episodeGeneration: Number(row.episodeGeneration),
    episodeType: row.episodeType,
    stage: row.stage,
    startedAt: String(row.startedAt),
    lastSeenAt: String(row.lastSeenAt),
    validUntil: String(row.validUntil),
    intensity: Number(row.intensity),
    direction: row.direction,
    baselineDeviation: row.baselineDeviation === null
      ? null
      : Number(row.baselineDeviation),
    roleFamilies: stringArray(row.roleFamilies),
    regions: stringArray(row.regions),
    seniorityDistribution: numberRecord(row.seniorityDistribution),
    problemHypotheses: stringArray(row.problemHypotheses),
    evidenceRefs: stringArray(row.evidenceRefs),
    evidenceHash: String(row.evidenceHash),
    inputHash: String(row.inputHash),
    engineVersion: row.engineVersion,
  }))
}

function emptyStats(
  enabled: boolean,
  dryRun: boolean,
): CommercialThesisJobStats {
  return {
    enabled,
    dryRun,
    scanned: 0,
    episodesScanned: 0,
    built: 0,
    active: 0,
    cooling: 0,
    expired: 0,
    thesesPersisted: 0,
    replayed: 0,
    rejected: 0,
    failed: 0,
  }
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('Commercial Thesis job now must be a valid date.')
  }
  return value
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).map(([key, count]) => [key, Number(count)]),
  )
}
