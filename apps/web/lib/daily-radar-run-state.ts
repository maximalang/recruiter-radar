import { randomUUID } from 'node:crypto'
import { getPool } from '@/lib/db-pool'

export type DailyRadarRunStatus = 'completed' | 'partial' | 'failed'
export type DailyRadarProfileStatus = 'completed' | 'failed' | 'skipped'

export interface DailyRadarLease {
  acquired: boolean
  runDate: string
  leaseId: string
  attemptCount: number
  persisted: boolean
  reason?: 'already-completed' | 'retry-backoff' | 'attempt-limit' | 'already-running'
  nextRetryAt?: string | null
}

export interface DailyRadarProfileLease {
  acquired: boolean
  runDate: string
  clientProfileId: string
  leaseId: string
  attemptCount: number
  digestRunId: string | null
  status: 'running' | DailyRadarProfileStatus
  persisted: boolean
}

const STALE_RUNNING_INTERVAL = '2 hours'
const MAX_DAILY_ATTEMPTS = 3
const MAX_PROFILE_ATTEMPTS = 3
const RETRY_BASE_SECONDS = 30

export async function claimDailyRadarRun(now = new Date()): Promise<DailyRadarLease> {
  const runDate = now.toISOString().slice(0, 10)
  const leaseId = randomUUID()
  const pool = getPool()
  if (!pool) {
    return { acquired: true, runDate, leaseId, attemptCount: 1, persisted: false }
  }

  const result = await pool.query<{ runDate: string; leaseId: string; attemptCount: number }>(
    `INSERT INTO daily_radar_run_state (
       run_date, lease_id, status, started_at, completed_at, next_retry_at,
       attempt_count, source_refresh_result, temporal_result, updated_at
     ) VALUES ($1::DATE, $2::UUID, 'running', $3::TIMESTAMPTZ, NULL, NULL, 1, NULL, NULL, $3::TIMESTAMPTZ)
     ON CONFLICT (run_date) DO UPDATE SET
       lease_id = EXCLUDED.lease_id,
       status = 'running',
       started_at = EXCLUDED.started_at,
       completed_at = NULL,
       next_retry_at = NULL,
       attempt_count = daily_radar_run_state.attempt_count + 1,
       updated_at = EXCLUDED.updated_at
     WHERE daily_radar_run_state.attempt_count < $4
       AND (
         (
           daily_radar_run_state.status IN ('partial', 'failed')
           AND COALESCE(daily_radar_run_state.next_retry_at, '-infinity'::TIMESTAMPTZ) <= $3::TIMESTAMPTZ
         )
         OR (
           daily_radar_run_state.status = 'running'
           AND daily_radar_run_state.updated_at < $3::TIMESTAMPTZ - $5::INTERVAL
         )
       )
     RETURNING
       run_date::TEXT AS "runDate",
       lease_id::TEXT AS "leaseId",
       attempt_count AS "attemptCount"`,
    [runDate, leaseId, now.toISOString(), MAX_DAILY_ATTEMPTS, STALE_RUNNING_INTERVAL],
  )

  if (result.rowCount === 1) {
    const row = result.rows[0]
    return {
      acquired: true,
      runDate: row.runDate,
      leaseId: row.leaseId,
      attemptCount: row.attemptCount,
      persisted: true,
    }
  }

  const state = await pool.query<{
    status: string
    attemptCount: number
    nextRetryAt: string | null
  }>(
    `SELECT
       status,
       attempt_count AS "attemptCount",
       next_retry_at::TEXT AS "nextRetryAt"
     FROM daily_radar_run_state
     WHERE run_date = $1::DATE`,
    [runDate],
  )
  const current = state.rows[0]
  const reason = current?.status === 'completed'
    ? 'already-completed'
    : (current?.attemptCount ?? 0) >= MAX_DAILY_ATTEMPTS
      ? 'attempt-limit'
      : current?.status === 'running'
        ? 'already-running'
        : 'retry-backoff'

  return {
    acquired: false,
    runDate,
    leaseId,
    attemptCount: current?.attemptCount ?? 0,
    persisted: true,
    reason,
    nextRetryAt: current?.nextRetryAt ?? null,
  }
}

