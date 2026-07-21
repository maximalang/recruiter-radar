import { getPool } from './db-pool'

export type SourceFreshnessRow = {
  source: string
  latestOccurredAt: string
  lagHours: number
  signalCount: number
}

export async function getSourceFreshnessReport(): Promise<SourceFreshnessRow[]> {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is not configured.')

  const result = await pool.query<{
    source: string
    latest_occurred_at: string
    lag_hours: number
    signal_count: number
  }>(
    `
      SELECT
        source,
        MAX(occurred_at)::TEXT AS latest_occurred_at,
        GREATEST(
          0,
          EXTRACT(EPOCH FROM (NOW() - MAX(occurred_at))) / 3600
        )::FLOAT8 AS lag_hours,
        COUNT(*)::INT AS signal_count
      FROM signals
      GROUP BY source
      ORDER BY source
    `,
  )

  return result.rows.map((row) => ({
    source: row.source,
    latestOccurredAt: row.latest_occurred_at,
    lagHours: Math.round(row.lag_hours * 100) / 100,
    signalCount: row.signal_count,
  }))
}
