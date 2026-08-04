import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  clampExternalAgencyPropensityJobBatchSize,
  EXTERNAL_AGENCY_PROPENSITY_V1_LIMITS,
  isExternalAgencyPropensityV1Enabled,
} from './config'
import {
  buildExternalAgencyPropensity,
  EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
  type ExternalAgencyPropensityInput,
} from './external-agency-propensity'
import {
  persistExternalAgencyPropensity,
  type ExternalAgencyPropensityDb,
} from './external-agency-propensity-repository'
import { COMMERCIAL_THESIS_ENGINE_VERSION } from './commercial-thesis'

export type ExternalAgencyPropensityJobDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type ExternalAgencyPropensityJobOptions = {
  workspaceId?: string | number | null
  organizationId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  now?: Date
  enabled?: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export type ExternalAgencyPropensityJobStats = {
  enabled: boolean
  dryRun: boolean
  scanned: number
  built: number
  high: number
  medium: number
  low: number
  insufficientEvidence: number
  persisted: number
  replayed: number
  failed: number
}

export class ExternalAgencyPropensityApplyScopeRequiredError extends Error {
  constructor() {
    super(
      'External Agency Propensity apply requires explicit workspace and organization.',
    )
    this.name = 'ExternalAgencyPropensityApplyScopeRequiredError'
  }
}

type ExternalAgencyPropensityCandidateRow = ExternalAgencyPropensityInput

export async function buildExternalAgencyPropensityJob(
  options: ExternalAgencyPropensityJobOptions = {},
  providedDb: ExternalAgencyPropensityJobDb | null = null,
): Promise<ExternalAgencyPropensityJobStats> {
  const enabled = options.enabled !== false &&
    isExternalAgencyPropensityV1Enabled(options.env)
  const stats = emptyStats(enabled, options.dryRun !== false)
  if (!enabled) return stats
  if (!stats.dryRun &&
      (options.workspaceId == null || options.organizationId == null)) {
    throw new ExternalAgencyPropensityApplyScopeRequiredError()
  }

  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')
  const batchSize = clampExternalAgencyPropensityJobBatchSize(
    options.batchSize ??
    EXTERNAL_AGENCY_PROPENSITY_V1_LIMITS.defaultJobBatchSize,
  )
  const now = validDate(options.now ?? new Date())
  const ownsClient = 'connect' in database && !('release' in database)
  const jobDb = ownsClient && 'connect' in database
    ? await database.connect()
    : database
  try {
    await jobDb.query(
      `SELECT set_config('statement_timeout', $1, false)`,
      [`${EXTERNAL_AGENCY_PROPENSITY_V1_LIMITS.statementTimeoutMs}ms`],
    )
    return await executeJob(options, stats, batchSize, now, jobDb)
  } finally {
    await jobDb.query('RESET statement_timeout').catch((error) => {
      logError('external_agency_propensity.statement_timeout_reset_failed', error)
    })
    if (ownsClient && 'release' in jobDb) jobDb.release()
  }
}

async function executeJob(
  options: ExternalAgencyPropensityJobOptions,
  stats: ExternalAgencyPropensityJobStats,
  batchSize: number,
  now: Date,
  database: ExternalAgencyPropensityJobDb,
): Promise<ExternalAgencyPropensityJobStats> {
  const candidates = await loadCandidates(options, batchSize, now, database)
  for (const candidate of candidates) {
    stats.scanned += 1
    try {
      const draft = buildExternalAgencyPropensity(candidate, { now })
      stats.built += 1
      countLevel(stats, draft.level)
      if (stats.dryRun) continue
      const persisted = await persistExternalAgencyPropensity(
        draft,
        database as ExternalAgencyPropensityDb,
      )
      if (persisted.inserted) stats.persisted += 1
      else stats.replayed += 1
    } catch (error) {
      stats.failed += 1
      logError('external_agency_propensity.build_failed', error, {
        organizationId: candidate.organizationId,
        workspaceId: candidate.workspaceId,
        clientProfileId: candidate.clientProfileId,
        commercialThesisId: candidate.commercialThesisId,
      })
    }
  }

  logEvent('external_agency_propensity.build_completed', {
    dryRun: stats.dryRun,
    scanned: stats.scanned,
    built: stats.built,
    high: stats.high,
    medium: stats.medium,
    low: stats.low,
    insufficientEvidence: stats.insufficientEvidence,
    persisted: stats.persisted,
    replayed: stats.replayed,
    failed: stats.failed,
  })
  return stats
}

async function loadCandidates(
  options: ExternalAgencyPropensityJobOptions,
  batchSize: number,
  now: Date,
  database: ExternalAgencyPropensityJobDb,
): Promise<ExternalAgencyPropensityInput[]> {
  const result = await database.query<ExternalAgencyPropensityCandidateRow>(
    `WITH latest_theses AS (
       SELECT DISTINCT ON (thesis.organization_id, thesis.thesis_identity)
         thesis.id,
         thesis.organization_id,
         thesis.thesis_identity,
         thesis.thesis_generation,
         thesis.input_hash,
         thesis.evidence_hash,
         episode.episode_type,
         episode.intensity,
         episode.last_seen_at,
         episode.valid_until,
         episode.role_families,
         episode.seniority_distribution
       FROM commercial_theses thesis
       JOIN signal_episodes episode
         ON episode.id = thesis.signal_episode_id
        AND episode.organization_id = thesis.organization_id
        AND episode.episode_generation = thesis.signal_episode_generation
       WHERE thesis.engine_version = $4
         AND ($2::BIGINT IS NULL OR thesis.organization_id = $2)
       ORDER BY
         thesis.organization_id,
         thesis.thesis_identity,
         thesis.thesis_generation DESC,
         thesis.id DESC
     )
     SELECT
       thesis.organization_id::TEXT AS "organizationId",
       profile.workspace_id::TEXT AS "workspaceId",
       profile.owner_id::TEXT AS "ownerId",
       profile.id::TEXT AS "clientProfileId",
       thesis.id::TEXT AS "commercialThesisId",
       thesis.thesis_generation AS "commercialThesisGeneration",
       thesis.thesis_identity AS "thesisIdentity",
       thesis.input_hash AS "thesisInputHash",
       thesis.evidence_hash AS "thesisEvidenceHash",
       profile.agency_dna_version AS "agencyDnaVersion",
       profile.agency_dna_snapshot_hash AS "agencyDnaSnapshotHash",
       thesis.episode_type AS "episodeType",
       thesis.intensity AS "episodeIntensity",
       thesis.last_seen_at::TEXT AS "episodeLastSeenAt",
       thesis.valid_until::TEXT AS "episodeValidUntil",
       thesis.role_families AS "roleFamilies",
       thesis.seniority_distribution AS "seniorityDistribution",
       COALESCE((
         SELECT ARRAY_AGG(link.evidence_id::TEXT ORDER BY link.evidence_id)
         FROM commercial_thesis_evidence link
         WHERE link.commercial_thesis_id = thesis.id
           AND link.organization_id = thesis.organization_id
       ), ARRAY[]::TEXT[]) AS "evidenceIds",
       COALESCE((
         SELECT ARRAY_AGG(DISTINCT item.source ORDER BY item.source)
         FROM commercial_thesis_evidence link
         JOIN evidence_items item
           ON item.id = link.evidence_id
          AND item.org_id = link.organization_id
         WHERE link.commercial_thesis_id = thesis.id
           AND link.organization_id = thesis.organization_id
       ), ARRAY[]::TEXT[]) AS "evidenceSourceFamilies",
       restriction.restriction_type AS "accountRestriction"
     FROM latest_theses thesis
     JOIN client_profiles profile
       ON ($1::BIGINT IS NULL OR profile.workspace_id = $1)
     LEFT JOIN agency_account_restrictions restriction
       ON restriction.workspace_id = profile.workspace_id
      AND restriction.client_profile_id = profile.id
      AND restriction.owner_id = profile.owner_id
      AND restriction.organization_id = thesis.organization_id
     WHERE NOT EXISTS (
       SELECT 1
       FROM external_agency_propensity_snapshots snapshot
       WHERE snapshot.organization_id = thesis.organization_id
         AND snapshot.workspace_id = profile.workspace_id
         AND snapshot.owner_id = profile.owner_id
         AND snapshot.client_profile_id = profile.id
         AND snapshot.commercial_thesis_id = thesis.id
         AND snapshot.commercial_thesis_generation = thesis.thesis_generation
         AND snapshot.agency_dna_version = profile.agency_dna_version
         AND snapshot.agency_dna_snapshot_hash = profile.agency_dna_snapshot_hash
         AND snapshot.feature_version = $5
         AND snapshot.feature_snapshot->>'episodeStage' = CASE
           WHEN $3::TIMESTAMPTZ >= thesis.valid_until THEN 'expired'
           WHEN $3::TIMESTAMPTZ >= thesis.last_seen_at +
             ((thesis.valid_until - thesis.last_seen_at) * 0.75) THEN 'cooling'
           ELSE 'active'
         END
     )
     ORDER BY
       profile.workspace_id,
       profile.id,
       thesis.organization_id,
       thesis.id
     LIMIT $6`,
    [
      options.workspaceId == null ? null : String(options.workspaceId),
      options.organizationId == null ? null : String(options.organizationId),
      now.toISOString(),
      COMMERCIAL_THESIS_ENGINE_VERSION,
      EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
      batchSize,
    ],
  )
  return result.rows.map(candidateFromRow)
}

function candidateFromRow(
  row: ExternalAgencyPropensityCandidateRow,
): ExternalAgencyPropensityInput {
  return {
    organizationId: String(row.organizationId),
    workspaceId: String(row.workspaceId),
    ownerId: String(row.ownerId),
    clientProfileId: String(row.clientProfileId),
    commercialThesisId: String(row.commercialThesisId),
    commercialThesisGeneration: Number(row.commercialThesisGeneration),
    thesisIdentity: String(row.thesisIdentity),
    thesisInputHash: String(row.thesisInputHash),
    thesisEvidenceHash: String(row.thesisEvidenceHash),
    agencyDnaVersion: Number(row.agencyDnaVersion),
    agencyDnaSnapshotHash: String(row.agencyDnaSnapshotHash),
    episodeType: row.episodeType,
    episodeIntensity: Number(row.episodeIntensity),
    episodeLastSeenAt: String(row.episodeLastSeenAt),
    episodeValidUntil: String(row.episodeValidUntil),
    roleFamilies: stringArray(row.roleFamilies),
    seniorityDistribution: numberRecord(row.seniorityDistribution),
    evidenceIds: stringArray(row.evidenceIds),
    evidenceSourceFamilies: stringArray(row.evidenceSourceFamilies),
    accountRestriction: row.accountRestriction,
  }
}

function countLevel(
  stats: ExternalAgencyPropensityJobStats,
  level: 'high' | 'medium' | 'low' | 'insufficient_evidence',
): void {
  if (level === 'insufficient_evidence') stats.insufficientEvidence += 1
  else stats[level] += 1
}

function emptyStats(
  enabled: boolean,
  dryRun: boolean,
): ExternalAgencyPropensityJobStats {
  return {
    enabled,
    dryRun,
    scanned: 0,
    built: 0,
    high: 0,
    medium: 0,
    low: 0,
    insufficientEvidence: 0,
    persisted: 0,
    replayed: 0,
    failed: 0,
  }
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('External Agency Propensity job now must be a valid date.')
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
