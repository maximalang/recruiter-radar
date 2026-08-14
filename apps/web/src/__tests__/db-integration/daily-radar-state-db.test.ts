import { Pool } from 'pg'

import { getPool } from '@/lib/db-pool'
import {
  attachDailyRadarProfileDigestRun,
  claimDailyRadarProfile,
  claimDailyRadarRun,
  finishDailyRadarProfile,
  finishDailyRadarRun,
  heartbeatDailyRadarRun,
  recordDailyRadarSourceRefreshResult,
  recordDailyRadarTemporalResult,
} from '@/lib/daily-radar-run-state'

const databaseUrl = process.env.DATABASE_URL?.trim()
const isolated = process.env.DAILY_RADAR_DB_TEST_ACK === 'isolated'
const describeIfDatabase = databaseUrl && isolated ? describe : describe.skip

describeIfDatabase('daily radar real PostgreSQL fencing', () => {
  const client = new Pool({ connectionString: databaseUrl })
  let profileId = ''
  let digestRunId = ''

  beforeAll(async () => {
    const fixtureSuffix = `${process.pid}-${Date.now()}`
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ($1, 'Daily Radar DB')
       RETURNING id::TEXT AS id`,
      [`daily-radar-db-${fixtureSuffix}@example.invalid`],
    )
    const workspace = await client.query<{ id: string }>(
      `INSERT INTO workspaces (name, slug, bootstrap_user_id)
       VALUES ('Daily Radar DB', $1, $2::BIGINT)
       RETURNING id::TEXT AS id`,
      [`daily-radar-db-${fixtureSuffix}`, user.rows[0].id],
    )
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1::BIGINT, $2::BIGINT, 'owner', 'active')`,
      [workspace.rows[0].id, user.rows[0].id],
    )
    await client.query('ALTER TABLE client_profiles DISABLE TRIGGER USER')
    try {
      const profile = await client.query<{ id: string }>(
        `INSERT INTO client_profiles (agency_name, owner_id, workspace_id)
         VALUES ('Daily Radar DB', $1::BIGINT, $2::BIGINT)
         RETURNING id::TEXT AS id`,
        [user.rows[0].id, workspace.rows[0].id],
      )
      profileId = profile.rows[0].id
    } finally {
      await client.query('ALTER TABLE client_profiles ENABLE TRIGGER USER')
    }
    const digest = await client.query<{ id: string }>(
      `INSERT INTO digest_runs (client_profile_id, requested_limit)
       VALUES ($1::BIGINT, 5)
       RETURNING id::TEXT AS id`,
      [profileId],
    )
    digestRunId = digest.rows[0].id
  })

  afterAll(async () => {
    const pool = getPool()
    await pool?.end()
    delete (globalThis as typeof globalThis & { recruiterRadarSharedPool?: unknown }).recruiterRadarSharedPool
    await client.end()
  })

  beforeEach(async () => {
    await client.query('DELETE FROM daily_radar_run_state')
  })

  it('fences every old-owner mutation and reuses the digest run after a real stale takeover', async () => {
    const ownerA = await claimDailyRadarRun(new Date('2026-08-14T00:00:00.000Z'))
    const profileA = await claimDailyRadarProfile(ownerA, profileId, new Date('2026-08-14T00:01:00.000Z'))
    expect(await attachDailyRadarProfileDigestRun(profileA, digestRunId)).toBe(true)

    const healthyDuplicate = await claimDailyRadarRun(new Date('2026-08-14T01:00:00.000Z'))
    expect(healthyDuplicate).toMatchObject({ acquired: false, reason: 'already-running' })

    const ownerB = await claimDailyRadarRun(new Date('2026-08-14T03:00:01.000Z'))
    expect(ownerB.acquired).toBe(true)
    expect(ownerB.leaseId).not.toBe(ownerA.leaseId)

    await expect(heartbeatDailyRadarRun(ownerA)).resolves.toBe(false)
    await expect(recordDailyRadarSourceRefreshResult(ownerA, { ok: true })).resolves.toBe(false)
    await expect(recordDailyRadarTemporalResult(ownerA, { ok: true })).resolves.toBe(false)
    await expect(finishDailyRadarProfile(profileA, 'completed')).resolves.toBe(false)
    await expect(finishDailyRadarRun(ownerA, 'completed')).resolves.toBe(false)

    const fencedProfile = await client.query<{ status: string; digestRunId: string | null }>(
      `SELECT status, digest_run_id::TEXT AS "digestRunId"
       FROM daily_radar_profile_run_state
       WHERE run_date = $1::DATE AND client_profile_id = $2::BIGINT`,
      [ownerA.runDate, profileId],
    )
    expect(fencedProfile.rows[0]).toEqual({ status: 'failed_retryable', digestRunId })

    const profileB = await claimDailyRadarProfile(ownerB, profileId, new Date('2026-08-14T03:00:02.000Z'))
    expect(profileB).toMatchObject({ acquired: true, attemptCount: 2, digestRunId })
    expect(await finishDailyRadarProfile(profileB, 'failed_terminal', 'smtp_ambiguous_failure')).toBe(true)
    expect(await finishDailyRadarRun(ownerB, 'terminal')).toBe(true)
  })

  it('obeys DB backoff, admits one concurrent retry, and terminalizes the attempt limit', async () => {
    const first = await claimDailyRadarRun(new Date('2026-08-15T00:00:00.000Z'))
    expect(await finishDailyRadarRun(first, 'partial', new Date('2026-08-15T00:00:01.000Z'))).toBe(true)

    const tooEarly = await claimDailyRadarRun(new Date('2026-08-15T00:00:10.000Z'))
    expect(tooEarly).toMatchObject({ acquired: false, reason: 'retry-backoff' })

    const concurrent = await Promise.all([
      claimDailyRadarRun(new Date('2026-08-15T00:00:32.000Z')),
      claimDailyRadarRun(new Date('2026-08-15T00:00:32.000Z')),
    ])
    expect(concurrent.filter((lease) => lease.acquired)).toHaveLength(1)
    const second = concurrent.find((lease) => lease.acquired)
    expect(second).toBeDefined()
    expect(await finishDailyRadarRun(second!, 'partial', new Date('2026-08-15T00:00:33.000Z'))).toBe(true)

    const third = await claimDailyRadarRun(new Date('2026-08-15T00:01:34.000Z'))
    expect(third).toMatchObject({ acquired: true, attemptCount: 3 })
    expect(await finishDailyRadarRun(third, 'failed', new Date('2026-08-15T00:01:35.000Z'))).toBe(true)

    const persisted = await client.query<{ status: string; terminalReason: string | null; nextRetryAt: string | null }>(
      `SELECT status, terminal_reason AS "terminalReason", next_retry_at::TEXT AS "nextRetryAt"
       FROM daily_radar_run_state
       WHERE run_date = '2026-08-15'::DATE`,
    )
    expect(persisted.rows[0]).toEqual({
      status: 'terminal',
      terminalReason: 'daily_attempt_limit_reached',
      nextRetryAt: null,
    })
    const afterLimit = await claimDailyRadarRun(new Date('2026-08-15T04:00:00.000Z'))
    expect(afterLimit).toMatchObject({ acquired: false, reason: 'terminal', attemptCount: 3 })
  })
})
