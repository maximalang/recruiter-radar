import type { QueryResult } from 'pg'

jest.mock('@/lib/opportunities/commercial-thesis-repository', () => ({
  persistCommercialThesis: jest.fn(),
}))

import {
  buildCommercialThesesJob,
  CommercialThesisApplyScopeRequiredError,
  type CommercialThesisJobDb,
} from '@/lib/opportunities/commercial-thesis-job'
import { persistCommercialThesis } from '@/lib/opportunities/commercial-thesis-repository'

const mockedPersist = jest.mocked(persistCommercialThesis)
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
): { db: CommercialThesisJobDb; query: jest.Mock } {
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

function episodeRow(organizationId = '10', id = '701') {
  return {
    id,
    organizationId,
    episodeIdentity: 'a'.repeat(64),
    episodeGeneration: 1,
    episodeType: 'vacancy_acceleration',
    stage: 'active',
    startedAt: '2026-08-01T09:00:00.000Z',
    lastSeenAt: '2026-08-04T10:00:00.000Z',
    validUntil: '2026-08-25T10:00:00.000Z',
    intensity: 0.82,
    direction: 'up',
    baselineDeviation: 1.5,
    roleFamilies: ['backend'],
    regions: ['Moscow'],
    seniorityDistribution: { senior: 3 },
    problemHypotheses: ['delivery_capacity_pressure'],
    evidenceRefs: ['201'],
    evidenceHash: 'b'.repeat(64),
    inputHash: 'c'.repeat(64),
    engineVersion: 'signal-episode-v2',
  }
}

describe('Commercial Thesis v1 job', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedPersist.mockResolvedValue({
      thesisId: '801',
      thesisGeneration: 1,
      inserted: true,
      evidenceAttached: 1,
    })
  })

  it('stays dark unless its independent flag is exactly true', async () => {
    const { db, query } = createJobDb()
    await expect(buildCommercialThesesJob({ env: {} }, db))
      .resolves.toMatchObject({ enabled: false, scanned: 0, thesesPersisted: 0 })
    expect(query).not.toHaveBeenCalled()
  })

  it('requires one explicit organization before apply mode', async () => {
    const { db } = createJobDb()
    await expect(buildCommercialThesesJob({
      env: { COMMERCIAL_THESIS_V1_ENABLED: 'true' },
      dryRun: false,
    }, db)).rejects.toBeInstanceOf(CommercialThesisApplyScopeRequiredError)
  })

  it('defaults to a bounded dry-run over latest episode generations', async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = []
    const { db } = createJobDb(async (sql, values) => {
      statements.push({ sql, values })
      if (sql.includes('SELECT latest.organization_id')) {
        return queryResult([{ organizationId: '10' }])
      }
      if (sql.includes('FROM signal_episodes episode')) {
        return queryResult([episodeRow()])
      }
      return queryResult()
    })

    await expect(buildCommercialThesesJob({
      env: { COMMERCIAL_THESIS_V1_ENABLED: 'true' },
      organizationId: '10',
      now: NOW,
    }, db)).resolves.toMatchObject({
      enabled: true,
      dryRun: true,
      scanned: 1,
      episodesScanned: 1,
      built: 1,
      active: 1,
      thesesPersisted: 0,
      failed: 0,
    })
    expect(mockedPersist).not.toHaveBeenCalled()
    const load = statements.find((item) =>
      item.sql.includes('FROM signal_episodes episode') &&
      !item.sql.includes('SELECT latest.organization_id'))
    expect(load?.sql).toContain('DISTINCT ON')
    expect(load?.values?.at(-1)).toBe(1_001)
  })

  it('persists only in apply mode and reports replay', async () => {
    const { db } = createJobDb(async (sql) => {
      if (sql.includes('SELECT latest.organization_id')) {
        return queryResult([{ organizationId: '10' }])
      }
      if (sql.includes('FROM signal_episodes episode')) {
        return queryResult([episodeRow()])
      }
      return queryResult()
    })
    mockedPersist.mockResolvedValueOnce({
      thesisId: '801', thesisGeneration: 1, inserted: false, evidenceAttached: 0,
    })

    await expect(buildCommercialThesesJob({
      env: { COMMERCIAL_THESIS_V1_ENABLED: 'true' },
      organizationId: '10',
      dryRun: false,
      now: NOW,
    }, db)).resolves.toMatchObject({
      built: 1,
      thesesPersisted: 0,
      replayed: 1,
    })
  })

  it('isolates organization failures and refuses truncated episode input', async () => {
    const tooMany = Array.from({ length: 1_001 }, (_, index) => ({
      ...episodeRow('10', String(index + 1)),
      episodeIdentity: (index + 1).toString(16).padStart(64, '0'),
      inputHash: (index + 2_000).toString(16).padStart(64, '0'),
    }))
    const { db } = createJobDb(async (sql, values) => {
      if (sql.includes('SELECT latest.organization_id')) {
        return queryResult([{ organizationId: '10' }, { organizationId: '20' }])
      }
      if (sql.includes('FROM signal_episodes episode')) {
        return values?.[0] === '10'
          ? queryResult(tooMany)
          : queryResult([episodeRow('20', '702')])
      }
      return queryResult()
    })

    await expect(buildCommercialThesesJob({
      env: { COMMERCIAL_THESIS_V1_ENABLED: 'true' },
      now: NOW,
    }, db)).resolves.toMatchObject({
      scanned: 2,
      episodesScanned: 1,
      built: 1,
      failed: 1,
    })
  })
})
