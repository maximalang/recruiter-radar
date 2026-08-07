import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  buildProfileScopedQueryPlans,
  buildQueryPlanMetrics,
  type QueryPlannerV2ProfileInput,
} from '@/lib/lead-discovery/query-planner-v2'
import {
  persistProfileScopedQueryPlans,
  persistQueryPlanMetricSnapshot,
  type QueryPlannerV2Db,
} from '@/lib/lead-discovery/query-planner-v2-repository'
import {
  buildQueryPlansV2Job,
  type QueryPlannerV2JobDb,
} from '@/lib/lead-discovery/query-planner-v2-job'

const databaseUrl = process.env.DATABASE_URL
const isolated = process.env.QUERY_PLANNER_V2_DB_TEST_ACK === 'isolated'
const describeIfDatabase = databaseUrl && isolated ? describe : describe.skip

describeIfDatabase('Query Planner v2 PostgreSQL runtime', () => {
  const database = new Pool({ connectionString: databaseUrl })
  const plannerDb = database as unknown as QueryPlannerV2Db
  const plannerJobDb = database as unknown as QueryPlannerV2JobDb
  const token = randomUUID()
  const ownerIds: string[] = []
  let workspaceId = ''
  let profileId = ''
  let otherProfileId = ''
  let profileSnapshotHash = ''

  beforeAll(async () => {
    const owners = await database.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ($1, 'Query planner runtime'), ($2, 'Query planner other')
       RETURNING id::TEXT AS id`,
      [
        `query-planner-${token}@example.invalid`,
        `query-planner-other-${token}@example.invalid`,
      ],
    )
    ownerIds.push(...owners.rows.map((row) => row.id))
    const profiles = await database.query<{
      id: string
      ownerId: string
      workspaceId: string
      profileSnapshotHash: string
    }>(
      `WITH inserted AS (
         INSERT INTO client_profiles (
           agency_name, owner_id, specialization, roles, industries,
           target_city, preferred_regions, excluded_locations,
           target_seniorities, include_keywords, exclude_keywords,
           remote_friendly, daily_digest_limit
         ) VALUES
           ('Query planner runtime', $1, 'data', ARRAY['data'],
            '["fintech"]', 'Москва', ARRAY['Москва'], ARRAY[]::TEXT[],
            ARRAY['senior'], '["python"]', '["стажер"]', TRUE, 10),
           ('Query planner other', $2, 'sales', ARRAY['sales'],
            '["retail"]', 'Казань', ARRAY['Казань'], ARRAY[]::TEXT[],
            ARRAY['middle'], '[]', '[]', FALSE, 5)
         RETURNING *
       )
       SELECT
         profile.id::TEXT AS id,
         profile.owner_id::TEXT AS "ownerId",
         profile.workspace_id::TEXT AS "workspaceId",
         ENCODE(
           DIGEST(agency_dna_full_snapshot(profile)::TEXT, 'sha256'),
           'hex'
         ) AS "profileSnapshotHash"
       FROM inserted profile`,
      ownerIds,
    )
    const profile = profiles.rows.find((row) => row.ownerId === ownerIds[0])
    const other = profiles.rows.find((row) => row.ownerId === ownerIds[1])
    if (!profile || !other) throw new Error('Query planner fixtures failed.')
    workspaceId = profile.workspaceId
    profileId = profile.id
    otherProfileId = other.id
    profileSnapshotHash = profile.profileSnapshotHash
  })

  afterAll(async () => {
    await database.query('TRUNCATE TABLE query_plan_snapshots CASCADE')
    await database.query('TRUNCATE TABLE query_plan_shared_requests CASCADE')
    await database.query(
      'DELETE FROM client_profiles WHERE owner_id = ANY($1::BIGINT[])',
      [ownerIds],
    )
    await database.query(
      'DELETE FROM workspaces WHERE bootstrap_user_id = ANY($1::BIGINT[])',
      [ownerIds],
    )
    await database.query('DELETE FROM users WHERE id = ANY($1::BIGINT[])', [ownerIds])
    await database.end()
  })

  it('appends, exactly replays, and advances a profile-scoped plan', async () => {
    const initial = buildPlans()
    const first = await persistProfileScopedQueryPlans(initial, plannerDb)
    expect(first).toMatchObject({
      plans: [{ planGeneration: 1, inserted: true }],
      sharedRequestsInserted: 1,
      consumersLinked: 1,
    })
    const replay = await persistProfileScopedQueryPlans(initial, plannerDb)
    expect(replay).toMatchObject({
      plans: [{
        planSnapshotId: first.plans[0].planSnapshotId,
        planGeneration: 1,
        inserted: false,
      }],
      sharedRequestsInserted: 0,
      consumersLinked: 0,
    })

    const changed = buildPlans({ includeKeywords: ['python', 'golang'] })
    await expect(persistProfileScopedQueryPlans(changed, plannerDb)).resolves
      .toMatchObject({ plans: [{ planGeneration: 2, inserted: true }] })
  })

  it('keeps unknown geography out of shared source execution', async () => {
    const review = buildPlans({ preferredRegions: ['Неизвестный регион'] })
    expect(review[0].status).toBe('review')
    await expect(persistProfileScopedQueryPlans(review, plannerDb)).resolves
      .toMatchObject({
        plans: [{ inserted: true }],
        sharedRequestsInserted: 0,
        consumersLinked: 0,
      })
  })

  it('rejects cross-tenant provenance and append-only mutation', async () => {
    const crossTenantPlan = buildProfileScopedQueryPlans({
      profiles: [{
        ...profileInput({ includeKeywords: ['cross-tenant-attempt'] }),
      clientProfileId: otherProfileId,
      }],
      sources: ['hh'],
    })
    await expect(persistProfileScopedQueryPlans(crossTenantPlan, plannerDb))
      .rejects.toMatchObject({ code: expect.stringMatching(/23503|23514/) })

    const stored = await database.query<{ id: string }>(
      `SELECT id::TEXT AS id FROM query_plan_snapshots
       WHERE workspace_id = $1 AND client_profile_id = $2
       ORDER BY id LIMIT 1`,
      [workspaceId, profileId],
    )
    await expect(database.query(
      'UPDATE query_plan_snapshots SET page_budget = 1 WHERE id = $1',
      [stored.rows[0].id],
    )).rejects.toMatchObject({ code: '55000' })
  })

  it('stores per-profile yield metrics and exactly replays them', async () => {
    const plan = await database.query<{ id: string }>(
      `SELECT id::TEXT AS id FROM query_plan_snapshots
       WHERE workspace_id = $1 AND client_profile_id = $2 AND status = 'ready'
       ORDER BY id LIMIT 1`,
      [workspaceId, profileId],
    )
    const input = {
      planSnapshotId: plan.rows[0].id,
      workspaceId,
      clientProfileId: profileId,
      measurementWindowStart: '2026-08-01T00:00:00.000Z',
      measurementWindowEnd: '2026-08-02T00:00:00.000Z',
      metrics: buildQueryPlanMetrics({
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
      }),
    }
    const first = await persistQueryPlanMetricSnapshot(input, plannerDb)
    expect(first.inserted).toBe(true)
    await expect(persistQueryPlanMetricSnapshot(input, plannerDb)).resolves
      .toEqual({ metricSnapshotId: first.metricSnapshotId, inserted: false })
  })

  it('loads and applies one exact profile through the dark job boundary', async () => {
    const options = {
      env: { QUERY_PLANNER_V2_ENABLED: 'true' },
      workspaceId,
      clientProfileId: profileId,
      sources: ['superjob'] as const,
    }
    await expect(buildQueryPlansV2Job(options, plannerJobDb)).resolves
      .toMatchObject({
        dryRun: true,
        profilesScanned: 1,
        plansBuilt: 1,
        ready: 1,
        persisted: 0,
        failedProfiles: 0,
      })
    await expect(buildQueryPlansV2Job({
      ...options,
      dryRun: false,
    }, plannerJobDb)).resolves.toMatchObject({
      profilesScanned: 1,
      plansBuilt: 1,
      persisted: 1,
      consumersLinked: 1,
      failedProfiles: 0,
    })
  })

  function buildPlans(overrides: Partial<QueryPlannerV2ProfileInput> = {}) {
    return buildProfileScopedQueryPlans({
      profiles: [profileInput(overrides)],
      sources: ['hh'],
    })
  }

  function profileInput(
    overrides: Partial<QueryPlannerV2ProfileInput> = {},
  ): QueryPlannerV2ProfileInput {
    return {
      workspaceId,
      ownerId: ownerIds[0],
      clientProfileId: profileId,
      profileSnapshotHash,
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
})
