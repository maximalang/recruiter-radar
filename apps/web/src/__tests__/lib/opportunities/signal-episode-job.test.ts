import type { QueryResult } from 'pg'

jest.mock('@/lib/opportunities/signal-episode-repository', () => ({
  persistSignalEpisode: jest.fn(),
}))

import {
  buildSignalEpisodesJob,
  SignalEpisodesApplyScopeRequiredError,
  type SignalEpisodesJobDb,
} from '@/lib/opportunities/signal-episode-job'
import { persistSignalEpisode } from '@/lib/opportunities/signal-episode-repository'

const mockedPersist = jest.mocked(persistSignalEpisode)
const NOW = new Date('2026-08-04T12:00:00.000Z')

function queryResult<Row extends Record<string, unknown>>(
  rows: Row[] = [],
): QueryResult<Row> {
  return { rowCount: rows.length, rows }
}

type JobQueryImplementation = (
  sql: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>

function createJobDb(
  implementation: JobQueryImplementation = async () => queryResult(),
): { db: SignalEpisodesJobDb; query: jest.Mock } {
  const query = jest.fn(implementation)
  return {
    db: {
      query: <Row = Record<string, unknown>>(
        sql: string,
        values?: readonly unknown[],
      ) => query(sql, values) as Promise<QueryResult<Row>>,
      release: jest.fn(),
    },
    query,
  }
}

function changeRow(organizationId = '10') {
  return {
    id: '501',
    snapshotId: '401',
    organizationId,
    snapshotAt: '2026-08-04T10:00:00.000Z',
    changeType: 'hiring_acceleration',
    direction: 'up',
    dimension: 'all',
    magnitude: 4,
    baselineDeviation: 1.5,
    confidence: 0.9,
    eventIds: ['101'],
    evidenceIds: ['201'],
    changeFingerprint: 'a'.repeat(64),
    payload: { currentVacancies14d: 4 },
  }
}

function eventRow(organizationId = '10') {
  return {
    id: '101',
    organizationId,
    eventType: 'job_posting',
    occurredAt: '2026-08-04T09:00:00.000Z',
    firstSeenAt: '2026-08-04T09:00:00.000Z',
    lastSeenAt: '2026-08-04T09:00:00.000Z',
    eventFingerprint: 'b'.repeat(64),
    evidenceIds: ['201'],
    confidence: 0.9,
    payload: { title: 'Senior Backend Engineer', region: 'Moscow' },
  }
}

describe('Signal Episodes v2 job', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedPersist.mockResolvedValue({
      episodeId: '701',
      episodeGeneration: 1,
      inserted: true,
      stateChangesAttached: 1,
      eventsAttached: 1,
      evidenceAttached: 1,
    })
  })

  it('stays dark unless its independent flag is exactly true', async () => {
    const { db, query } = createJobDb()
    await expect(buildSignalEpisodesJob({ env: {} }, db)).resolves.toMatchObject({
      enabled: false,
      scanned: 0,
      episodesPersisted: 0,
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('requires one explicit organization before apply mode', async () => {
    const { db } = createJobDb()
    await expect(buildSignalEpisodesJob({
      env: { SIGNAL_EPISODES_V2_ENABLED: 'true' },
      dryRun: false,
    }, db)).rejects.toBeInstanceOf(SignalEpisodesApplyScopeRequiredError)
  })

  it('defaults to bounded dry-run and emits one evidence-backed situation', async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = []
    const { db } = createJobDb(async (sql, values) => {
      statements.push({ sql, values })
      if (sql.includes('SELECT change.organization_id')) {
        return queryResult([{ organizationId: '10' }])
      }
      if (sql.includes('FROM company_state_changes change')) {
        return queryResult([changeRow()])
      }
      if (sql.includes('FROM company_events event')) {
        return queryResult([eventRow()])
      }
      return queryResult()
    })

    await expect(buildSignalEpisodesJob({
      env: { SIGNAL_EPISODES_V2_ENABLED: 'true' },
      organizationId: '10',
      now: NOW,
    }, db)).resolves.toMatchObject({
      enabled: true,
      dryRun: true,
      scanned: 1,
      built: 1,
      active: 1,
      episodesPersisted: 0,
      failed: 0,
    })
    expect(mockedPersist).not.toHaveBeenCalled()
    expect(statements.find((item) =>
      item.sql.includes('FROM company_state_changes change') &&
      !item.sql.includes('SELECT change.organization_id'))?.values?.at(-1))
      .toBe(1_001)
    expect(statements.find((item) =>
      item.sql.includes('FROM company_events event'))?.values?.at(-1))
      .toBe(5_001)
    const selection = statements.find((item) =>
      item.sql.includes('SELECT change.organization_id'))
    expect(selection?.sql).toContain("candidate_event.event_type IN")
    expect(selection?.values?.at(-1)).toBe(10)
  })

  it('persists only in apply mode and distinguishes replay', async () => {
    const { db } = createJobDb(async (sql) => {
      if (sql.includes('SELECT change.organization_id')) {
        return queryResult([{ organizationId: '10' }])
      }
      if (sql.includes('FROM company_state_changes change')) {
        return queryResult([changeRow()])
      }
      if (sql.includes('FROM company_events event')) {
        return queryResult([eventRow()])
      }
      return queryResult()
    })
    mockedPersist.mockResolvedValueOnce({
      episodeId: '701', episodeGeneration: 1, inserted: false,
      stateChangesAttached: 0, eventsAttached: 0, evidenceAttached: 0,
    })

    await expect(buildSignalEpisodesJob({
      env: { SIGNAL_EPISODES_V2_ENABLED: 'true' },
      organizationId: '10',
      dryRun: false,
      now: NOW,
    }, db)).resolves.toMatchObject({
      built: 1,
      episodesPersisted: 0,
      replayed: 1,
    })
  })

  it('isolates organization failures and refuses truncated provenance', async () => {
    const tooManyChanges = Array.from({ length: 1_001 }, (_, index) => ({
      ...changeRow('10'),
      id: String(index + 1),
      changeFingerprint: (index + 1).toString(16).padStart(64, '0'),
    }))
    const { db } = createJobDb(async (sql, values) => {
      if (sql.includes('SELECT change.organization_id')) {
        return queryResult([{ organizationId: '10' }, { organizationId: '20' }])
      }
      if (sql.includes('FROM company_state_changes change')) {
        return values?.[0] === '10'
          ? queryResult(tooManyChanges)
          : queryResult([changeRow('20')])
      }
      if (sql.includes('FROM company_events event')) {
        return queryResult([eventRow('20')])
      }
      return queryResult()
    })

    await expect(buildSignalEpisodesJob({
      env: { SIGNAL_EPISODES_V2_ENABLED: 'true' },
      now: NOW,
    }, db)).resolves.toMatchObject({
      scanned: 2,
      built: 1,
      failed: 1,
    })
  })
})
