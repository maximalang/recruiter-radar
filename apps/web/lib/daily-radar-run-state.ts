import { getPool } from '@/lib/db-pool'

export interface DailyRadarLease {
  acquired: boolean
  runDate: string
  persisted: boolean
}

const STALE_RUNNING_INTERVAL = '2 hours'

export async function claimDailyRadarRun(now = new Date()): Promise<DailyRadarLease> {
  const runDate = now.toISOString().slice(0, 10)
  const pool = getPool()
  if (!pool) return { acquired: true, runDate, persisted: false }

  const result = await pool.query<{ runDate: string }>(
    `INSERT INTO daily_radar_run_state (
       run_date, status, started_at, completed_at, attempt_count, updated_at
     ) VALUES ($1::DATE, 'running', $2::TIMESTAMPTZ, NULL, 1, NOW())
     ON CONFLICT (run_date) DO UPDATE SET
       status = 'running',
       started_at = EXCLUDED.started_at,
       completed_at = NULL,
       attempt_count = daily_radar_run_state.attempt_count + 1,
       updated_at = NOW()
     WHERE daily_radar_run_state.status = 'failed'
        OR (
          daily_radar_run_state.status = 'running'
          AND daily_radar_run_state.started_at < NOW() - $3::INTERVAL
        )
     RETURNING run_date::TEXT AS "runDate"`,
    [runDate, now.toISOString(), STALE_RUNNING_INTERVAL],
  )
  return {
    acquired: result.rowCount === 1,
    runDate,
    persisted: true,
  }
}

export async function finishDailyRadarRun(
  lease: DailyRadarLease,
  status: 'completed' | 'failed',
  now = new Date(),
): Promise<void> {
  if (!lease.persisted || !lease.acquired) return
  const pool = getPool()
  if (!pool) return
  await pool.query(
    `UPDATE daily_radar_run_state
     SET status = $2,
         completed_at = $3::TIMESTAMPTZ,
         updated_at = NOW()
     WHERE run_date = $1::DATE
       AND status = 'running'`,
    [lease.runDate, status, now.toISOString()],
  )
}
