import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  buildCommercialThesesJob,
  type CommercialThesisJobDb,
} from '@/lib/opportunities/commercial-thesis-job'

const databaseUrl = process.env.DATABASE_URL
const isolatedDatabaseAcknowledged =
  process.env.COMMERCIAL_THESIS_V1_DB_TEST_ACK === 'isolated'
const describeIfDatabase = databaseUrl && isolatedDatabaseAcknowledged
  ? describe
  : describe.skip

describeIfDatabase('Commercial Thesis v1 PostgreSQL runtime', () => {
  const database = new Pool({ connectionString: databaseUrl })
  const jobDb = database as unknown as CommercialThesisJobDb
  const token = randomUUID()
  const now = new Date('2026-08-04T12:00:00.000Z')
  let organizationId = ''
  let evidenceId = ''
  let eventId = ''
  let stateChangeId = ''
  let episodeIdentity = ''

  beforeAll(async () => {
    const organization = await database.query<{ id: string }>(
      `INSERT INTO orgs (name, domain)
       VALUES ('Commercial Thesis runtime', $1)
       RETURNING id::TEXT AS id`,
      [`commercial-thesis-runtime-${token}.example.invalid`],
    )
    organizationId = organization.rows[0].id
    const evidence = await database.query<{ id: string }>(
      `INSERT INTO evidence_items (
         org_id, source, url, fetched_at, content_hash, tier
       ) VALUES ($1, 'career-pages', $2, $3, $4, 'direct')
       RETURNING id::TEXT AS id`,
      [
        organizationId,
        `https://commercial-thesis-runtime.example.invalid/${token}`,
        '2026-08-04T09:00:00.000Z',
        '1'.repeat(64),
      ],
    )
    evidenceId = evidence.rows[0].id
    const event = await database.query<{ id: string }>(
      `INSERT INTO company_events (
         organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
         source_family, source_record_id, evidence_ids, event_fingerprint,
         confidence, payload, normalizer_version
       ) VALUES (
         $1, 'job_posting', '2026-08-04T08:00:00Z',
         '2026-08-04T09:00:00Z', '2026-08-04T10:00:00Z',
         'career-pages', $2, ARRAY[$3]::BIGINT[], $4, 0.9,
         '{"title":"Senior Backend Engineer","region":"Moscow"}',
         'company-event-normalizer-v1'
       ) RETURNING id::TEXT AS id`,
      [organizationId, `commercial-thesis-runtime-${token}`, evidenceId, '2'.repeat(64)],
    )
    eventId = event.rows[0].id
    await database.query(
      `INSERT INTO company_event_evidence (
         company_event_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [eventId, organizationId, evidenceId],
    )
    const snapshot = await database.query<{ id: string }>(
      `INSERT INTO company_state_snapshots (
         organization_id, snapshot_at, observation_started_at,
         observation_ended_at, hiring_baseline, current_hiring_velocity,
         role_distribution, seniority_distribution, region_distribution,
         vacancy_lifetime, repost_rate, recruiting_capacity_signals,
         business_change_signals, state_classification, state_confidence,
         feature_version, evidence_hash, input_hash
       ) VALUES (
         $1, '2026-08-04T10:00:00Z', '2026-06-01T00:00:00Z',
         '2026-08-04T10:00:00Z',
         '{"vacancies14d":1,"sufficientHistory":true}',
         '{"vacancies14d":4,"baselineDeviation14d":3,"direction":"up"}',
         '{"current":{"backend":4},"baseline":{"backend":1}}',
         '{"current":{"senior":3},"baseline":{"senior":1}}',
         '{"current":{"Moscow":4},"baseline":{"Moscow":1},"newRegions":[]}',
         '{"observedCount":4,"medianDays":2}',
         '{"supported":false,"observedCount":4,"repostCount":0,"rate":null}',
         '{"currentRecruiterVacancies":0,"baselineRecruiterVacancies":0}',
         '{"current30d":{}}', 'accelerating', 0.9, 'company-state-v1',
         $2, $3
       ) RETURNING id::TEXT AS id`,
      [organizationId, '3'.repeat(64), '4'.repeat(64)],
    )
    const snapshotId = snapshot.rows[0].id
    await database.query(
      `INSERT INTO company_state_snapshot_events (
         snapshot_id, organization_id, company_event_id
       ) VALUES ($1, $2, $3)`,
      [snapshotId, organizationId, eventId],
    )
    await database.query(
      `INSERT INTO company_state_snapshot_evidence (
         snapshot_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [snapshotId, organizationId, evidenceId],
    )
    const change = await database.query<{ id: string }>(
      `INSERT INTO company_state_changes (
         snapshot_id, organization_id, change_type, direction, dimension,
         magnitude, baseline_deviation, confidence, evidence_hash,
         change_fingerprint, feature_version, payload
       ) VALUES (
         $1, $2, 'hiring_acceleration', 'up', 'all', 3, 1.5, 0.9,
         $3, $4, 'company-state-v1', '{"currentVacancies14d":4}'
       ) RETURNING id::TEXT AS id`,
      [snapshotId, organizationId, '5'.repeat(64), '6'.repeat(64)],
    )
    stateChangeId = change.rows[0].id
    await database.query(
      `INSERT INTO company_state_change_events (
         change_id, organization_id, company_event_id
       ) VALUES ($1, $2, $3)`,
      [stateChangeId, organizationId, eventId],
    )
    await database.query(
      `INSERT INTO company_state_change_evidence (
         change_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [stateChangeId, organizationId, evidenceId],
    )
    episodeIdentity = '7'.repeat(64)
    await insertEpisode(1, '8'.repeat(64))
  })

  afterAll(async () => {
    await database.query('TRUNCATE TABLE commercial_theses CASCADE')
    await database.query('TRUNCATE TABLE signal_episodes CASCADE')
    await database.query('TRUNCATE TABLE company_state_snapshots CASCADE')
    await database.query('TRUNCATE TABLE company_events CASCADE')
    await database.query('DELETE FROM evidence_items WHERE org_id = $1', [organizationId])
    await database.query('DELETE FROM orgs WHERE id = $1', [organizationId])
    await database.end()
  })

  it('previews, applies, skips processed input, and advances with the latest episode', async () => {
    const dryRun = await buildCommercialThesesJob({
      env: { COMMERCIAL_THESIS_V1_ENABLED: 'true' },
      organizationId,
      now,
    }, jobDb)
    expect(dryRun).toMatchObject({
      dryRun: true, scanned: 1, built: 1, thesesPersisted: 0, failed: 0,
    })

    const applied = await buildCommercialThesesJob({
      env: { COMMERCIAL_THESIS_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now,
    }, jobDb)
    expect(applied).toMatchObject({
      dryRun: false, scanned: 1, built: 1, thesesPersisted: 1, failed: 0,
    })

    const noOp = await buildCommercialThesesJob({
      env: { COMMERCIAL_THESIS_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now,
    }, jobDb)
    expect(noOp).toMatchObject({ scanned: 0, built: 0, thesesPersisted: 0 })

    await insertEpisode(2, '9'.repeat(64))
    const refreshed = await buildCommercialThesesJob({
      env: { COMMERCIAL_THESIS_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now,
    }, jobDb)
    expect(refreshed).toMatchObject({
      scanned: 1, built: 1, thesesPersisted: 1, failed: 0,
    })
    const stored = await database.query(
      `SELECT
         thesis_generation AS "thesisGeneration",
         signal_episode_generation AS "episodeGeneration",
         why_this_agency_fits->0->>'classification' AS "agencyFitClassification"
       FROM commercial_theses
       WHERE organization_id = $1
       ORDER BY thesis_generation`,
      [organizationId],
    )
    expect(stored.rows).toEqual([
      { thesisGeneration: 1, episodeGeneration: 1, agencyFitClassification: 'unknown' },
      { thesisGeneration: 2, episodeGeneration: 2, agencyFitClassification: 'unknown' },
    ])
  })

  async function insertEpisode(
    generation: number,
    inputHash: string,
  ): Promise<void> {
    const inserted = await database.query<{ id: string }>(
      `INSERT INTO signal_episodes (
         organization_id, episode_identity, episode_generation, episode_type,
         stage, started_at, last_seen_at, valid_until, intensity, direction,
         baseline_deviation, role_families, regions, seniority_distribution,
         problem_hypotheses, evidence_hash, input_hash, engine_version
       ) VALUES (
         $1, $2, $3, 'vacancy_acceleration', 'active',
         '2026-08-01T09:00:00Z', '2026-08-04T10:00:00Z',
         '2026-08-25T10:00:00Z', 0.82, 'up', 1.5,
         ARRAY['backend'], ARRAY['Moscow'], '{"senior":3}',
         ARRAY['delivery_capacity_pressure'], $4, $5, 'signal-episode-v2'
       ) RETURNING id::TEXT AS id`,
      [organizationId, episodeIdentity, generation, 'a'.repeat(64), inputHash],
    )
    const episodeId = inserted.rows[0].id
    await database.query(
      `INSERT INTO signal_episode_state_changes (
         signal_episode_id, organization_id, company_state_change_id
       ) VALUES ($1, $2, $3)`,
      [episodeId, organizationId, stateChangeId],
    )
    await database.query(
      `INSERT INTO signal_episode_events (
         signal_episode_id, organization_id, company_event_id
       ) VALUES ($1, $2, $3)`,
      [episodeId, organizationId, eventId],
    )
    await database.query(
      `INSERT INTO signal_episode_evidence (
         signal_episode_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [episodeId, organizationId, evidenceId],
    )
  }
})