export async function heartbeatDailyRadarRun(
  lease: DailyRadarLease,
  now = new Date(),
): Promise<boolean> {
  if (!lease.persisted || !lease.acquired) return true
  const pool = getPool()
  if (!pool) return false
  const result = await pool.query(
    `UPDATE daily_radar_run_state
     SET updated_at = $3::TIMESTAMPTZ
     WHERE run_date = $1::DATE
       AND lease_id = $2::UUID
       AND status = 'running'`,
    [lease.runDate, lease.leaseId, now.toISOString()],
  )
  return result.rowCount === 1
}

export async function recordDailyRadarSourceRefreshResult(
  lease: DailyRadarLease,
  value: unknown,
): Promise<boolean> {
  return recordPhaseResult(lease, 'source_refresh_result', value)
}

export async function recordDailyRadarTemporalResult(
  lease: DailyRadarLease,
  value: unknown,
): Promise<boolean> {
  return recordPhaseResult(lease, 'temporal_result', value)
}

async function recordPhaseResult(
  lease: DailyRadarLease,
  column: 'source_refresh_result' | 'temporal_result',
  value: unknown,
): Promise<boolean> {
  if (!lease.persisted || !lease.acquired) return true
  const pool = getPool()
  if (!pool) return false
  const result = await pool.query(
    `UPDATE daily_radar_run_state
     SET ${column} = $3::JSONB,
         updated_at = NOW()
     WHERE run_date = $1::DATE
       AND lease_id = $2::UUID
       AND status = 'running'`,
    [lease.runDate, lease.leaseId, JSON.stringify(value ?? null)],
  )
  return result.rowCount === 1
}

export async function finishDailyRadarRun(
  lease: DailyRadarLease,
  status: DailyRadarRunStatus,
  now = new Date(),
): Promise<boolean> {
  if (!lease.persisted || !lease.acquired) return true
  const pool = getPool()
  if (!pool) return false
  const retrySeconds = RETRY_BASE_SECONDS * (2 ** Math.max(0, lease.attemptCount - 1))
  const result = await pool.query(
    `UPDATE daily_radar_run_state
     SET status = $3,
         completed_at = $4::TIMESTAMPTZ,
         next_retry_at = CASE
           WHEN $3 IN ('partial', 'failed') AND attempt_count < $5
             THEN $4::TIMESTAMPTZ + ($6::INT * INTERVAL '1 second')
           ELSE NULL
         END,
         updated_at = $4::TIMESTAMPTZ
     WHERE run_date = $1::DATE
       AND lease_id = $2::UUID
       AND status = 'running'`,
    [
      lease.runDate,
      lease.leaseId,
      status,
      now.toISOString(),
      MAX_DAILY_ATTEMPTS,
      retrySeconds,
    ],
  )
  return result.rowCount === 1
}

