import type { QueryResult } from 'pg'

jest.mock('@/lib/opportunities/company-state-repository', () => ({
  persistCompanyStateBuild: jest.fn(),
}))

import {
  buildCompanyStateJob,
  CompanyStateApplyScopeRequiredError,
  type CompanyStateJobDb,
} from '@/lib/opportunities/company-state-job'
import { persistCompanyStateBuild } from '@/lib/opportunities/company-state-repository'

const mockedPersist = jest.mocked(persistCompanyStateBuild)
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
): { db: CompanyStateJobDb; query: jest.Mock } {
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

function eventRow(organizationId = '10') {
  return {
    id: '1',
    organizationId,
    eventType: 'job_posting',
    occurredAt: '2026-08-02T12:00:00.000Z',
    firstSeenAt: '2026-08-02T12:00:00.000Z',
    lastSeenAt: '2026-08-02T12:00:00.000Z',
    eventFingerprint: 'a'.repeat(64),
    evidenceIds: ['101'],
    confidence: 0.9,
    payload: { title: 'Backend engineer', region: 'Moscow' },
  }
}

describe('Company State job', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedPersist.mockResolvedValue({
      snapshotId: '501',
      snapshotInserted: true,
      changesInserted: 0,
      eventsAttached: 1,
      evidenceAttached: 1,
    })
  })

  it('stays dark unless the phase-specific flag is exactly true', async () => {
    const { db, query } = createJobDb()
    await expect(buildCompanyStateJob({ env: {} }, db)).resolves.toMatchObject({
      enabled: false,
      scanned: 0,
      snapshotsPersisted: 0,
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('requires one explicit organization before apply mode', async () => {
    const { db } = createJobDb()
    await expect(buildCompanyStateJob({
      env: { COMPANY_STATE_V1_ENABLED: 'true' },
      dryRun: false,
    }, db)).rejects.toBeInstanceOf(
      CompanyStateApplyScopeRequiredError,
    )
  })

  it('defaults to dry-run and builds only bounded Company Event input', async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = []
    const { db } = createJobDb(async (sql, values) => {
      statements.push({ sql, values })
      if (sql.includes('SELECT event.organization_id')) {
        return queryResult([{ organizationId: '10' }])
      }
      if (sql.includes('FROM company_events event')) {
        return queryResult([eventRow()])
      }
      return queryResult()
    })

    await expect(buildCompanyStateJob({
      env: { COMPANY_STATE_V1_ENABLED: 'true' },
      organizationId: '10',
      now: NOW,
    }, db)).resolves.toMatchObject({
      enabled: true,
      dryRun: true,
      scanned: 1,
      built: 1,
      lowHistory: 1,
      snapshotsPersisted: 0,
      failed: 0,
    })
    expect(mockedPersist).not.toHaveBeenCalled()
    const load = statements.find((item) =>
      item.sql.includes('FROM company_events event') &&
      !item.sql.includes('SELECT event.organization_id'))
    expect(load?.sql).toContain('LIMIT $4')
    expect(load?.values?.at(-1)).toBe(5_001)
  })

  it('persists only in explicit apply mode and isolates organization failures', async () => {
    const { db } = createJobDb(async (sql, values) => {
      if (sql.includes('SELECT event.organization_id')) {
        return queryResult([
          { organizationId: '10' },
          { organizationId: '20' },
        ])
      }
      if (sql.includes('FROM company_events event')) {
        if (values?.[0] === '10') throw new Error('poison organization')
        return queryResult([eventRow('20')])
      }
      return queryResult()
    })

    await expect(buildCompanyStateJob({
      env: { COMPANY_STATE_V1_ENABLED: 'true' },
      organizationId: '20',
      dryRun: false,
      now: NOW,
    }, db)).resolves.toMatchObject({
      scanned: 2,
      built: 1,
      snapshotsPersisted: 1,
      failed: 1,
    })
    expect(mockedPersist).toHaveBeenCalledTimes(1)
  })

  it('rejects an organization whose bounded history is truncated', async () => {
    const rows = Array.from({ length: 5_001 }, (_, index) => ({
      ...eventRow(),
      id: String(index + 1),
      eventFingerprint: (index + 1).toString(16).padStart(64, '0'),
      evidenceIds: [String(index + 101)],
    }))
    const { db } = createJobDb(async (sql) => {
      if (sql.includes('SELECT event.organization_id')) {
        return queryResult([{ organizationId: '10' }])
      }
      if (sql.includes('FROM company_events event')) return queryResult(rows)
      return queryResult()
    })

    await expect(buildCompanyStateJob({
      env: { COMPANY_STATE_V1_ENABLED: 'true' },
      organizationId: '10',
      now: NOW,
    }, db)).resolves.toMatchObject({
      scanned: 1,
      built: 0,
      failed: 1,
    })
  })
})
