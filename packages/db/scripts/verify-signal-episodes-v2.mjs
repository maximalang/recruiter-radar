import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
if (process.env.SIGNAL_EPISODES_V2_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing to write fixtures without SIGNAL_EPISODES_V2_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const migrations = resolve(import.meta.dirname, '..', 'migrations')
const downSql = await readFile(
  resolve(migrations, '20260804110000_add_signal_episodes_v2.down.sql'),
  'utf8',
)
const commercialThesesDownSql = await readFile(
  resolve(migrations, '20260804120000_add_commercial_theses_v1.down.sql'),
  'utf8',
)
const externalAgencyPropensityDownSql = await readFile(
  resolve(
    migrations,
    '20260804130000_add_external_agency_propensity_v1.down.sql',
  ),
  'utf8',
)
const hash = (character) => character.repeat(64)

async function insertEvent(organizationId, evidenceId, suffix) {
  const inserted = await database.query(
    `INSERT INTO company_events (
       organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
       source_family, source_record_id, evidence_ids, event_fingerprint,
       confidence, payload, normalizer_version
     ) VALUES (
       $1, 'job_posting', '2026-08-03T08:00:00.000Z',
       '2026-08-03T09:00:00.000Z', '2026-08-03T10:00:00.000Z',
       'career-pages', $2, ARRAY[$3]::BIGINT[], $4, 0.9,
       '{"title":"Backend engineer","region":"Moscow"}',
       'company-event-normalizer-v1'
     ) RETURNING id::TEXT AS id`,
    [organizationId, `signal-episode-event-${suffix}`, evidenceId, hash(suffix)],
  )
  const eventId = inserted.rows[0].id
  await database.query(
    `INSERT INTO company_event_evidence (
       company_event_id, organization_id, evidence_id
     ) VALUES ($1, $2, $3)`,
    [eventId, organizationId, evidenceId],
  )
  return eventId
}

async function insertStateChange(organizationId, eventId, evidenceId, suffix) {
  const snapshot = await database.query(
    `INSERT INTO company_state_snapshots (
       organization_id, snapshot_at, observation_started_at,
       observation_ended_at, hiring_baseline, current_hiring_velocity,
       role_distribution, seniority_distribution, region_distribution,
       vacancy_lifetime, repost_rate, recruiting_capacity_signals,
       business_change_signals, state_classification, state_confidence,
       feature_version, evidence_hash, input_hash
     ) VALUES (
       $1, '2026-08-04T00:00:00.000Z', '2026-06-01T00:00:00.000Z',
       '2026-08-03T10:00:00.000Z',
       '{"vacancies14d":1,"sufficientHistory":true}',
       '{"vacancies14d":4,"baselineDeviation14d":3,"direction":"up"}',
       '{"current":{"backend":4},"baseline":{"backend":1}}',
       '{"current":{"senior":2},"baseline":{"senior":1}}',
       '{"current":{"Moscow":4},"baseline":{"Moscow":1},"newRegions":[]}',
       '{"observedCount":4,"medianDays":2}',
       '{"supported":false,"observedCount":4,"repostCount":0,"rate":null}',
       '{"currentRecruiterVacancies":0,"baselineRecruiterVacancies":0}',
       '{"current30d":{}}',
       'accelerating', 0.8, 'company-state-v1', $2, $3
     ) RETURNING id::TEXT AS id`,
    [organizationId, hash(suffix), hash(suffix === 'a' ? 'b' : 'c')],
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
  const change = await database.query(
    `INSERT INTO company_state_changes (
       snapshot_id, organization_id, change_type, direction, dimension,
       magnitude, baseline_deviation, confidence, evidence_hash,
       change_fingerprint, feature_version, payload
     ) VALUES (
       $1, $2, 'hiring_acceleration', 'up', 'all', 3, 3, 0.8,
       $3, $4, 'company-state-v1', '{"currentVacancies14d":4}'
     ) RETURNING id::TEXT AS id`,
    [snapshotId, organizationId, hash(suffix), hash(suffix === 'a' ? 'd' : 'e')],
  )
  const changeId = change.rows[0].id
  await database.query(
    `INSERT INTO company_state_change_events (
       change_id, organization_id, company_event_id
     ) VALUES ($1, $2, $3)`,
    [changeId, organizationId, eventId],
  )
  await database.query(
    `INSERT INTO company_state_change_evidence (
       change_id, organization_id, evidence_id
     ) VALUES ($1, $2, $3)`,
    [changeId, organizationId, evidenceId],
  )
  return changeId
}

const insertEpisodeSql = `INSERT INTO signal_episodes (
    organization_id, episode_identity, episode_generation, episode_type,
    stage, started_at, last_seen_at, valid_until, intensity, direction,
    baseline_deviation, role_families, regions, seniority_distribution,
    problem_hypotheses, evidence_hash, input_hash, engine_version
  ) VALUES (
    $1, $2, $3, 'vacancy_acceleration', 'active',
    '2026-08-04T00:00:00.000Z', '2026-08-04T10:00:00.000Z',
    '2026-08-25T10:00:00.000Z', 0.8, 'up', 3,
    ARRAY['backend'], ARRAY['Moscow'], '{"senior":2}',
    ARRAY['delivery_capacity_pressure'], $4, $5, 'signal-episode-v2'
  )
  ON CONFLICT (organization_id, engine_version, input_hash) DO NOTHING
  RETURNING id::TEXT AS id`

try {
  const organizations = await database.query(
    `INSERT INTO orgs (name, domain)
     VALUES
       ('Signal Episode verifier', 'signal-episode.example.invalid'),
       ('Signal Episode other', 'signal-episode-other.example.invalid')
     RETURNING id::TEXT AS id, name`,
  )
  const organizationId = organizations.rows.find(
    (row) => row.name === 'Signal Episode verifier',
  ).id
  const otherOrganizationId = organizations.rows.find(
    (row) => row.name === 'Signal Episode other',
  ).id
  const evidence = await database.query(
    `INSERT INTO evidence_items (
       org_id, source, url, fetched_at, content_hash, tier
     ) VALUES
       ($1, 'career-pages', 'https://signal-episode.example.invalid/1', NOW(), $3, 'direct'),
       ($1, 'career-pages', 'https://signal-episode.example.invalid/2', NOW(), $4, 'direct'),
       ($2, 'career-pages', 'https://signal-episode-other.example.invalid/1', NOW(), $5, 'direct')
     RETURNING id::TEXT AS id, org_id::TEXT AS "organizationId"`,
    [organizationId, otherOrganizationId, hash('1'), hash('2'), hash('3')],
  )
  const ownEvidenceIds = evidence.rows
    .filter((row) => row.organizationId === organizationId)
    .map((row) => row.id)
  const ownEvidenceId = ownEvidenceIds[0]
  const unlinkedOwnEvidenceId = ownEvidenceIds[1]
  const foreignEvidenceId = evidence.rows.find(
    (row) => row.organizationId === otherOrganizationId,
  ).id

  const eventId = await insertEvent(organizationId, ownEvidenceId, 'a')
  const otherEventId = await insertEvent(otherOrganizationId, foreignEvidenceId, 'f')
  const changeId = await insertStateChange(organizationId, eventId, ownEvidenceId, 'a')
  const otherChangeId = await insertStateChange(
    otherOrganizationId,
    otherEventId,
    foreignEvidenceId,
    'f',
  )

  const episodeValues = [organizationId, hash('6'), 1, hash('7'), hash('8')]
  const inserted = await database.query(insertEpisodeSql, episodeValues)
  assert.equal(inserted.rowCount, 1)
  const episodeId = inserted.rows[0].id
  const replay = await database.query(insertEpisodeSql, episodeValues)
  assert.equal(replay.rowCount, 0)

  await database.query(
    `INSERT INTO signal_episode_state_changes (
       signal_episode_id, organization_id, company_state_change_id
     ) VALUES ($1, $2, $3)`,
    [episodeId, organizationId, changeId],
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
    [episodeId, organizationId, ownEvidenceId],
  )

  await assert.rejects(
    database.query(
      `INSERT INTO signal_episode_state_changes (
         signal_episode_id, organization_id, company_state_change_id
       ) VALUES ($1, $2, $3)`,
      [episodeId, organizationId, otherChangeId],
    ),
    (error) => error?.code === '23503',
  )
  await assert.rejects(
    database.query(
      `INSERT INTO signal_episode_events (
         signal_episode_id, organization_id, company_event_id
       ) VALUES ($1, $2, $3)`,
      [episodeId, organizationId, otherEventId],
    ),
    (error) => error?.code === '23503',
  )
  await assert.rejects(
    database.query(
      `INSERT INTO signal_episode_evidence (
         signal_episode_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [episodeId, organizationId, foreignEvidenceId],
    ),
    (error) => ['23503', '23514'].includes(error?.code),
  )
  await assert.rejects(
    database.query(
      `INSERT INTO signal_episode_evidence (
         signal_episode_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [episodeId, organizationId, unlinkedOwnEvidenceId],
    ),
    (error) => error?.code === '23514',
  )
  await assert.rejects(
    database.query(
      `INSERT INTO signal_episodes (
         organization_id, episode_identity, episode_generation, episode_type,
         stage, started_at, last_seen_at, valid_until, intensity, direction,
         role_families, regions, seniority_distribution, problem_hypotheses,
         evidence_hash, input_hash, engine_version
       ) VALUES (
         $1, $2, 1, 'vacancy_acceleration', 'active',
         '2026-08-04', '2026-08-04T10:00:00Z', '2026-08-25T10:00:00Z',
         0.8, 'up', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '{}', ARRAY['x'],
         $3, $4, 'signal-episode-v2'
       )`,
      [organizationId, hash('6'), hash('7'), hash('9')],
    ),
    (error) => error?.code === '23505',
  )
  const nextGeneration = await database.query(insertEpisodeSql, [
    organizationId,
    hash('6'),
    2,
    hash('7'),
    hash('a'),
  ])
  assert.equal(nextGeneration.rowCount, 1)

  await assert.rejects(
    database.query('UPDATE signal_episodes SET stage = $2 WHERE id = $1', [episodeId, 'cooling']),
    (error) => error?.code === '55000',
  )
  await assert.rejects(
    database.query('DELETE FROM signal_episode_events WHERE signal_episode_id = $1', [episodeId]),
    (error) => error?.code === '55000',
  )
  await assert.rejects(database.query(downSql), (error) => error?.code === 'P0001')
  await database.query('ROLLBACK')

  await database.query('TRUNCATE TABLE signal_episodes CASCADE')
  await database.query(externalAgencyPropensityDownSql)
  await database.query(commercialThesesDownSql)
  await database.query(downSql)
  const removed = await database.query(
    `SELECT
       TO_REGCLASS('public.signal_episodes') AS episodes,
       TO_REGCLASS('public.signal_episode_state_changes') AS state_changes,
       TO_REGCLASS('public.signal_episode_events') AS events,
       TO_REGCLASS('public.signal_episode_evidence') AS evidence`,
  )
  assert.deepEqual(removed.rows[0], {
    episodes: null,
    state_changes: null,
    events: null,
    evidence: null,
  })

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'episode_replay_idempotent',
      'episode_generation_append_only',
      'state_change_tenant_scope_guarded',
      'event_tenant_scope_guarded',
      'evidence_tenant_scope_guarded',
      'evidence_must_come_from_linked_provenance',
      'episode_append_only',
      'rollback_refuses_data_loss',
      'rollback_removes_empty_schema',
    ],
  }))
} finally {
  await database.end()
}
