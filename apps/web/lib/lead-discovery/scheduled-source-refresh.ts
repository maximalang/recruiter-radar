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

/**
 * Cadence-aware source refresh independent from digest/delivery execution.
 * Primary and supporting sources share the same persisted scheduler state, so
 * an hourly clock can safely call this function while each source keeps its own
 * 1h/3h/6h/12h/24h/7d cadence and cooldown policy.
 */
export async function runScheduledSourceRefresh(
  env?: Record<string, string>,
): Promise<ScheduledSourceRefreshResult> {
  const pool = getPool()
  if (pool) {
    const result = await pool.query<{ count: string }>(`
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
  }

  const sources = uniqueSources([
    ...getPrimarySourceIds(),
    ...getDailySupportingSourceIds(),
  ])
  return runSupportingSourceScheduler({
    sources,
    run: (source) => ingestSource(source, env),
    db: pool,
    env,
  })
}

function uniqueSources(values: SourceId[]): SourceId[] {
  return [...new Set(values)]
}
