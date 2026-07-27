import { getClient } from '@/lib/db-pool'
import {
  OutcomeIdempotencyConflictError,
  OutcomeTransitionConflictError,
  recordOpportunityOutcome,
} from '@/lib/opportunities/outcome-repository'

jest.mock('@/lib/db-pool', () => ({
  getClient: jest.fn(),
  getPool: jest.fn(() => null),
}))

type OpportunityClient = NonNullable<Awaited<ReturnType<typeof getClient>>>

function clientFrom(query: jest.Mock, release = jest.fn()): OpportunityClient {
  return { query, release } as unknown as OpportunityClient
}

const opportunityContext = {
  id: '10',
  ownerId: '7',
  clientProfileId: '8',
  organizationId: '9',
  hiringEpisodeId: '11',
  status: 'new',
  supersededAt: null,
  scoringVersion: 'opportunity-v1',
  confidenceGate: 'A',
  opportunityScore: 0.84,
  externalSupportNeedScore: 0.8,
  episodeType: 'vacancy_spike',
}

function successfulQuery(options: { projectionFails?: boolean } = {}) {
  return jest.fn(async (sql: string) => {
    if (sql.includes('FROM opportunities o') && sql.includes('FOR UPDATE')) {
      return { rowCount: 1, rows: [opportunityContext] }
    }
    if (sql.includes('FROM opportunity_outcome_events') && sql.includes('idempotency_key')) {
      return { rowCount: 0, rows: [] }
    }
    if (sql.includes('FROM opportunity_outcome_state') && sql.includes('FOR UPDATE')) {
      return { rowCount: 0, rows: [] }
    }
    if (sql.includes('ARRAY_AGG')) {
      return { rowCount: 1, rows: [{ sourceFamilies: ['career-pages', 'hh'] }] }
    }
    if (sql.includes('INSERT INTO opportunity_outcome_events')) {
      return { rowCount: 1, rows: [{ id: '21', recordedAt: '2026-07-27T12:00:01.000Z' }] }
    }
    if (sql.includes('INSERT INTO opportunity_outcome_state')) {
      if (options.projectionFails) throw new Error('projection failed')
      return { rowCount: 1, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })
}

describe('opportunity outcome repository', () => {
  it('records accepted and updates projection plus legacy state atomically', async () => {
    const query = successfulQuery()
    const release = jest.fn()
    jest.mocked(getClient).mockResolvedValue(clientFrom(query, release))

    const result = await recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'accepted:request-1',
        metadata: {},
      },
    })

    expect(result).toMatchObject({
      idempotent: false,
      event: { id: '21', eventType: 'accepted', newStage: 'accepted' },
      state: { currentStage: 'accepted' },
    })
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_state'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('UPDATE opportunities'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO client_episode_state'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('does not treat accepted as contacted', async () => {
    const query = successfulQuery()
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'accepted:request-2',
        metadata: {},
      },
    })

    const eventInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'))
    expect(eventInsert?.[1]).toContain('accepted')
    expect(eventInsert?.[1]).not.toContain('contacted')
  })

  it('rejects replied before contacted without inserting a ledger event', async () => {
    const query = successfulQuery()
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'replied',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'replied:too-soon',
        metadata: {},
      },
    })).rejects.toBeInstanceOf(OutcomeTransitionConflictError)

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'),
    )).toBe(false)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true)
  })

  it('returns null for an unavailable tenant opportunity', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM opportunities o') && sql.includes('FOR UPDATE')) {
        return { rowCount: 0, rows: [] }
      }
      return { rowCount: 0, rows: [] }
    })
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '999',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'opened',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'opened:foreign',
        metadata: { interactionId: 'view-1' },
      },
    })).resolves.toBeNull()

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'),
    )).toBe(false)
  })

  it('rejects reuse of an owner idempotency key with another payload', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM opportunities o') && sql.includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [opportunityContext] }
      }
      if (sql.includes('FROM opportunity_outcome_events') && sql.includes('idempotency_key')) {
        return { rowCount: 1, rows: [{ id: '20', payloadHash: '0'.repeat(64) }] }
      }
      return { rowCount: 0, rows: [] }
    })
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'reused',
        metadata: {},
      },
    })).rejects.toBeInstanceOf(OutcomeIdempotencyConflictError)
  })

  it('rolls back the ledger insert when projection update fails', async () => {
    const query = successfulQuery({ projectionFails: true })
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'accepted:projection-failure',
        metadata: {},
      },
    })).rejects.toThrow('projection failed')

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(false)
  })
})
