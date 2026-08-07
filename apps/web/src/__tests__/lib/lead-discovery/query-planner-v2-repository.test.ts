import type { QueryResult } from 'pg'

import {
  buildProfileScopedQueryPlans,
  buildQueryPlanMetrics,
  type QueryPlannerV2ProfileInput,
} from '@/lib/lead-discovery/query-planner-v2'
import {
  QueryPlanReplayConflictError,
  persistProfileScopedQueryPlans,
  persistQueryPlanMetricSnapshot,
  type QueryPlannerV2Db,
} from '@/lib/lead-discovery/query-planner-v2-repository'

const HASH_A = 'a'.repeat(64)

function queryResult<Row extends Record<string, unknown>>(
  rows: Row[] = [],
  rowCount = rows.length,
): QueryResult<Row> {
  return { rows, rowCount }
}

type QueryImplementation = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<Record<string, unknown>>>

function createDb(
  implementation: QueryImplementation = async () => queryResult(),
): { db: QueryPlannerV2Db; query: jest.Mock } {
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

function profile(
  overrides: Partial<QueryPlannerV2ProfileInput> = {},
): QueryPlannerV2ProfileInput {
  return {
    workspaceId: '20',
    ownerId: '30',
    clientProfileId: '40',
    profileSnapshotHash: HASH_A,
    roles: ['data'],
    industries: ['fintech'],
    excludedIndustries: [],
    includeKeywords: ['python'],
    excludeKeywords: ['стажер'],
    specialization: 'data',
    targetCity: 'Москва',
    preferredRegions: ['Москва'],
    excludedLocations: [],
    targetSeniorities: ['senior'],
    remoteFriendly: true,
    dailyDigestLimit: 10,
    feedbackEvents: [],
    historicalYield: {
      fetchedRecords: null,
      uniqueEvents: null,
      uniqueCompanies: null,
      episodes: null,
      qualifiedOpportunities: null,
      accepted: null,
      contacted: null,
      replied: null,
      meetings: null,
    },
    ...overrides,
  }
}

function plans(overrides: Partial<QueryPlannerV2ProfileInput> = {}) {
  return buildProfileScopedQueryPlans({
    profiles: [profile(overrides)],
    sources: ['hh'],
  })
}

describe('Query Planner v2 repository', () => {
  it('persists a profile plan, shared request, and consumer atomically', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('MAX(plan_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO query_plan_snapshots')) {
        return queryResult([{ id: '501', planGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO query_plan_shared_requests')) {
        return queryResult([{ id: '601' }])
      }
      if (sql.includes('INSERT INTO query_plan_request_consumers')) {
        return queryResult([], 1)
      }
      return queryResult()
    })

    await expect(persistProfileScopedQueryPlans(plans(), db)).resolves.toEqual({
      plans: [{
        planSnapshotId: '501',
        planGeneration: 1,
        planIdentity: plans()[0].planIdentity,
        inserted: true,
      }],
      sharedRequestsInserted: 1,
      consumersLinked: 1,
    })
    expect(statements[0]).toBe('BEGIN')
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('INSERT INTO query_plan_snapshots'),
      expect.stringContaining('INSERT INTO query_plan_shared_requests'),
      expect.stringContaining('INSERT INTO query_plan_request_consumers'),
    ]))
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('reconciles an exact replay without another generation', async () => {
    const plan = plans()[0]
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('FROM query_plan_snapshots') &&
          sql.includes('input_hash')) {
        return queryResult([{
          id: '501',
          planGeneration: 1,
          planIdentity: plan.planIdentity,
          ownerId: plan.ownerId,
          profileSnapshotHash: plan.profileSnapshotHash,
          source: plan.source,
          sharedRequestHash: plan.sharedRequestHash,
        }])
      }
      if (sql.includes('INSERT INTO query_plan_shared_requests')) {
        return queryResult([])
      }
      if (sql.includes('FROM query_plan_shared_requests')) {
        return queryResult([{
          id: '601',
          source: plan.source,
          queryEnv: plan.queryEnv,
          pageBudget: plan.pageBudget,
          frequency: plan.frequency,
        }])
      }
      return queryResult()
    })

    await expect(persistProfileScopedQueryPlans([plan], db)).resolves.toEqual({
      plans: [{
        planSnapshotId: '501',
        planGeneration: 1,
        planIdentity: plan.planIdentity,
        inserted: false,
      }],
      sharedRequestsInserted: 0,
      consumersLinked: 0,
    })
    expect(statements.some((sql) => sql.includes('MAX(plan_generation)')))
      .toBe(false)
  })

  it('does not link a blocked or review plan to a shared source request', async () => {
    const reviewPlan = plans({ preferredRegions: ['Неизвестный регион'] })[0]
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('MAX(plan_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO query_plan_snapshots')) {
        return queryResult([{ id: '502', planGeneration: 1 }])
      }
      return queryResult()
    })

    await expect(persistProfileScopedQueryPlans([reviewPlan], db))
      .resolves.toMatchObject({
        sharedRequestsInserted: 0,
        consumersLinked: 0,
      })
    expect(statements.some((sql) =>
      sql.includes('INSERT INTO query_plan_shared_requests'))).toBe(false)
  })

  it('rejects a replay hash resolving to another profile provenance', async () => {
    const plan = plans()[0]
    const { db } = createDb(async (sql) => {
      if (sql.includes('FROM query_plan_snapshots') &&
          sql.includes('input_hash')) {
        return queryResult([{
          id: '501',
          planGeneration: 1,
          planIdentity: plan.planIdentity,
          ownerId: '999',
          profileSnapshotHash: plan.profileSnapshotHash,
          source: plan.source,
          sharedRequestHash: plan.sharedRequestHash,
        }])
      }
      return queryResult()
    })

    await expect(persistProfileScopedQueryPlans([plan], db))
      .rejects.toBeInstanceOf(QueryPlanReplayConflictError)
  })

  it('rejects a mutated profile scope before opening a transaction', async () => {
    const plan = plans()[0]
    const { db, query } = createDb()

    await expect(persistProfileScopedQueryPlans([{
      ...plan,
      clientProfileId: '999',
      profileConsumers: ['999'],
    }], db)).rejects.toThrow('input hash does not match')
    expect(query).not.toHaveBeenCalled()
  })

  it('persists a deterministic per-profile metric snapshot', async () => {
    const { db, query } = createDb(async (sql) => {
      if (sql.includes('INSERT INTO query_plan_metric_snapshots')) {
        return queryResult([{ id: '701' }])
      }
      return queryResult()
    })
    const metrics = buildQueryPlanMetrics({
      executionCount: 2,
      zeroResultExecutions: 1,
      fetchedRecords: 20,
      uniqueEvents: 15,
      uniqueCompanies: 10,
      episodes: 8,
      qualifiedOpportunities: 4,
      accepted: 2,
      contacted: 1,
      replied: 1,
      meetings: 0,
    })

    await expect(persistQueryPlanMetricSnapshot({
      planSnapshotId: '501',
      workspaceId: '20',
      clientProfileId: '40',
      measurementWindowStart: '2026-08-01T00:00:00.000Z',
      measurementWindowEnd: '2026-08-02T00:00:00.000Z',
      metrics,
    }, db)).resolves.toEqual({ metricSnapshotId: '701', inserted: true })
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO query_plan_metric_snapshots'),
      expect.arrayContaining(['501', '20', '40', 0.25, 0.5]),
    )
  })
})