export async function claimDailyRadarProfile(
  lease: DailyRadarLease,
  clientProfileId: string,
  now = new Date(),
): Promise<DailyRadarProfileLease> {
  if (!lease.persisted) {
    return {
      acquired: true,
      runDate: lease.runDate,
      clientProfileId,
      leaseId: lease.leaseId,
      attemptCount: 1,
      digestRunId: null,
      status: 'running',
      persisted: false,
    }
  }
  const pool = getPool()
  if (!pool) {
    return {
      acquired: false,
      runDate: lease.runDate,
      clientProfileId,
      leaseId: lease.leaseId,
      attemptCount: 0,
      digestRunId: null,
      status: 'failed',
      persisted: true,
    }
  }

  const result = await pool.query<{
    attemptCount: number
    digestRunId: string | null
  }>(
    `INSERT INTO daily_radar_profile_run_state (
       run_date, client_profile_id, lease_id, digest_run_id, status,
       started_at, completed_at, attempt_count, last_error, updated_at
     )
     SELECT $1::DATE, $2::BIGINT, $3::UUID, NULL, 'running',
            $4::TIMESTAMPTZ, NULL, 1, NULL, $4::TIMESTAMPTZ
     WHERE EXISTS (
       SELECT 1 FROM daily_radar_run_state
       WHERE run_date = $1::DATE
         AND lease_id = $3::UUID
         AND status = 'running'
     )
     ON CONFLICT (run_date, client_profile_id) DO UPDATE SET
       lease_id = EXCLUDED.lease_id,
       status = 'running',
       started_at = EXCLUDED.started_at,
       completed_at = NULL,
       attempt_count = daily_radar_profile_run_state.attempt_count + 1,
       last_error = NULL,
       updated_at = EXCLUDED.updated_at
     WHERE daily_radar_profile_run_state.status = 'failed'
       AND daily_radar_profile_run_state.attempt_count < $5
       AND EXISTS (
         SELECT 1 FROM daily_radar_run_state
         WHERE run_date = $1::DATE
           AND lease_id = $3::UUID
           AND status = 'running'
       )
     RETURNING
       attempt_count AS "attemptCount",
       digest_run_id::TEXT AS "digestRunId"`,
    [lease.runDate, clientProfileId, lease.leaseId, now.toISOString(), MAX_PROFILE_ATTEMPTS],
  )

  if (result.rowCount === 1) {
    return {
      acquired: true,
      runDate: lease.runDate,
      clientProfileId,
      leaseId: lease.leaseId,
      attemptCount: result.rows[0].attemptCount,
      digestRunId: result.rows[0].digestRunId,
      status: 'running',
      persisted: true,
    }
  }

  const state = await pool.query<{
    status: DailyRadarProfileLease['status']
    attemptCount: number
    digestRunId: string | null
  }>(
    `SELECT
       status::TEXT AS status,
       attempt_count AS "attemptCount",
       digest_run_id::TEXT AS "digestRunId"
     FROM daily_radar_profile_run_state
     WHERE run_date = $1::DATE
       AND client_profile_id = $2::BIGINT`,
    [lease.runDate, clientProfileId],
  )
  const row = state.rows[0]
  return {
    acquired: false,
    runDate: lease.runDate,
    clientProfileId,
    leaseId: lease.leaseId,
    attemptCount: row?.attemptCount ?? 0,
    digestRunId: row?.digestRunId ?? null,
    status: row?.status ?? 'failed',
    persisted: true,
  }
}

export async function attachDailyRadarProfileDigestRun(
  profileLease: DailyRadarProfileLease,
  digestRunId: string,
): Promise<boolean> {
  if (!profileLease.persisted || !profileLease.acquired) {
    profileLease.digestRunId = digestRunId
    return true
  }
  const pool = getPool()
  if (!pool) return false
  const result = await pool.query(
    `UPDATE daily_radar_profile_run_state
     SET digest_run_id = $4::BIGINT,
         updated_at = NOW()
     WHERE run_date = $1::DATE
       AND client_profile_id = $2::BIGINT
       AND lease_id = $3::UUID
       AND status = 'running'`,
    [profileLease.runDate, profileLease.clientProfileId, profileLease.leaseId, digestRunId],
  )
  if (result.rowCount === 1) profileLease.digestRunId = digestRunId
  return result.rowCount === 1
}

export async function finishDailyRadarProfile(
  profileLease: DailyRadarProfileLease,
  status: DailyRadarProfileStatus,
  error: string | null = null,
  now = new Date(),
): Promise<boolean> {
  if (!profileLease.persisted || !profileLease.acquired) return true
  const pool = getPool()
  if (!pool) return false
  const result = await pool.query(
    `UPDATE daily_radar_profile_run_state
     SET status = $4,
         completed_at = $5::TIMESTAMPTZ,
         last_error = LEFT($6, 2000),
         updated_at = $5::TIMESTAMPTZ
     WHERE run_date = $1::DATE
       AND client_profile_id = $2::BIGINT
       AND lease_id = $3::UUID
       AND status = 'running'`,
    [
      profileLease.runDate,
      profileLease.clientProfileId,
      profileLease.leaseId,
      status,
      now.toISOString(),
      error,
    ],
  )
  return result.rowCount === 1
}
