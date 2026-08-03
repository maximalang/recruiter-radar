import type { QueryResult } from 'pg'

import {
  CompanyStateProvenanceError,
  persistCompanyStateBuild,
  type CompanyStateDb,
} from '@/lib/opportunities/company-state-repository'
import type {
  CompanyStateBuildResult,
  CompanyStateSnapshotDraft,
} from '@/lib/opportunities/company-state'

function queryResult<Row extends Record<string, unknown>>(
  rows: Row[] = [],
  rowCount = rows.length,
): QueryResult<Row> {
  return {
    command: '',
    rowCount,
    oid: 0,
    fields: [],
    rows,
  }
}

function buildResult(): CompanyStateBuildResult {
  const snapshot: CompanyStateSnapshotDraft = {
    organizationId: '10',
    snapshotAt: '2026-08-04T12:00:00.000Z',
    observationStartedAt: '2026-06-01T12:00:00.000Z',
    observationEndedAt: '2026-08-03T12:00:00.000Z',
    hiringBaseline: {
      vacancies7d: 1,
      vacancies14d: 1,
      vacancies30d: 2,
      medianHiringVelocityPer7d: 1,
      historyEventCount: 6,
      historyCoverageDays: 64,
      historicalPeriodCount: 3,
      sufficientHistory: true,
      fallbackReason: null,
    },
    currentHiringVelocity: {
      vacancies7d: 3,
      vacancies14d: 4,
      vacancies30d: 4,
      baselineDeviation14d: 3,
      direction: 'up',
    },
    roleDistribution: { current: { backend: 4 }, baseline: { backend: 6 } },
    seniorityDistribution: {
      current: { senior: 4 },
      baseline: { senior: 6 },
    },
    regionDistribution: {
      current: { Moscow: 4 },
      baseline: { Moscow: 6 },
      newRegions: [],
    },
    vacancyLifetime: { observedCount: 10, medianDays: 2 },
    repostRate: { supported: false, observedCount: 10, repostCount: 0, rate: null },
    recruitingCapacitySignals: {
      currentRecruiterVacancies: 0,
      baselineRecruiterVacancies: 0,
    },
    businessChangeSignals: { current30d: {} },
    stateClassification: 'accelerating',
    stateConfidence: 0.8,
    featureVersion: 'company-state-v1',
    eventIds: ['1', '2'],
    evidenceIds: ['101', '102'],
    evidenceHash: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
  }
  return {
    snapshot,
    changes: [{
      organizationId: '10',
      changeType: 'hiring_acceleration',
      direction: 'up',
      dimension: 'all',
      magnitude: 3,
      baselineDeviation: 3,
      confidence: 0.8,
      eventIds: ['1', '2'],
      evidenceIds: ['101', '102'],
      evidenceHash: 'a'.repeat(64),
      changeFingerprint: 'c'.repeat(64),
      featureVersion: 'company-state-v1',
      payload: { currentVacancies14d: 4, baselineVacancies14d: 1 },
    }],
    rejections: [],
  }
}

describe('Company State repository', () => {
  it('persists one atomic snapshot, change, and relational provenance', async () => {
    const statements: string[] = []
    const db: CompanyStateDb = {
      query: jest.fn(async (sql) => {
        statements.push(sql)
        if (sql.includes('INSERT INTO company_state_snapshots')) {
          return queryResult([{ id: '501' }])
        }
        if (sql.includes('INSERT INTO company_state_changes')) {
          return queryResult([{ id: '601' }])
        }
        if (
          sql.includes('INSERT INTO company_state_snapshot_events') ||
          sql.includes('INSERT INTO company_state_snapshot_evidence') ||
          sql.includes('INSERT INTO company_state_change_events') ||
          sql.includes('INSERT INTO company_state_change_evidence')
        ) {
          return queryResult([], 2)
        }
        return queryResult()
      }),
    }

    await expect(persistCompanyStateBuild(buildResult(), db)).resolves.toEqual({
      snapshotId: '501',
      snapshotInserted: true,
      changesInserted: 1,
      eventsAttached: 4,
      evidenceAttached: 4,
    })
    expect(statements[0]).toBe('BEGIN')
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('INSERT INTO company_state_snapshot_events'),
      expect.stringContaining('INSERT INTO company_state_snapshot_evidence'),
      expect.stringContaining('INSERT INTO company_state_change_events'),
      expect.stringContaining('INSERT INTO company_state_change_evidence'),
    ]))
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('reconciles deterministic replay to the existing snapshot and change', async () => {
    const db: CompanyStateDb = {
      query: jest.fn(async (sql) => {
        if (sql.includes('INSERT INTO company_state_snapshots')) {
          return queryResult([], 0)
        }
        if (sql.includes('FROM company_state_snapshots')) {
          return queryResult([{ id: '501', organizationId: '10' }])
        }
        if (sql.includes('INSERT INTO company_state_changes')) {
          return queryResult([], 0)
        }
        if (sql.includes('FROM company_state_changes')) {
          return queryResult([{ id: '601', snapshotId: '501' }])
        }
        return queryResult([], sql.includes('INSERT INTO') ? 0 : 0)
      }),
    }

    await expect(persistCompanyStateBuild(buildResult(), db)).resolves.toEqual({
      snapshotId: '501',
      snapshotInserted: false,
      changesInserted: 0,
      eventsAttached: 0,
      evidenceAttached: 0,
    })
  })

  it('rejects change provenance that is outside its snapshot', async () => {
    const result = buildResult()
    result.changes[0].eventIds = ['999']
    const db: CompanyStateDb = { query: jest.fn() }

    await expect(persistCompanyStateBuild(result, db)).rejects.toBeInstanceOf(
      CompanyStateProvenanceError,
    )
    expect(db.query).not.toHaveBeenCalled()
  })

  it('rolls back the whole organization when provenance persistence fails', async () => {
    const statements: string[] = []
    const db: CompanyStateDb = {
      query: jest.fn(async (sql) => {
        statements.push(sql)
        if (sql.includes('INSERT INTO company_state_snapshots')) {
          return queryResult([{ id: '501' }])
        }
        if (sql.includes('INSERT INTO company_state_snapshot_evidence')) {
          throw new Error('tenant evidence mismatch')
        }
        return queryResult()
      }),
    }

    await expect(persistCompanyStateBuild(buildResult(), db)).rejects.toThrow(
      'tenant evidence mismatch',
    )
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })

  it('does nothing when there is no evidence-backed snapshot', async () => {
    const db: CompanyStateDb = { query: jest.fn() }
    await expect(persistCompanyStateBuild({
      snapshot: null,
      changes: [],
      rejections: [],
    }, db)).resolves.toEqual({
      snapshotId: null,
      snapshotInserted: false,
      changesInserted: 0,
      eventsAttached: 0,
      evidenceAttached: 0,
    })
    expect(db.query).not.toHaveBeenCalled()
  })
})
