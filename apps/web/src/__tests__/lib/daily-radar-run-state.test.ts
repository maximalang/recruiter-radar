const query = jest.fn()

type CurrentState = {
  leaseId: string
  status: string
  updatedAt: Date
  attemptCount: number
}

jest.mock('@/lib/db-pool', () => ({
  getPool: () => ({ query }),
}))

import {
  claimDailyRadarRun,
  dailyRadarNextRetryAt,
  finishDailyRadarRun,
} from '@/lib/daily-radar-run-state'

describe('daily radar fenced lease', () => {
  beforeEach(() => query.mockReset())

  test('a stale owner cannot finalize a takeover owner state', async () => {
    let current: CurrentState | null = null

    query.mockImplementation(async (sql: string, params: readonly unknown[]) => {
      if (sql.includes('INSERT INTO daily_radar_run_state')) {
        const leaseId = String(params[1])
        const now = new Date(String(params[2]))
        if (!current) {
          current = { leaseId, status: 'running', updatedAt: now, attemptCount: 1 }
          return { rowCount: 1, rows: [{ runDate: '2026-08-14', leaseId, attemptCount: 1 }] }
        }
        const stale = current.status === 'running'
          && now.getTime() - current.updatedAt.getTime() > 2 * 60 * 60 * 1000
        if (stale) {
          current = {
            leaseId,
            status: 'running',
            updatedAt: now,
            attemptCount: current.attemptCount + 1,
          }
          return { rowCount: 1, rows: [{ runDate: '2026-08-14', leaseId, attemptCount: current.attemptCount }] }
        }
        return { rowCount: 0, rows: [] }
      }

      if (sql.includes('UPDATE daily_radar_run_state') && sql.includes('completed_at')) {
        expect(sql).toContain('lease_id = $2::UUID')
        expect(sql).toContain("AND status = 'running'")
        const leaseId = String(params[1])
        if (!current || current.leaseId !== leaseId || current.status !== 'running') {
          return { rowCount: 0, rows: [] }
        }
        current.status = String(params[2])
        return { rowCount: 1, rows: [] }
      }

      if (sql.includes('SELECT') && sql.includes('FROM daily_radar_run_state')) {
        return {
          rowCount: current ? 1 : 0,
          rows: current ? [{ status: current.status, attemptCount: current.attemptCount, nextRetryAt: null }] : [],
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const ownerA = await claimDailyRadarRun(new Date('2026-08-14T00:00:00.000Z'))
    const ownerB = await claimDailyRadarRun(new Date('2026-08-14T03:00:01.000Z'))

    expect(ownerA.acquired).toBe(true)
    expect(ownerB.acquired).toBe(true)
    expect(ownerB.leaseId).not.toBe(ownerA.leaseId)

    await expect(finishDailyRadarRun(ownerA, 'completed')).resolves.toBe(false)
    const afterStaleOwner = current as CurrentState | null
    expect(afterStaleOwner?.status).toBe('running')
    expect(afterStaleOwner?.leaseId).toBe(ownerB.leaseId)

    await expect(finishDailyRadarRun(ownerB, 'completed')).resolves.toBe(true)
    const afterCurrentOwner = current as CurrentState | null
    expect(afterCurrentOwner?.status).toBe('completed')
  })

  test('the last failed DB-owned attempt is persisted as terminal', async () => {
    let persistedStatus: string | null = null
    query.mockImplementation(async (sql: string, params: readonly unknown[]) => {
      if (sql.includes('UPDATE daily_radar_run_state') && sql.includes('completed_at')) {
        persistedStatus = String(params[2])
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const lease = {
      acquired: true,
      persisted: true,
      runDate: '2026-08-14',
      leaseId: '00000000-0000-4000-8000-000000000003',
      attemptCount: 3,
    }
    await expect(finishDailyRadarRun(lease, 'failed')).resolves.toBe(true)

    expect(persistedStatus).toBe('terminal')
  })

  test('reports the same DB-owned retry timestamp used by finalization', () => {
    const now = new Date('2026-08-14T06:15:00.000Z')
    expect(dailyRadarNextRetryAt({ attemptCount: 1 }, 'partial', now))
      .toBe('2026-08-14T06:15:30.000Z')
    expect(dailyRadarNextRetryAt({ attemptCount: 2 }, 'failed', now))
      .toBe('2026-08-14T06:16:00.000Z')
    expect(dailyRadarNextRetryAt({ attemptCount: 3 }, 'partial', now)).toBeNull()
    expect(dailyRadarNextRetryAt({ attemptCount: 1 }, 'terminal', now)).toBeNull()
  })
})
