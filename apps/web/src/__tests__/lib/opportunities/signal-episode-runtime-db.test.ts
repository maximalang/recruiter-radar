import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  buildSignalEpisodes,
  type SignalEpisodeEventInput,
  type SignalEpisodeStateChangeInput,
} from '@/lib/opportunities/signal-episode'
import {
  persistSignalEpisode,
  type SignalEpisodeDb,
} from '@/lib/opportunities/signal-episode-repository'
import {
  buildSignalEpisodesJob,
  type SignalEpisodesJobDb,
} from '@/lib/opportunities/signal-episode-job'

const databaseUrl = process.env.DATABASE_URL
const isolatedDatabaseAcknowledged =
  process.env.SIGNAL_EPISODES_V2_DB_TEST_ACK === 'isolated'
const describeIfDatabase = databaseUrl && isolatedDatabaseAcknowledged
  ? describe
  : describe.skip

describeIfDatabase('Signal Episodes v2 PostgreSQL runtime', () => {
  const database = new Pool({ connectionString: databaseUrl })
  const repositoryDb = database as unknown as SignalEpisodeDb
  const jobDb = database as unknown as SignalEpisodesJobDb
  const token = randomUUID()
  const now = new Date('2026-08-04T12:00:00.000Z')
  let organizationId = ''
  let snapshotId = ''
  let stateChangeId = ''
  const events: SignalEpisodeEventInput[] = []

  beforeAll(async () => {
    const organization = await database.query<{ id: string }>(
      `INSERT INTO orgs (name, domain)
       VALUES ('Signal Episode runtime', $1)
       RETURNING id::TEXT AS id`,
      [`signal-episode-runtime-${token}.example.invalid`],
    )
    organizationId = organization.rows[0].id
    for (let index = 1; index <= 4; index += 1) {
      events.push(await insertEvent(index, 'job_posting'))
    }
    const snapshot = await database.query<{ id: string }>(
      `INSERT INTO company_state_snapshots (
         organization_id, snapshot_at, observation_started_at,
         observation_ended_at, hiring_baseline, current_hiring_velocity,
         role_distribution, seniority_distribution, region_distribution,
         vacancy_lifetime, repost_rate, recruiting_capacity_signals,
         business_change_signals, state_classification, state_confidence,
         feature_version, evidence_hash, input_hash
       ) VALUES (
         $1, $2, '2026-06-01T00:00:00.000Z', '2026-08-04T10:00:00.000Z',
         '{"vacancies14d":1,"sufficientHistory":true}',
         '{"vacancies14d":4,"baselineDeviation14d":3,"direction":"up"}',
         '{"current":{"backend":4},"baseline":{"backend":1}}',
         '{"current":{"senior":2},"baseline":{"senior":1}}',
         '{"current":{"Moscow":4},"baseline":{"Moscow":1},"newRegions":[]}',
         '{"observedCount":4,"medianDays":2}',
         '{"supported":false,"observedCount":4,"repostCount":0,"rate":null}',
         '{"currentRecruiterVacancies":0,"baselineRecruiterVacancies":0}',
         '{"current30d":{}}', 'accelerating', 0.85, 'company-state-v1',
         $3, $4
       ) RETURNING id::TEXT AS id`,
      [organizationId, now.toISOString(), 'a'.repeat(64), 'b'.repeat(64)],
    )
    snapshotId = snapshot.rows[0].id
    for (const item of events) {
      await database.query(
        `INSERT INTO company_state_snapshot_events (
           snapshot_id, organization_id, company_event_id
         ) VALUES ($1, $2, $3)`,
        [snapshotId, organizationId, item.id],
      )
      for (const evidenceId of item.evidenceIds) {
        await database.query(
          `INSERT INTO company_state_snapshot_evidence (
             snapshot_id, organization_id, evidence_id
           ) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [snapshotId, organizationId, evidenceId],
        )
      }
    }
    const change = await database.query<{ id: string }>(
      `INSERT INTO company_state_changes (
         snapshot_id, organization_id, change_type, direction, dimension,
         magnitude, baseline_deviation, confidence, evidence_hash,
         change_fingerprint, feature_version, payload
       ) VALUES (
         $1, $2, 'hiring_acceleration', 'up', 'all', 3, 1.5, 0.85,
         $3, $4, 'company-state-v1', '{"currentVacancies14d":4}'
       ) RETURNING id::TEXT AS id`,
      [snapshotId, organizationId, 'c'.repeat(64), 'd'.repeat(64)],
    )
    stateChangeId = change.rows[0].id
    for (const item of events) {
      await database.query(
        `INSERT INTO company_state_change_events (
           change_id, organization_id, company_event_id
         ) VALUES ($1, $2, $3)`,
        [stateChangeId, organizationId, item.id],
      )
      for (const evidenceId of item.evidenceIds) {
        await database.query(
          `INSERT INTO company_state_change_evidence (
             change_id, organization_id, evidence_id
           ) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [stateChangeId, organizationId, evidenceId],
        )
      }
    }
  })

  afterAll(async () => {
    await database.query('TRUNCATE TABLE signal_episodes CASCADE')
    await database.query('TRUNCATE TABLE company_state_snapshots CASCADE')
    await database.query('TRUNCATE TABLE company_events CASCADE')
    await database.query('DELETE FROM evidence_items WHERE org_id = $1', [organizationId])
    await database.query('DELETE FROM orgs WHERE id = $1', [organizationId])
    await database.end()
  })

  it('persists, replays, and advances one commercial situation by generation', async () => {
    const stateChange = changeInput()
    const firstBuild = buildSignalEpisodes(
      { stateChanges: [stateChange], events },
      { organizationId, now },
    )
    expect(firstBuild.episodes[0].episodeType).toBe('vacancy_acceleration')
    const first = await persistSignalEpisode(firstBuild.episodes[0], repositoryDb)
    const replay = await persistSignalEpisode(firstBuild.episodes[0], repositoryDb)
    expect(first).toMatchObject({ inserted: true, episodeGeneration: 1 })
    expect(replay).toMatchObject({ inserted: false, episodeGeneration: 1 })

    const leadership = await insertEvent(5, 'leadership_change')
    const refreshedBuild = buildSignalEpisodes(
      { stateChanges: [stateChange], events: [...events, leadership] },
      { organizationId, now },
    )
    expect(refreshedBuild.episodes[0]).toMatchObject({
      episodeType: 'leadership_led_expansion',
      episodeIdentity: firstBuild.episodes[0].episodeIdentity,
    })
    const refreshed = await persistSignalEpisode(
      refreshedBuild.episodes[0],
      repositoryDb,
    )
    expect(refreshed).toMatchObject({ inserted: true, episodeGeneration: 2 })

    const stored = await database.query(
      `SELECT episode_generation AS generation, episode_type AS type
       FROM signal_episodes
       WHERE organization_id = $1
       ORDER BY episode_generation`,
      [organizationId],
    )
    expect(stored.rows).toEqual([
      { generation: 1, type: 'vacancy_acceleration' },
      { generation: 2, type: 'leadership_led_expansion' },
    ])
  })

  it('discovers new context and persists a refreshed generation through the job', async () => {
    await database.query('TRUNCATE TABLE signal_episodes CASCADE')
    await insertEvent(6, 'leadership_change')
    const first = await buildSignalEpisodesJob({
      env: { SIGNAL_EPISODES_V2_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now,
    }, jobDb)
    expect(first).toMatchObject({
      scanned: 1,
      built: 1,
      active: 1,
      episodesPersisted: 1,
      failed: 0,
    })

    await insertEvent(7, 'leadership_change')
    const refreshed = await buildSignalEpisodesJob({
      env: { SIGNAL_EPISODES_V2_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now,
    }, jobDb)
    expect(refreshed).toMatchObject({
      scanned: 1,
      built: 1,
      active: 1,
      episodesPersisted: 1,
      failed: 0,
    })
    const stored = await database.query(
      `SELECT episode_generation AS generation, episode_type AS type
       FROM signal_episodes
       WHERE organization_id = $1
       ORDER BY episode_generation`,
      [organizationId],
    )
    expect(stored.rows).toEqual([
      { generation: 1, type: 'leadership_led_expansion' },
      { generation: 2, type: 'leadership_led_expansion' },
    ])
  })

  function changeInput(): SignalEpisodeStateChangeInput {
    return {
      id: stateChangeId,
      snapshotId,
      organizationId,
      snapshotAt: now.toISOString(),
      changeType: 'hiring_acceleration',
      direction: 'up',
      dimension: 'all',
      magnitude: 3,
      baselineDeviation: 1.5,
      confidence: 0.85,
      eventIds: events.map((item) => item.id),
      evidenceIds: events.flatMap((item) => item.evidenceIds),
      changeFingerprint: 'd'.repeat(64),
      payload: { currentVacancies14d: 4 },
    }
  }

  async function insertEvent(
    index: number,
    eventType: SignalEpisodeEventInput['eventType'],
  ): Promise<SignalEpisodeEventInput> {
    const occurredAt = new Date(
      now.getTime() - Math.min(index, 4) * 86_400_000 / 2,
    ).toISOString()
    const evidence = await database.query<{ id: string }>(
      `INSERT INTO evidence_items (
         org_id, source, url, fetched_at, content_hash, tier
       ) VALUES ($1, 'career-pages', $2, $3, $4, 'direct')
       RETURNING id::TEXT AS id`,
      [
        organizationId,
        `https://signal-episode-runtime.example.invalid/${token}/${index}`,
        occurredAt,
        (index + 10).toString(16).padStart(64, '0'),
      ],
    )
    const payload = eventType === 'leadership_change'
      ? { title: 'CTO', region: 'Moscow' }
      : { title: `Senior Backend Engineer ${index}`, region: 'Moscow' }
    const inserted = await database.query<{ id: string }>(
      `INSERT INTO company_events (
         organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
         source_family, source_record_id, evidence_ids, event_fingerprint,
         confidence, payload, normalizer_version
       ) VALUES (
         $1, $2, $3, $3, $3, 'career-pages', $4, ARRAY[$5]::BIGINT[],
         $6, 0.9, $7::JSONB, 'company-event-normalizer-v1'
       ) RETURNING id::TEXT AS id`,
      [
        organizationId,
        eventType,
        occurredAt,
        `signal-episode-runtime-${index}`,
        evidence.rows[0].id,
        (index + 20).toString(16).padStart(64, '0'),
        JSON.stringify(payload),
      ],
    )
    await database.query(
      `INSERT INTO company_event_evidence (
         company_event_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [inserted.rows[0].id, organizationId, evidence.rows[0].id],
    )
    return {
      id: inserted.rows[0].id,
      organizationId,
      eventType,
      occurredAt,
      firstSeenAt: occurredAt,
      lastSeenAt: occurredAt,
      eventFingerprint: (index + 20).toString(16).padStart(64, '0'),
      evidenceIds: [evidence.rows[0].id],
      confidence: 0.9,
      payload,
    }
  }
})
