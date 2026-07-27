/** @jest-environment node */

import { Pool } from 'pg'

import { getPool } from '@/lib/db-pool'
import {
  buildOpportunitiesJob,
  detectHiringEpisodesJob,
  expireOpportunitiesJob,
} from '@/lib/opportunities/jobs'
import { applyOpportunityAction } from '@/lib/opportunities/repository'

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip
const DAY_MS = 24 * 60 * 60 * 1000

interface RuntimeOpportunityRow {
  id: string
  status: string
  scoringVersion: string
  snoozedUntil: string | null
  inputHash: string
  digestCandidateId: string | null
  updatedAt: string
  hiringEpisodeId: string
  episodeGeneration: number
}

describeWithDatabase('Opportunity Engine production PostgreSQL runtime', () => {
  jest.setTimeout(90_000)

  const originalFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const database = new Pool({ connectionString: process.env.DATABASE_URL })
  const token = `${Date.now()}-${process.pid}`
  let ownerId = ''
  let clientProfileId = ''
  let organizationId = ''

  beforeAll(async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    const owner = await database.query(
      `INSERT INTO users (email, full_name)
       VALUES ($1, 'Opportunity Runtime Test')
       RETURNING id::TEXT AS id`,
      [`opportunity-runtime-${token}@example.invalid`],
    )
    ownerId = String(owner.rows[0].id)
    const profile = await database.query(
      `INSERT INTO client_profiles (
         agency_name, owner_id, industries, roles, specialization, target_city
       )
       VALUES (
         'Opportunity Runtime Agency', $1, '["IT"]'::jsonb,
         ARRAY['backend']::text[], 'Backend Java', 'Москва'
       )
       RETURNING id::TEXT AS id`,
      [ownerId],
    )
    clientProfileId = String(profile.rows[0].id)
    const organization = await database.query(
      `INSERT INTO orgs (name, domain, country, industry, city)
       VALUES ('Opportunity Runtime Organization', $1, 'Россия', 'IT', 'Москва')
       RETURNING id::TEXT AS id`,
      [`opportunity-runtime-${token}.example.invalid`],
    )
    organizationId = String(organization.rows[0].id)
  })

  afterAll(async () => {
    if (ownerId) await database.query('DELETE FROM users WHERE id = $1', [ownerId])
    if (organizationId) await database.query('DELETE FROM orgs WHERE id = $1', [organizationId])
    await database.end()
    const sharedPool = getPool()
    if (sharedPool) await sharedPool.end()
    delete (globalThis as typeof globalThis & {
      recruiterRadarSharedPool?: Pool
    }).recruiterRadarSharedPool
    if (originalFlag === undefined) delete process.env.OPPORTUNITY_ENGINE_V1_ENABLED
    else process.env.OPPORTUNITY_ENGINE_V1_ENABLED = originalFlag
  })

  async function insertSignals(
    now: Date,
    prefix: string,
  ): Promise<string[]> {
    const specs = [
      { title: 'Java developer', source: 'hh', externalId: `${prefix}-1001`, daysAgo: 7 },
      { title: 'Java developer', source: 'career-pages', externalId: null, daysAgo: 6 },
      { title: 'Java developer', source: 'hh', externalId: `${prefix}-1002`, daysAgo: 5 },
      { title: 'Node.js developer', source: 'hh', externalId: `${prefix}-node`, daysAgo: 4 },
      { title: 'Python developer', source: 'hh', externalId: `${prefix}-python`, daysAgo: 3 },
      { title: 'Go developer', source: 'hh', externalId: `${prefix}-go`, daysAgo: 2 },
      { title: 'QA engineer', source: 'hh', externalId: `${prefix}-qa`, daysAgo: 1 },
    ]
    const ids: string[] = []
    for (const spec of specs) {
      const signal = await database.query(
        `INSERT INTO signals (
           org_id, signal_type, source, external_id, headline,
           source_url, occurred_at, payload
         )
         VALUES (
           $1, 'job_posting', $2, $3, $4::text, $5, $6::timestamptz,
           JSONB_BUILD_OBJECT('vacancy_name', $4::text, 'area_name', 'Москва')
         )
         RETURNING id::TEXT AS id`,
        [
          organizationId,
          spec.source,
          spec.externalId,
          spec.title,
          `https://example.invalid/${prefix}/jobs/${spec.source}/${spec.daysAgo}`,
          new Date(now.getTime() - spec.daysAgo * DAY_MS).toISOString(),
        ],
      )
      ids.push(String(signal.rows[0].id))
    }
    return ids
  }

  async function insertDigestCandidate(createdAt?: Date): Promise<string> {
    const run = await database.query(
      `INSERT INTO digest_runs (
         client_profile_id, status, requested_limit, selected_count,
         created_at, completed_at
       )
       VALUES (
         $1, 'completed', 10, 1,
         COALESCE($2::timestamptz, NOW()), COALESCE($2::timestamptz, NOW())
       )
       RETURNING id::TEXT AS id`,
      [clientProfileId, createdAt?.toISOString() ?? null],
    )
    const candidate = await database.query(
      `INSERT INTO digest_candidates (
         digest_run_id, client_profile_id, org_id, source_display_name,
         source_families, vacancies_count, distinct_vacancy_names_count,
         total_score, reasons, opener, payload, created_at
       )
       VALUES (
         $1, $2, $3, 'Opportunity Runtime Organization',
         '["hh", "career-pages"]'::jsonb, 7, 6, 90,
         '["evidence-backed"]'::jsonb, 'Test opener',
         '{"confidenceGate":"A","contactPaths":[]}'::jsonb,
         COALESCE($4::timestamptz, NOW())
       )
       RETURNING id::TEXT AS id`,
      [run.rows[0].id, clientProfileId, organizationId, createdAt?.toISOString() ?? null],
    )
    return String(candidate.rows[0].id)
  }

  async function currentOpportunity(episodeType: string) {
    const result = await database.query<RuntimeOpportunityRow>(
      `SELECT
         opportunity.id::TEXT AS id,
         opportunity.status,
         opportunity.scoring_version AS "scoringVersion",
         opportunity.snoozed_until::TEXT AS "snoozedUntil",
         opportunity.input_hash AS "inputHash",
         opportunity.digest_candidate_id::TEXT AS "digestCandidateId",
         opportunity.updated_at::TEXT AS "updatedAt",
         episode.id::TEXT AS "hiringEpisodeId",
         episode.episode_generation AS "episodeGeneration"
       FROM opportunities opportunity
       JOIN hiring_episodes episode ON episode.id = opportunity.hiring_episode_id
       WHERE opportunity.client_profile_id = $1
         AND opportunity.organization_id = $2
         AND opportunity.superseded_at IS NULL
         AND episode.episode_type = $3
       ORDER BY episode.episode_generation DESC
       LIMIT 1`,
      [clientProfileId, organizationId, episodeType],
    )
    return result.rows[0]
  }

  it('executes lifecycle, replay, supersession, hashing, and generation invariants', async () => {
    const initialNow = new Date(Date.now() - 60_000)
    const signalIds = await insertSignals(initialNow, 'initial')
    const firstDetection = await detectHiringEpisodesJob({
      enabled: true,
      organizationId,
      now: initialNow,
    })
    expect(firstDetection.failed).toBe(0)

    const roleEpisode = await database.query<{
      id: string
      vacancyCount: number
      startedAt: string
      lastSeenAt: string
    }>(
      `SELECT
         id::TEXT AS id,
         vacancy_count AS "vacancyCount",
         started_at::TEXT AS "startedAt",
         last_seen_at::TEXT AS "lastSeenAt"
       FROM hiring_episodes
       WHERE organization_id = $1
         AND episode_type = 'role_cluster'
         AND status = 'active'
       ORDER BY id DESC
       LIMIT 1`,
      [organizationId],
    )
    expect(roleEpisode.rows[0].vacancyCount).toBe(4)

    await database.query('DELETE FROM signals WHERE id = ANY($1::bigint[])', [
      [signalIds[0], signalIds[5]],
    ])
    const secondDetection = await detectHiringEpisodesJob({
      enabled: true,
      organizationId,
      now: initialNow,
    })
    expect(secondDetection.failed).toBe(0)
    const preservedBounds = await database.query<{
      startedAt: string
      lastSeenAt: string
    }>(
      `SELECT
         started_at::TEXT AS "startedAt",
         last_seen_at::TEXT AS "lastSeenAt"
       FROM hiring_episodes
       WHERE id = $1`,
      [roleEpisode.rows[0].id],
    )
    expect(preservedBounds.rows[0]).toEqual({
      startedAt: roleEpisode.rows[0].startedAt,
      lastSeenAt: roleEpisode.rows[0].lastSeenAt,
    })

    const firstCandidateId = await insertDigestCandidate()
    const firstBuild = await buildOpportunitiesJob({ enabled: true, organizationId })
    expect(firstBuild.failed).toBe(0)
    const roleV1Before = await currentOpportunity('role_cluster')
    expect(roleV1Before).toBeDefined()

    await insertDigestCandidate()
    const semanticReplay = await buildOpportunitiesJob({ enabled: true, organizationId })
    expect(semanticReplay.skippedUnchanged).toBeGreaterThan(0)
    const roleV1Unchanged = await currentOpportunity('role_cluster')
    expect(roleV1Unchanged.inputHash).toBe(roleV1Before.inputHash)
    expect(roleV1Unchanged.updatedAt).toBe(roleV1Before.updatedAt)
    expect(roleV1Unchanged.digestCandidateId).toBe(firstCandidateId)

    const spikeV1 = await currentOpportunity('vacancy_spike')
    const snoozed = await applyOpportunityAction({
      ownerId,
      opportunityId: spikeV1.id,
      action: 'snoozed',
      actionKey: `snooze:${token}`,
      snoozeDays: 1,
    })
    expect(snoozed?.opportunity.snoozedUntil).toBeTruthy()
    const snoozedUntil = snoozed?.opportunity.snoozedUntil as string

    await buildOpportunitiesJob({
      enabled: true,
      organizationId,
      scoringVersion: 'opportunity-v2',
    })
    expect((await currentOpportunity('vacancy_spike')).snoozedUntil).toBe(snoozedUntil)
    await buildOpportunitiesJob({
      enabled: true,
      organizationId,
      scoringVersion: 'opportunity-v1',
    })
    expect((await currentOpportunity('vacancy_spike')).snoozedUntil).toBe(snoozedUntil)

    const healedByBuild = await buildOpportunitiesJob({
      enabled: true,
      organizationId,
      scoringVersion: 'opportunity-v1',
      now: new Date(Date.parse(snoozedUntil) + 1_000),
    })
    expect(healedByBuild.updated).toBeGreaterThan(0)
    expect((await currentOpportunity('vacancy_spike')).status).toBe('new')

    const expired = await expireOpportunitiesJob({
      enabled: true,
      organizationId,
      now: new Date(Date.parse(snoozedUntil) + 2_000),
    })
    expect(expired.updated).toBe(0)

    const roleV1 = await currentOpportunity('role_cluster')
    await applyOpportunityAction({
      ownerId,
      opportunityId: roleV1.id,
      action: 'accepted',
      actionKey: `accepted:${token}`,
    })
    await applyOpportunityAction({
      ownerId,
      opportunityId: roleV1.id,
      action: 'contacted',
      actionKey: `contacted:${token}`,
    })
    const legacySuppression = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM client_digest_org_state
       WHERE client_profile_id = $1 AND org_id = $2`,
      [clientProfileId, organizationId],
    )
    expect(legacySuppression.rows[0].count).toBe(0)
    expect((await applyOpportunityAction({
      ownerId,
      opportunityId: roleV1.id,
      action: 'accepted',
      actionKey: `accepted:${token}`,
    }))?.opportunity.status).toBe('contacted')

    await buildOpportunitiesJob({
      enabled: true,
      organizationId,
      scoringVersion: 'opportunity-v2',
    })
    const roleV2 = await currentOpportunity('role_cluster')
    const supersededReplay = await applyOpportunityAction({
      ownerId,
      opportunityId: roleV1.id,
      action: 'accepted',
      actionKey: `accepted:${token}`,
    })
    expect(supersededReplay?.opportunity.id).toBe(roleV2.id)
    expect(supersededReplay?.opportunity.status).toBe('contacted')

    await database.query(
      `UPDATE hiring_episodes
       SET status = 'closed', closed_at = last_seen_at
       WHERE organization_id = $1 AND status = 'active'`,
      [organizationId],
    )
    const futureNow = new Date(initialNow.getTime() + 50 * DAY_MS)
    await insertSignals(futureNow, 'generation-2')
    const futureDetection = await detectHiringEpisodesJob({
      enabled: true,
      organizationId,
      now: futureNow,
    })
    expect(futureDetection.failed).toBe(0)
    await insertDigestCandidate(new Date(futureNow.getTime() + 60_000))
    const futureBuild = await buildOpportunitiesJob({
      enabled: true,
      organizationId,
      scoringVersion: 'opportunity-v2',
      now: futureNow,
    })
    expect(futureBuild.failed).toBe(0)
    const roleGeneration2 = await currentOpportunity('role_cluster')
    expect(roleGeneration2.episodeGeneration).toBe(2)
    expect(roleGeneration2.status).not.toBe('contacted')
  })
})
