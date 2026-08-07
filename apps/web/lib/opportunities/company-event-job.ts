import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  COMPANY_EVENTS_V1_LIMITS,
  clampCompanyEventsJobBatchSize,
  isCompanyEventsV1Enabled,
} from './config'
import {
  normalizeJobPostingCompanyEvents,
  type CompanyEventSourceRecord,
} from './company-event-normalization'
import {
  normalizeAndPersistJobPostingEvents,
  type CompanyEventDb,
} from './company-events'

type CompanyEventJobDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type CompanyEventJobOptions = {
  organizationId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  now?: Date
  enabled?: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export type CompanyEventJobStats = {
  enabled: boolean
  dryRun: boolean
  scanned: number
  normalized: number
  rejected: number
  persisted: number
  publicationsAttached: number
  evidenceAttached: number
  failed: number
}

export class CompanyEventApplyScopeRequiredError extends Error {
  constructor() {
    super('Company Events apply requires one explicit organization.')
    this.name = 'CompanyEventApplyScopeRequiredError'
  }
}

type CompanyEventSignalRow = {
  id: string
  organizationId: string
  signalType: string
  title: string
  region: string | null
  source: string
  sourceUrl: string | null
  externalVacancyId: string | null
  occurredAt: string
  firstSeenAt: string
  lastSeenAt: string
  evidenceIds: unknown
  payload: unknown
}

export async function normalizeCompanyEventsJob(
  options: CompanyEventJobOptions = {},
  providedDb: CompanyEventJobDb | null = null,
): Promise<CompanyEventJobStats> {
  const enabled = options.enabled !== false &&
    isCompanyEventsV1Enabled(options.env)
  const stats = emptyJobStats(enabled, options.dryRun !== false)
  if (!enabled) return stats
  if (!stats.dryRun && options.organizationId == null) {
    throw new CompanyEventApplyScopeRequiredError()
  }

  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')
  const batchSize = clampCompanyEventsJobBatchSize(
    options.batchSize ?? COMPANY_EVENTS_V1_LIMITS.defaultJobBatchSize,
  )
  const ownsClient = 'connect' in database && !('release' in database)
  const jobDb = ownsClient && 'connect' in database
    ? await database.connect()
    : database
  try {
    await jobDb.query(
      `SELECT set_config('statement_timeout', $1, false)`,
      [`${COMPANY_EVENTS_V1_LIMITS.statementTimeoutMs}ms`],
    )
    return await executeCompanyEventsJob(options, stats, batchSize, jobDb)
  } finally {
    await jobDb.query('RESET statement_timeout').catch((error) => {
      logError('company_events.statement_timeout_reset_failed', error)
    })
    if (ownsClient && 'release' in jobDb) jobDb.release()
  }
}

async function executeCompanyEventsJob(
  options: CompanyEventJobOptions,
  stats: CompanyEventJobStats,
  batchSize: number,
  database: CompanyEventJobDb,
): Promise<CompanyEventJobStats> {
  const organizations = await database.query<{ organizationId: string }>(
    `SELECT signal.org_id::TEXT AS "organizationId"
     FROM signals signal
     WHERE signal.signal_type = 'job_posting'
       AND ($1::BIGINT IS NULL OR signal.org_id = $1)
       AND EXISTS (
         SELECT 1
         FROM evidence_items evidence
         WHERE evidence.org_id = signal.org_id
           AND evidence.url = signal.source_url
       )
       AND NOT EXISTS (
         SELECT 1
         FROM company_event_publications publication
         JOIN company_events existing_event
           ON existing_event.id = publication.company_event_id
          AND existing_event.organization_id = publication.organization_id
          AND existing_event.event_type = 'job_posting'
         WHERE publication.organization_id = signal.org_id
           AND publication.signal_id = signal.id
           AND publication.last_seen_at >= signal.updated_at
           AND NOT EXISTS (
             SELECT 1
             FROM evidence_items missing_evidence
             WHERE missing_evidence.org_id = signal.org_id
               AND missing_evidence.url = signal.source_url
               AND NOT (
                 missing_evidence.id = ANY(publication.evidence_ids)
               )
           )
       )
     GROUP BY signal.org_id
     ORDER BY MIN(signal.id)
     LIMIT $2`,
    [
      options.organizationId == null ? null : String(options.organizationId),
      batchSize,
    ],
  )

  for (const organization of organizations.rows) {
    stats.scanned += 1
    try {
      // Derived events such as repost/restart/salary-change need bounded
      // company history, not only the one newly changed source row. The
      // organization selector above still guarantees we do no work until a
      // fresh/evidence-changed observation arrives.
      const sourceRecords = await loadJobPostingSourceRecords(
        organization.organizationId,
        database,
        COMPANY_EVENTS_V1_LIMITS.maximumSourceRecordsPerOrganization,
      )
      if (stats.dryRun) {
        const preview = normalizeJobPostingCompanyEvents(
          sourceRecords,
          options.now,
        )
        stats.normalized += preview.events.length
        stats.rejected += preview.rejections.length
        continue
      }

      const result = await normalizeAndPersistJobPostingEvents(
        sourceRecords,
        database as CompanyEventDb,
        { env: options.env, now: options.now },
      )
      stats.normalized += result.normalized
      stats.rejected += result.rejected
      stats.persisted += result.persisted
      stats.publicationsAttached += result.publicationsAttached
      stats.evidenceAttached += result.evidenceAttached
    } catch (error) {
      stats.failed += 1
      logError('company_events.normalization_failed', error, {
        organizationId: organization.organizationId,
      })
    }
  }

  logEvent('company_events.normalization_completed', {
    dryRun: stats.dryRun,
    scanned: stats.scanned,
    normalized: stats.normalized,
    rejected: stats.rejected,
    persisted: stats.persisted,
    failed: stats.failed,
  })
  return stats
}

async function loadJobPostingSourceRecords(
  organizationId: string,
  db: CompanyEventJobDb,
  maximumRecords: number,
): Promise<CompanyEventSourceRecord[]> {
  const result = await db.query<CompanyEventSignalRow>(
    `SELECT
       signal.id::TEXT AS id,
       signal.org_id::TEXT AS "organizationId",
       signal.signal_type::TEXT AS "signalType",
       COALESCE(
         NULLIF(signal.payload->>'vacancy_name', ''),
         NULLIF(signal.payload->>'job_title', ''),
         NULLIF(signal.payload->>'title', ''),
         signal.headline
       ) AS title,
       COALESCE(
         NULLIF(signal.payload->>'region_canonical', ''),
         NULLIF(signal.payload->>'area_name', ''),
         NULLIF(signal.payload->>'location', ''),
         NULLIF(signal.payload->>'region_raw', '')
       ) AS region,
       signal.source,
       signal.source_url AS "sourceUrl",
       signal.external_id AS "externalVacancyId",
       signal.occurred_at::TEXT AS "occurredAt",
       signal.created_at::TEXT AS "firstSeenAt",
       signal.updated_at::TEXT AS "lastSeenAt",
       signal.payload,
       COALESCE(
         ARRAY_AGG(DISTINCT evidence.id::TEXT)
           FILTER (WHERE evidence.id IS NOT NULL),
         ARRAY[]::TEXT[]
       ) AS "evidenceIds"
     FROM signals signal
     INNER JOIN evidence_items evidence
       ON evidence.org_id = signal.org_id
      AND evidence.url = signal.source_url
     WHERE signal.org_id = $1
       AND signal.signal_type = 'job_posting'
     GROUP BY signal.id
     ORDER BY signal.occurred_at ASC, signal.id ASC
     LIMIT $2`,
    [organizationId, maximumRecords],
  )

  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    signalType: row.signalType,
    title: row.title,
    region: row.region,
    source: row.source,
    sourceUrl: row.sourceUrl,
    externalVacancyId: row.externalVacancyId,
    occurredAt: row.occurredAt,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    evidenceIds: stringArray(row.evidenceIds),
    payload: record(row.payload),
  }))
}

function emptyJobStats(enabled: boolean, dryRun: boolean): CompanyEventJobStats {
  return {
    enabled,
    dryRun,
    scanned: 0,
    normalized: 0,
    rejected: 0,
    persisted: 0,
    publicationsAttached: 0,
    evidenceAttached: 0,
    failed: 0,
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : {}
}
