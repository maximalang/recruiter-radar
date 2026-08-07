import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  COMPANY_STATE_V1_LIMITS,
  clampCompanyStateJobBatchSize,
  isCompanyStateV1Enabled,
} from './config'
import {
  buildCompanyStateSnapshot,
  COMPANY_STATE_FEATURE_VERSION,
  type CompanyStateEventInput,
} from './company-state'
import {
  persistCompanyStateBuild,
  type CompanyStateDb,
} from './company-state-repository'

export type CompanyStateJobDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type CompanyStateJobOptions = {
  organizationId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  now?: Date
  enabled?: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export type CompanyStateJobStats = {
  enabled: boolean
  dryRun: boolean
  scanned: number
  built: number
  lowHistory: number
  changesDetected: number
  snapshotsPersisted: number
  changesPersisted: number
  rejected: number
  failed: number
}

export class CompanyStateApplyScopeRequiredError extends Error {
  constructor() {
    super('Company State apply requires one explicit organization.')
    this.name = 'CompanyStateApplyScopeRequiredError'
  }
}

export class CompanyStateHistoryLimitExceededError extends Error {
  constructor(organizationId: string) {
    super(
      `Company State history exceeds the bounded limit for organization ${organizationId}.`,
    )
    this.name = 'CompanyStateHistoryLimitExceededError'
  }
}

type CompanyStateEventRow = CompanyStateEventInput

export async function buildCompanyStateJob(
  options: CompanyStateJobOptions = {},
  providedDb: CompanyStateJobDb | null = null,
): Promise<CompanyStateJobStats> {
  const enabled = options.enabled !== false && isCompanyStateV1Enabled(options.env)
  const stats = emptyJobStats(enabled, options.dryRun !== false)
  if (!enabled) return stats
  if (!stats.dryRun && options.organizationId == null) {
    throw new CompanyStateApplyScopeRequiredError()
  }

  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')
  const batchSize = clampCompanyStateJobBatchSize(
    options.batchSize ?? COMPANY_STATE_V1_LIMITS.defaultJobBatchSize,
  )
  const now = validDate(options.now ?? new Date())
  const ownsClient = 'connect' in database && !('release' in database)
  const jobDb = ownsClient && 'connect' in database
    ? await database.connect()
    : database
  try {
    await jobDb.query(
      `SELECT set_config('statement_timeout', $1, false)`,
      [`${COMPANY_STATE_V1_LIMITS.statementTimeoutMs}ms`],
    )
    return await executeCompanyStateJob(options, stats, batchSize, now, jobDb)
  } finally {
    await jobDb.query('RESET statement_timeout').catch((error) => {
      logError('company_state.statement_timeout_reset_failed', error)
    })
    if (ownsClient && 'release' in jobDb) jobDb.release()
  }
}

async function executeCompanyStateJob(
  options: CompanyStateJobOptions,
  stats: CompanyStateJobStats,
  batchSize: number,
  now: Date,
  database: CompanyStateJobDb,
): Promise<CompanyStateJobStats> {
  const historyStartedAt = new Date(
    now.getTime() - COMPANY_STATE_V1_LIMITS.historyWindowDays * 86_400_000,
  )
  const organizations = await database.query<{ organizationId: string }>(
    `SELECT event.organization_id::TEXT AS "organizationId"
     FROM company_events event
     LEFT JOIN LATERAL (
       SELECT snapshot.id, snapshot.snapshot_at
       FROM company_state_snapshots snapshot
       WHERE snapshot.organization_id = event.organization_id
         AND snapshot.feature_version = $3
       ORDER BY snapshot.snapshot_at DESC, snapshot.id DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE ($1::BIGINT IS NULL OR event.organization_id = $1)
       AND event.occurred_at >= $2::TIMESTAMPTZ
       AND event.last_seen_at <= $4::TIMESTAMPTZ
       AND (
         latest.id IS NULL
         OR latest.snapshot_at < DATE_TRUNC('day', $4::TIMESTAMPTZ)
         OR event.last_seen_at > latest.snapshot_at
         OR NOT EXISTS (
           SELECT 1
           FROM company_state_snapshot_events snapshot_event
           WHERE snapshot_event.snapshot_id = latest.id
             AND snapshot_event.organization_id = event.organization_id
             AND snapshot_event.company_event_id = event.id
         )
       )
     GROUP BY event.organization_id
     ORDER BY MIN(event.id)
     LIMIT $5`,
    [
      options.organizationId == null ? null : String(options.organizationId),
      historyStartedAt.toISOString(),
      COMPANY_STATE_FEATURE_VERSION,
      now.toISOString(),
      batchSize,
    ],
  )

  for (const organization of organizations.rows) {
    stats.scanned += 1
    try {
      const events = await loadCompanyStateEvents(
        organization.organizationId,
        historyStartedAt,
        now,
        database,
      )
      if (events.length > COMPANY_STATE_V1_LIMITS.maximumEventsPerOrganization) {
        throw new CompanyStateHistoryLimitExceededError(
          organization.organizationId,
        )
      }
      const build = buildCompanyStateSnapshot(events, {
        organizationId: organization.organizationId,
        snapshotAt: now,
        historyWindowDays: COMPANY_STATE_V1_LIMITS.historyWindowDays,
      })
      stats.rejected += build.rejections.length
      if (!build.snapshot) continue
      stats.built += 1
      stats.changesDetected += build.changes.length
      if (!build.snapshot.hiringBaseline.sufficientHistory) {
        stats.lowHistory += 1
      }
      if (stats.dryRun) continue

      const persisted = await persistCompanyStateBuild(
        build,
        database as CompanyStateDb,
      )
      stats.snapshotsPersisted += persisted.snapshotInserted ? 1 : 0
      stats.changesPersisted += persisted.changesInserted
    } catch (error) {
      stats.failed += 1
      logError('company_state.build_failed', error, {
        organizationId: organization.organizationId,
      })
    }
  }

  logEvent('company_state.build_completed', {
    dryRun: stats.dryRun,
    scanned: stats.scanned,
    built: stats.built,
    lowHistory: stats.lowHistory,
    changesDetected: stats.changesDetected,
    snapshotsPersisted: stats.snapshotsPersisted,
    changesPersisted: stats.changesPersisted,
    rejected: stats.rejected,
    failed: stats.failed,
  })
  return stats
}

async function loadCompanyStateEvents(
  organizationId: string,
  historyStartedAt: Date,
  now: Date,
  db: CompanyStateJobDb,
): Promise<CompanyStateEventInput[]> {
  const result = await db.query<CompanyStateEventRow>(
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
       AND event.occurred_at >= $2::TIMESTAMPTZ
       AND event.last_seen_at <= $3::TIMESTAMPTZ
     ORDER BY event.occurred_at ASC, event.id ASC
     LIMIT $4`,
    [
      organizationId,
      historyStartedAt.toISOString(),
      now.toISOString(),
      COMPANY_STATE_V1_LIMITS.maximumEventsPerOrganization + 1,
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
    evidenceIds: Array.isArray(row.evidenceIds)
      ? row.evidenceIds.map(String)
      : [],
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? { ...row.payload }
      : {},
  }))
}

function emptyJobStats(enabled: boolean, dryRun: boolean): CompanyStateJobStats {
  return {
    enabled,
    dryRun,
    scanned: 0,
    built: 0,
    lowHistory: 0,
    changesDetected: 0,
    snapshotsPersisted: 0,
    changesPersisted: 0,
    rejected: 0,
    failed: 0,
  }
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('Company State job now must be a valid date.')
  }
  return value
}
