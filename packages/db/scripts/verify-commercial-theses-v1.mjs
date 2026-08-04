import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
if (process.env.COMMERCIAL_THESIS_V1_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing to write fixtures without COMMERCIAL_THESIS_V1_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const migrations = resolve(import.meta.dirname, '..', 'migrations')
const downSql = await readFile(
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

async function seedEpisode({
  organizationId,
  evidenceId,
  suffix,
  episodeIdentity,
  episodeGeneration,
}) {
  const event = await database.query(
    `INSERT INTO company_events (
       organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
       source_family, source_record_id, evidence_ids, event_fingerprint,
       confidence, payload, normalizer_version
     ) VALUES (
       $1, 'job_posting', '2026-08-03T08:00:00Z',
       '2026-08-03T09:00:00Z', '2026-08-03T10:00:00Z',
       'career-pages', $2, ARRAY[$3]::BIGINT[], $4, 0.9,
       '{"title":"Backend engineer","region":"Moscow"}',
       'company-event-normalizer-v1'
     ) RETURNING id::TEXT AS id`,
    [organizationId, `commercial-thesis-event-${suffix}`, evidenceId, hash(suffix)],
  )
  const eventId = event.rows[0].id
  await database.query(
    `INSERT INTO company_event_evidence (
       company_event_id, organization_id, evidence_id
     ) VALUES ($1, $2, $3)`,
    [eventId, organizationId, evidenceId],
  )
  const snapshot = await database.query(
    `INSERT INTO company_state_snapshots (
       organization_id, snapshot_at, observation_started_at,
       observation_ended_at, hiring_baseline, current_hiring_velocity,
       role_distribution, seniority_distribution, region_distribution,
       vacancy_lifetime, repost_rate, recruiting_capacity_signals,
       business_change_signals, state_classification, state_confidence,
       feature_version, evidence_hash, input_hash
     ) VALUES (
       $1, '2026-08-04T00:00:00Z', '2026-06-01T00:00:00Z',
       '2026-08-03T10:00:00Z',
       '{"vacancies14d":1,"sufficientHistory":true}',
       '{"vacancies14d":4,"baselineDeviation14d":3,"direction":"up"}',
       '{"current":{"backend":4},"baseline":{"backend":1}}',
       '{"current":{"senior":2},"baseline":{"senior":1}}',
       '{"current":{"Moscow":4},"baseline":{"Moscow":1},"newRegions":[]}',
       '{"observedCount":4,"medianDays":2}',
       '{"supported":false,"observedCount":4,"repostCount":0,"rate":null}',
       '{"currentRecruiterVacancies":0,"baselineRecruiterVacancies":0}',
       '{"current30d":{}}', 'accelerating', 0.8, 'company-state-v1',
       $2, $3
     ) RETURNING id::TEXT AS id`,
    [organizationId, hash(suffix), hash(nextCharacter(suffix))],
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
       $1, $2, 'hiring_acceleration', 'up', 'all', 3, 1.5, 0.8,
       $3, $4, 'company-state-v1', '{"currentVacancies14d":4}'
     ) RETURNING id::TEXT AS id`,
    [snapshotId, organizationId, hash(suffix), hash(nextCharacter(nextCharacter(suffix)))],
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
  const evidenceHash = hash(nextCharacter(nextCharacter(nextCharacter(suffix))))
  const episode = await database.query(
    `INSERT INTO signal_episodes (
       organization_id, episode_identity, episode_generation, episode_type,
       stage, started_at, last_seen_at, valid_until, intensity, direction,
       baseline_deviation, role_families, regions, seniority_distribution,
       problem_hypotheses, evidence_hash, input_hash, engine_version
     ) VALUES (
       $1, $2, $3, 'vacancy_acceleration', 'active',
       '2026-08-03T08:00:00Z', '2026-08-04T10:00:00Z',
       '2026-08-25T10:00:00Z', 0.8, 'up', 1.5,
       ARRAY['backend'], ARRAY['Moscow'], '{"senior":2}',
       ARRAY['delivery_capacity_pressure'], $4, $5, 'signal-episode-v2'
     ) RETURNING id::TEXT AS id`,
    [
      organizationId,
      episodeIdentity,
      episodeGeneration,
      evidenceHash,
      hash(nextCharacter(nextCharacter(nextCharacter(nextCharacter(suffix))))),
    ],
  )
  const episodeId = episode.rows[0].id
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
    [episodeId, organizationId, evidenceId],
  )
  return { episodeId, evidenceHash }
}

const insertThesisSql = `INSERT INTO commercial_theses (
    organization_id, signal_episode_id, signal_episode_generation,
    thesis_identity, thesis_generation,
    what_changed, why_it_matters, probable_hiring_problem,
    why_external_agency_may_be_needed, why_this_agency_fits, why_now,
    recommended_service, recommended_persona, recommended_angle, risks,
    limitations, evidence_hash, input_hash, engine_version
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6::JSONB, $6::JSONB, $6::JSONB, $6::JSONB, $6::JSONB, $6::JSONB,
    $6::JSONB, $6::JSONB, $6::JSONB, $6::JSONB, $6::JSONB,
    $7, $8, 'commercial-thesis-v1'
  )
  ON CONFLICT (organization_id, engine_version, input_hash) DO NOTHING
  RETURNING id::TEXT AS id`

try {
  const organizations = await database.query(
    `INSERT INTO orgs (name, domain)
     VALUES
       ('Commercial Thesis verifier', 'commercial-thesis.example.invalid'),
       ('Commercial Thesis other', 'commercial-thesis-other.example.invalid')
     RETURNING id::TEXT AS id, name`,
  )
  const organizationId = organizations.rows.find(
    (row) => row.name === 'Commercial Thesis verifier',
  ).id
  const otherOrganizationId = organizations.rows.find(
    (row) => row.name === 'Commercial Thesis other',
  ).id
  const evidence = await database.query(
    `INSERT INTO evidence_items (
       org_id, source, url, fetched_at, content_hash, tier
     ) VALUES
       ($1, 'career-pages', 'https://commercial-thesis.example.invalid/1', NOW(), $3, 'direct'),
       ($1, 'career-pages', 'https://commercial-thesis.example.invalid/2', NOW(), $4, 'direct'),
       ($2, 'career-pages', 'https://commercial-thesis-other.example.invalid/1', NOW(), $5, 'direct')
     RETURNING id::TEXT AS id, org_id::TEXT AS "organizationId"`,
    [organizationId, otherOrganizationId, hash('1'), hash('2'), hash('3')],
  )
  const ownEvidence = evidence.rows.filter(
    (row) => row.organizationId === organizationId,
  )
  const ownEvidenceId = ownEvidence[0].id
  const unlinkedOwnEvidenceId = ownEvidence[1].id
  const foreignEvidenceId = evidence.rows.find(
    (row) => row.organizationId === otherOrganizationId,
  ).id
  const thesisIdentity = hash('4')
  const firstEpisode = await seedEpisode({
    organizationId,
    evidenceId: ownEvidenceId,
    suffix: '5',
    episodeIdentity: hash('6'),
    episodeGeneration: 1,
  })
  const secondEpisode = await seedEpisode({
    organizationId,
    evidenceId: ownEvidenceId,
    suffix: 'a',
    episodeIdentity: hash('6'),
    episodeGeneration: 2,
  })
  const foreignEpisode = await seedEpisode({
    organizationId: otherOrganizationId,
    evidenceId: foreignEvidenceId,
    suffix: 'f',
    episodeIdentity: hash('e'),
    episodeGeneration: 1,
  })
  const section = JSON.stringify([{
    classification: 'confirmed_fact',
    code: 'vacancy_acceleration_observed',
    text: 'Hiring activity accelerated relative to baseline.',
    evidenceRefs: [ownEvidenceId],
  }])

  await database.query('BEGIN')
  const inserted = await database.query(insertThesisSql, [
    organizationId,
    firstEpisode.episodeId,
    1,
    thesisIdentity,
    1,
    section,
    firstEpisode.evidenceHash,
    hash('7'),
  ])
  assert.equal(inserted.rowCount, 1)
  const thesisId = inserted.rows[0].id
  await database.query(
    `INSERT INTO commercial_thesis_evidence (
       commercial_thesis_id, organization_id, evidence_id
     ) VALUES ($1, $2, $3)`,
    [thesisId, organizationId, ownEvidenceId],
  )
  await database.query('COMMIT')

  const replay = await database.query(insertThesisSql, [
    organizationId,
    firstEpisode.episodeId,
    1,
    thesisIdentity,
    1,
    section,
    firstEpisode.evidenceHash,
    hash('7'),
  ])
  assert.equal(replay.rowCount, 0)

  await database.query('BEGIN')
  const next = await database.query(insertThesisSql, [
    organizationId,
    secondEpisode.episodeId,
    2,
    thesisIdentity,
    2,
    section,
    secondEpisode.evidenceHash,
    hash('8'),
  ])
  assert.equal(next.rowCount, 1)
  await database.query(
    `INSERT INTO commercial_thesis_evidence (
       commercial_thesis_id, organization_id, evidence_id
     ) VALUES ($1, $2, $3)`,
    [next.rows[0].id, organizationId, ownEvidenceId],
  )
  await database.query('COMMIT')

  await assert.rejects(
    database.query(insertThesisSql, [
      organizationId,
      foreignEpisode.episodeId,
      1,
      hash('9'),
      1,
      section,
      foreignEpisode.evidenceHash,
      hash('b'),
    ]),
    (error) => ['23503', '23514'].includes(error?.code),
  )
  await assert.rejects(
    database.query(insertThesisSql, [
      organizationId,
      firstEpisode.episodeId,
      1,
      hash('9'),
      1,
      section,
      hash('c'),
      hash('d'),
    ]),
    (error) => error?.code === '23514',
  )
  const invalidSection = JSON.stringify([{
    classification: 'llm_fact',
    code: 'invented_fact',
    text: 'Invented.',
    evidenceRefs: [],
  }])
  await assert.rejects(
    database.query(insertThesisSql, [
      organizationId,
      firstEpisode.episodeId,
      1,
      hash('9'),
      1,
      invalidSection,
      firstEpisode.evidenceHash,
      hash('e'),
    ]),
    (error) => error?.code === '23514',
  )

  await database.query('BEGIN')
  await database.query(insertThesisSql, [
    organizationId,
    firstEpisode.episodeId,
    1,
    hash('9'),
    1,
    section,
    firstEpisode.evidenceHash,
    hash('f'),
  ])
  await assert.rejects(database.query('COMMIT'), (error) => error?.code === '23514')
  await database.query('ROLLBACK')

  await assert.rejects(
    database.query(
      `INSERT INTO commercial_thesis_evidence (
         commercial_thesis_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [thesisId, organizationId, unlinkedOwnEvidenceId],
    ),
    (error) => error?.code === '23514',
  )
  await assert.rejects(
    database.query(
      `INSERT INTO commercial_thesis_evidence (
         commercial_thesis_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [thesisId, organizationId, foreignEvidenceId],
    ),
    (error) => ['23503', '23514'].includes(error?.code),
  )
  await assert.rejects(
    database.query(
      'UPDATE commercial_theses SET engine_version = $2 WHERE id = $1',
      [thesisId, 'changed'],
    ),
    (error) => error?.code === '55000',
  )
  await assert.rejects(
    database.query(
      'DELETE FROM commercial_thesis_evidence WHERE commercial_thesis_id = $1',
      [thesisId],
    ),
    (error) => error?.code === '55000',
  )
  await assert.rejects(database.query(downSql), (error) => error?.code === 'P0001')
  await database.query('ROLLBACK')

  await database.query('TRUNCATE TABLE commercial_theses CASCADE')
  await database.query(externalAgencyPropensityDownSql)
  await database.query(downSql)
  const removed = await database.query(
    `SELECT
       TO_REGCLASS('public.commercial_theses') AS theses,
       TO_REGCLASS('public.commercial_thesis_evidence') AS evidence`,
  )
  assert.deepEqual(removed.rows[0], { theses: null, evidence: null })

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'thesis_replay_idempotent',
      'thesis_generation_append_only',
      'source_episode_tenant_scope_guarded',
      'source_evidence_hash_guarded',
      'statement_classification_guarded',
      'linked_evidence_required',
      'evidence_tenant_scope_guarded',
      'evidence_must_come_from_signal_episode',
      'thesis_append_only',
      'rollback_refuses_data_loss',
      'rollback_removes_empty_schema',
    ],
  }))
} finally {
  await database.end()
}

function nextCharacter(character) {
  return ((Number.parseInt(character, 16) + 1) % 16).toString(16)
}
