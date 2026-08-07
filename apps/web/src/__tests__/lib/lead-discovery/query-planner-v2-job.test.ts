import type { QueryResult } from 'pg'

jest.mock('@/lib/lead-discovery/query-planner-v2-repository', () => ({
  persistProfileScopedQueryPlans: jest.fn(),
}))

import {
  QueryPlannerV2ApplyScopeRequiredError,
  buildQueryPlansV2Job,
  type QueryPlannerV2JobDb,
} from '@/lib/lead-discovery/query-planner-v2-job'
import { persistProfileScopedQueryPlans } from '@/lib/lead-discovery/query-planner-v2-repository'

const mockedPersist = jest.mocked(persistProfileScopedQueryPlans)

function queryResult<Row extends Record<string, unknown>>(
  rows: Row[] = [],
): QueryResult<Row> {
  return { rows, rowCount: rows.length }
}

type JobQueryImplementation = (
  sql: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>

function createJobDb(
  implementation: JobQueryImplementation = async () => queryResult(),
): { db: QueryPlannerV2JobDb; query: jest.Mock } {
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

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: '20',
    ownerId: '30',
    clientProfileId: '40',
    profileSnapshotHash: 'a'.repeat(64),
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
    operatorSearchParams: {},
    ...overrides,
  }
}

describe('Query Planner v2 dark job', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedPersist.mockImplementation(async (plans) => ({
      plans: plans.map((plan, index) => ({
        planSnapshotId: String(500 + index),
        planGeneration: 1,
        planIdentity: plan.planIdentity,
        inserted: true,
      })),
      sharedRequestsInserted: 1,
      consumersLinked: plans.filter((plan) => plan.status === 'ready').length,
    }))
  })

  it('stays dark unless its independent flag is exactly true', async () => {
    const { db, query } = createJobDb()

    await expect(buildQueryPlansV2Job({ env: {} }, db)).resolves
      .toMatchObject({ enabled: false, profilesScanned: 0, persisted: 0 })
    await expect(buildQueryPlansV2Job({
      env: { QUERY_PLANNER_V2_ENABLED: ' TRUE ' },
    }, db)).resolves.toMatchObject({ enabled: false })
    expect(query).not.toHaveBeenCalled()
  })

  it('requires exact workspace and profile before apply mode', async () => {
    const { db } = createJobDb()
    await expect(buildQueryPlansV2Job({
      env: { QUERY_PLANNER_V2_ENABLED: 'true' },
      workspaceId: '20',
      dryRun: false,
    }, db)).rejects.toBeInstanceOf(QueryPlannerV2ApplyScopeRequiredError)
    await expect(buildQueryPlansV2Job({
      env: { QUERY_PLANNER_V2_ENABLED: 'true' },
      clientProfileId: '40',
      dryRun: false,
    }, db)).rejects.toBeInstanceOf(QueryPlannerV2ApplyScopeRequiredError)
  })

  it('previews profile-scoped plans with feedback and preferences isolated in SQL', async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = []
    const { db } = createJobDb(async (sql, values) => {
      statements.push({ sql, values })
      return sql.includes('FROM client_profiles profile')
        ? queryResult([profileRow()])
        : queryResult()
    })

    await expect(buildQueryPlansV2Job({
      env: { QUERY_PLANNER_V2_ENABLED: 'true' },
      workspaceId: '20',
      clientProfileId: '40',
      sources: ['hh'],
    }, db)).resolves.toMatchObject({
      enabled: true,
      dryRun: true,
      profilesScanned: 1,
      plansBuilt: 1,
      ready: 1,
      review: 0,
      blocked: 0,
      sharedRequests: 1,
      persisted: 0,
      failedProfiles: 0,
    })
    expect(mockedPersist).not.toHaveBeenCalled()
    const load = statements.find((item) =>
      item.sql.includes('FROM client_profiles profile'))
    expect(load?.sql).toContain('state.client_profile_id = profile.id')
    expect(load?.sql).toContain('preference.user_id = profile.owner_id')
    expect(load?.sql).toContain('agency_dna_full_snapshot(profile)')
    expect(load?.values).toEqual(['20', '40', ['hh'], 25])
  })

  it('deduplicates common ready requests across profile previews', async () => {
    const { db } = createJobDb(async (sql) =>
      sql.includes('FROM client_profiles profile')
        ? queryResult([
          profileRow(),
          profileRow({
            workspaceId: '21',
            ownerId: '31',
            clientProfileId: '41',
          }),
        ])
        : queryResult())

    await expect(buildQueryPlansV2Job({
      env: { QUERY_PLANNER_V2_ENABLED: 'true' },
      sources: ['hh'],
    }, db)).resolves.toMatchObject({
      profilesScanned: 2,
      plansBuilt: 2,
      sharedRequests: 1,
      persisted: 0,
      consumersLinked: 0,
    })
    expect(mockedPersist).not.toHaveBeenCalled()
  })

  it('persists only the explicitly scoped profile in apply mode', async () => {
    const { db } = createJobDb(async (sql) =>
      sql.includes('FROM client_profiles profile')
        ? queryResult([profileRow()])
        : queryResult())

    await expect(buildQueryPlansV2Job({
      env: { QUERY_PLANNER_V2_ENABLED: 'true' },
      workspaceId: '20',
      clientProfileId: '40',
      sources: ['hh'],
      dryRun: false,
    }, db)).resolves.toMatchObject({
      profilesScanned: 1,
      persisted: 1,
      consumersLinked: 1,
    })
    expect(mockedPersist).toHaveBeenCalledTimes(1)
    expect(mockedPersist.mock.calls[0][0][0].clientProfileId).toBe('40')
  })

  it('fails one malformed profile without contaminating the next profile', async () => {
    const { db } = createJobDb(async (sql) =>
      sql.includes('FROM client_profiles profile')
        ? queryResult([
          profileRow({ clientProfileId: 'bad' }),
          profileRow(),
        ])
        : queryResult())

    await expect(buildQueryPlansV2Job({
      env: { QUERY_PLANNER_V2_ENABLED: 'true' },
      sources: ['hh'],
    }, db)).resolves.toMatchObject({
      profilesScanned: 2,
      plansBuilt: 1,
      ready: 1,
      failedProfiles: 1,
    })
  })
})
