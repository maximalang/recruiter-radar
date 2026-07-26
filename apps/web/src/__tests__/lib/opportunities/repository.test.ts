import { createHash } from 'node:crypto'

import {
  applyOpportunityAction,
  getOpportunityById,
  listOpportunities,
  OpportunityActionConflictError,
} from '@/lib/opportunities/repository'
import { getClient } from '@/lib/db-pool'

jest.mock('@/lib/db-pool', () => ({
  getClient: jest.fn(),
  getPool: jest.fn(() => null),
}))

type QueryCall = { sql: string; params: readonly unknown[] | undefined }

function createDb(rowsByCall: unknown[][]) {
  const calls: QueryCall[] = []
  return {
    calls,
    db: {
      query: jest.fn(async (sql: string, params?: readonly unknown[]) => {
        calls.push({ sql, params })
        const rows = rowsByCall[calls.length - 1] ?? []
        return { rowCount: rows.length, rows }
      }),
    },
  }
}

describe('opportunity repository tenant scope', () => {
  it('scopes list, count, and evidence queries to the session owner', async () => {
    const { db, calls } = createDb([
      [{ count: '1' }],
      [{
        id: '10',
        ownerId: '7',
        clientProfileId: '8',
        organizationId: '9',
        hiringEpisodeId: '11',
      }],
      [],
    ])

    const result = await listOpportunities(
      {
        ownerId: '7',
        morningBriefOnly: true,
        statuses: ['new'],
        confidenceGate: 'A',
        minimumScore: 0.5,
      },
      db,
    )

    expect(result.total).toBe(1)
    expect(result.nextOffset).toBeNull()
    expect(calls).toHaveLength(3)
    expect(calls[0].sql).toContain('o.owner_id = $1')
    expect(calls[1].sql).toContain('o.owner_id = $1')
    expect(calls[2].sql).toContain('o.owner_id = $1')
    expect(calls[0].sql).toContain(
      `o.metadata->>'morningBriefEligible' = 'true'`,
    )
    expect(calls[0].sql).toContain(`he.status = 'active'`)
    expect(calls[0].sql).toContain(`o.valid_until >= NOW()`)
    expect(calls[1].sql).toContain(
      `o.metadata->>'morningBriefEligible' = 'true'`,
    )
    expect(calls[0].params?.[0]).toBe('7')
    expect(calls[2].params?.[0]).toBe('7')
  })

  it('uses an explicit cursor offset and returns the next offset', async () => {
    const { db, calls } = createDb([
      [{ count: '5' }],
      [
        { id: '3', ownerId: '7' },
        { id: '4', ownerId: '7' },
      ],
      [],
    ])

    const result = await listOpportunities(
      { ownerId: '7', pageSize: 2, offset: 2 },
      db,
    )

    expect(result.page).toBe(2)
    expect(result.nextOffset).toBe(4)
    expect(calls[1].params?.slice(-2)).toEqual([2, 2])
  })

  it('does not run an evidence lookup for a foreign or missing detail', async () => {
    const { db, calls } = createDb([[]])

    const result = await getOpportunityById(
      { ownerId: '7', opportunityId: '999' },
      db,
    )

    expect(result).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('o.owner_id = $2')
    expect(calls[0].params).toEqual(['999', '7'])
  })

  it('rejects a cross-tenant action before any mutation query', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM opportunities') && sql.includes('FOR UPDATE')) {
        return { rowCount: 0, rows: [] }
      }
      return { rowCount: 0, rows: [] }
    })
    const release = jest.fn()
    jest.mocked(getClient).mockResolvedValue({ query, release })

    const result = await applyOpportunityAction({
      ownerId: '7',
      opportunityId: '999',
      action: 'dismissed',
      actionKey: 'dismissed:test',
    })

    expect(result).toBeNull()
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_actions'),
    )).toBe(false)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('persists an action and reuses digest feedback in the same transaction', async () => {
    const opportunity = {
      id: '10',
      ownerId: '7',
      clientProfileId: '8',
      organizationId: '9',
      hiringEpisodeId: '11',
      organizationName: 'Пример',
      organizationDomain: 'example.test',
      episodeType: 'vacancy_spike',
      episodeStatus: 'active',
      episodeStartedAt: '2026-07-20T00:00:00.000Z',
      episodeLastSeenAt: '2026-07-26T00:00:00.000Z',
      status: 'dismissed',
      title: 'Возможность',
      whyNow: 'Почему сейчас',
      problemHypothesis: 'Гипотеза',
      recommendedAngle: 'Угол',
      recommendedPersona: 'Роль',
      recommendedAction: 'Действие',
      opportunityScore: 0.8,
      confidenceGate: 'A',
      scores: {},
      evidenceHash: 'a'.repeat(64),
      validFrom: '2026-07-26T00:00:00.000Z',
      validUntil: null,
      snoozedUntil: null,
      metadata: {},
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
      evidenceCount: 0,
    }
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM opportunities') && sql.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{ id: '10', clientProfileId: '8', organizationId: '9' }],
        }
      }
      if (sql.includes('INSERT INTO opportunity_actions')) {
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('INSERT INTO client_digest_org_state')) {
        return { rowCount: 1, rows: [{ feedbackStatus: 'dismissed' }] }
      }
      if (sql.includes('WHERE o.id = $1')) {
        return { rowCount: 1, rows: [opportunity] }
      }
      return { rowCount: 0, rows: [] }
    })
    const release = jest.fn()
    jest.mocked(getClient).mockResolvedValue({ query, release })

    const result = await applyOpportunityAction({
      ownerId: '7',
      opportunityId: '10',
      action: 'dismissed',
      actionKey: 'dismissed:request-1',
      note: 'Не наш сегмент',
    })

    expect(result?.idempotent).toBe(false)
    expect(result?.opportunity.status).toBe('dismissed')
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_actions'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO client_digest_org_state'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse of an idempotency key with another action payload', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM opportunities') && sql.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{ id: '10', clientProfileId: '8', organizationId: '9' }],
        }
      }
      if (sql.includes('INSERT INTO opportunity_actions')) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('SELECT action_fingerprint')) {
        return {
          rowCount: 1,
          rows: [{ actionFingerprint: '0'.repeat(64) }],
        }
      }
      return { rowCount: 0, rows: [] }
    })
    const release = jest.fn()
    jest.mocked(getClient).mockResolvedValue({ query, release })

    await expect(applyOpportunityAction({
      ownerId: '7',
      opportunityId: '10',
      action: 'accepted',
      actionKey: 'request-reused',
    })).rejects.toBeInstanceOf(OpportunityActionConflictError)

    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('UPDATE opportunities'),
    )).toBe(false)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('replays an action with the same idempotency key and payload without mutating state', async () => {
    const actionFingerprint = createHash('sha256')
      .update(JSON.stringify({
        action: 'accepted',
        note: null,
        snoozeDays: null,
      }))
      .digest('hex')
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM opportunities') && sql.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{ id: '10', clientProfileId: '8', organizationId: '9' }],
        }
      }
      if (sql.includes('INSERT INTO opportunity_actions')) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('SELECT action_fingerprint')) {
        return {
          rowCount: 1,
          rows: [{ actionFingerprint }],
        }
      }
      if (sql.includes('WHERE o.id = $1')) {
        return {
          rowCount: 1,
          rows: [{
            id: '10',
            ownerId: '7',
            status: 'accepted',
            evidenceCount: 0,
          }],
        }
      }
      return { rowCount: 0, rows: [] }
    })
    const release = jest.fn()
    jest.mocked(getClient).mockResolvedValue({ query, release })

    const result = await applyOpportunityAction({
      ownerId: '7',
      opportunityId: '10',
      action: 'accepted',
      actionKey: 'accepted:request-1',
    })

    expect(result?.idempotent).toBe(true)
    expect(result?.opportunity.status).toBe('accepted')
    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('UPDATE opportunities'),
    )).toBe(false)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO client_digest_org_state'),
    )).toBe(false)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true)
    expect(release).toHaveBeenCalledTimes(1)
  })
})
