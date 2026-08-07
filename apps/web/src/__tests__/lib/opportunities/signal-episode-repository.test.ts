import type { QueryResult } from 'pg'

import {
  persistSignalEpisode,
  SignalEpisodeProvenanceError,
  type SignalEpisodeDb,
} from '@/lib/opportunities/signal-episode-repository'
import type { SignalEpisodeDraft } from '@/lib/opportunities/signal-episode'

function queryResult<Row extends Record<string, unknown>>(
  rows: Row[] = [],
  rowCount = rows.length,
): QueryResult<Row> {
  return { rowCount, rows }
}

type QueryImplementation = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<Record<string, unknown>>>

function createDb(
  implementation: QueryImplementation = async () => queryResult(),
): { db: SignalEpisodeDb; query: jest.Mock } {
  const query = jest.fn(implementation)
  return {
    db: {
      query: <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        values?: unknown[],
      ) => query(sql, values) as Promise<QueryResult<Row>>,
    },
    query,
  }
}

function episode(overrides: Partial<SignalEpisodeDraft> = {}): SignalEpisodeDraft {
  return {
    organizationId: '10',
    episodeType: 'vacancy_acceleration',
    stage: 'active',
    startedAt: '2026-08-04T00:00:00.000Z',
    lastSeenAt: '2026-08-04T10:00:00.000Z',
    validUntil: '2026-08-25T10:00:00.000Z',
    intensity: 0.8,
    direction: 'up',
    baselineDeviation: 1.5,
    roleFamilies: ['backend'],
    regions: ['Moscow'],
    seniorityDistribution: { senior: 2, unspecified: 2 },
    problemHypotheses: ['delivery_capacity_pressure'],
    stateChangeIds: ['501', '502'],
    eventIds: ['101', '102'],
    evidenceIds: ['201', '202'],
    evidenceHash: 'a'.repeat(64),
    episodeIdentity: 'b'.repeat(64),
    inputHash: 'c'.repeat(64),
    engineVersion: 'signal-episode-v2',
    ...overrides,
  }
}

describe('Signal Episode repository', () => {
  it('persists one generation and all relational provenance atomically', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(episode_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO signal_episodes')) {
        return queryResult([{ id: '701', episodeGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO signal_episode_state_changes')) {
        return queryResult([], 2)
      }
      if (sql.includes('INSERT INTO signal_episode_events')) {
        return queryResult([], 2)
      }
      if (sql.includes('INSERT INTO signal_episode_evidence')) {
        return queryResult([], 2)
      }
      return queryResult()
    })

    await expect(persistSignalEpisode(episode(), db)).resolves.toEqual({
      episodeId: '701',
      episodeGeneration: 1,
      inserted: true,
      stateChangesAttached: 2,
      eventsAttached: 2,
      evidenceAttached: 2,
    })
    expect(statements[0]).toBe('BEGIN')
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('INSERT INTO signal_episode_state_changes'),
      expect.stringContaining('INSERT INTO signal_episode_events'),
      expect.stringContaining('INSERT INTO signal_episode_evidence'),
    ]))
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('reconciles deterministic replay without allocating another generation', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('FROM signal_episodes') && sql.includes('input_hash')) {
        return queryResult([{ id: '701', episodeGeneration: 1 }])
      }
      return queryResult()
    })

    await expect(persistSignalEpisode(episode(), db)).resolves.toEqual({
      episodeId: '701',
      episodeGeneration: 1,
      inserted: false,
      stateChangesAttached: 0,
      eventsAttached: 0,
      evidenceAttached: 0,
    })
    expect(statements.some((sql) => sql.includes('MAX(episode_generation)'))).toBe(false)
    expect(statements.some((sql) => sql.includes('signal_episode_state_changes'))).toBe(false)
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('allocates the next immutable generation for changed input', async () => {
    const { db } = createDb(async (sql) => {
      if (sql.includes('SELECT COALESCE(MAX(episode_generation)')) {
        return queryResult([{ nextGeneration: 2 }])
      }
      if (sql.includes('INSERT INTO signal_episodes')) {
        return queryResult([{ id: '702', episodeGeneration: 2 }])
      }
      return queryResult()
    })

    await expect(persistSignalEpisode(episode({ inputHash: 'd'.repeat(64) }), db))
      .resolves.toMatchObject({
        episodeId: '702',
        episodeGeneration: 2,
        inserted: true,
      })
  })

  it('rejects evidence-free or state-change-free drafts before opening a transaction', async () => {
    const { db, query } = createDb()

    await expect(persistSignalEpisode(episode({ evidenceIds: [] }), db))
      .rejects.toBeInstanceOf(SignalEpisodeProvenanceError)
    await expect(persistSignalEpisode(episode({ stateChangeIds: [] }), db))
      .rejects.toBeInstanceOf(SignalEpisodeProvenanceError)
    expect(query).not.toHaveBeenCalled()
  })

  it('rolls back the whole generation when provenance persistence fails', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(episode_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO signal_episodes')) {
        return queryResult([{ id: '701', episodeGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO signal_episode_evidence')) {
        throw new Error('evidence tenant mismatch')
      }
      return queryResult()
    })

    await expect(persistSignalEpisode(episode(), db)).rejects.toThrow(
      'evidence tenant mismatch',
    )
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })
})
