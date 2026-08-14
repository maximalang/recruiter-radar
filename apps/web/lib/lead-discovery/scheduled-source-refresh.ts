import { getPool } from '@/lib/db-pool'
import {
  getDailySupportingSourceIds,
  getPrimarySourceIds,
  type SourceId,
} from '@/lib/sources/source-registry'
import {
  ingestSource,
  type IngestResult,
  type NoActiveProfilesResult,
} from './source-ingest'
import { runSupportingSourceScheduler } from './supporting-source-scheduler'

export type ScheduledSourceRefreshResult = IngestResult[] | NoActiveProfilesResult

const SOURCE_REFRESH_LOCK_KEY = 'recruiter-radar:source-refresh-runtime:v1'

/**
 * Cadence-aware source refresh independent from digest/delivery execution.
 * Primary and supporting sources share the same persisted scheduler state, so
 * an hourly clock can safely call this function while each source keeps its own
 * 1h/3h/6h/12h/24h/7d cadence and cooldown policy.
 *
 * A PostgreSQL session advisory lock covers the whole scheduler run. This is
 * deliberately above the per-host/global semaphores: only one scheduler process
 * may own execution at once, so concurrency caps remain globally true even if a
 * manual trigger races the scheduled workflow. The lock is released by the
 * session automatically on crash/disconnect.
 */
export async function runScheduledSourceRefresh(
  env?: Record<string, string>,
): Promise<ScheduledSourceRefreshResult> {
  const sources = uniqueSources([
    ...getPrimarySourceIds(),
    ...getDailySupportingSourceIds(),
  ])
  const pool = getPool()
  if (!pool) {
    return runSupportingSourceScheduler({
      sources,
      run: (source) => ingestSource(source, env),
      db: null,
      env,
    })
  }

  const client = await pool.connect()
  let lockAcquired = false
  try {
    const result = await client.query<{ count: string }>(`
      SELECT COUNT(*)::TEXT AS count
      FROM client_profiles
      WHERE is_active = TRUE
    `)
    if (Number(result.rows[0]?.count ?? '0') === 0) {
      return {
        error: 'no_active_profiles',
        hint: 'run scripts/e2e/seed-test-profile.sql',
      }
    }

    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
      [SOURCE_REFRESH_LOCK_KEY],
    )
    lockAcquired = lock.rows[0]?.locked === true
    if (!lockAcquired) {
      return sources.map((source) => ({
        source,
        success: true,
        outcome: 'deferred' as const,
        fetchedCount: 0,
        upsertedCount: 0,
        diagnostics: { zeroReason: 'source-refresh-overlap' },
      }))
    }

    return await runSupportingSourceScheduler({
      sources,
      run: (source) => ingestSource(source, env),
      db: client,
      env,
    })
  } finally {
    if (lockAcquired) {
      await client.query(
        `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
        [SOURCE_REFRESH_LOCK_KEY],
      ).catch(() => undefined)
    }
    client.release()
  }
}

function uniqueSources(values: SourceId[]): SourceId[] {
  return [...new Set(values)]
}
