import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
if (process.env.COMPANY_STATE_V1_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing to write fixtures without COMPANY_STATE_V1_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const migrations = resolve(import.meta.dirname, '..', 'migrations')
const downSql = await readFile(
  resolve(migrations, '20260804100000_add_company_state_v1.down.sql'),
  'utf8',
)
const signalEpisodesDownSql = await readFile(
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
const agencyDnaMatchDownSql = await readFile(
  resolve(migrations, '20260804140000_add_agency_dna_match_v2.down.sql'),
  'utf8',
)
const hash = (character) => character.repeat(64)

try {
  const organizations = await database.query(
    `INSERT INTO orgs (name, domain)
     VALUES
       ('Company State verifier', 'company-state.example.invalid'),
       ('Company State other', 'company-state-other.example.invalid')
     RETURNING id::TEXT AS id, name`,
  )
  const organizationId = organizations.rows.find(
    (row) => row.name === 'Company State verifier',
  ).id
  const otherOrganizationId = organizations.rows.find(
    (row) => row.name === 'Company State other',
  ).id

  const evidence = await database.query(
    `INSERT INTO evidence_items (
       org_id, source, url, fetched_at, content_hash, tier
     )
     VALUES
       ($1, 'career-pages', 'https://company-state.example.invalid/1',
        NOW(), $3, 'direct'),
       ($1, 'career-pages', 'https://company-state.example.invalid/2',
        NOW(), $4, 'direct'),
       ($2, 'career-pages', 'https://company-state-other.example.invalid/1',
        NOW(), $5, 'direct')
     RETURNING id::TEXT AS id, org_id::TEXT AS "organizationId"`,
    [organizationId, otherOrganizationId, hash('a'), hash('b'), hash('c')],
  )
  const ownEvidenceId = evidence.rows.find(
    (row) => row.organizationId === organizationId,
  ).id
  const unlinkedOwnEvidenceId = evidence.rows.find(
    (row) => row.organizationId === organizationId && row.id !== ownEvidenceId,
  ).id
  const foreignEvidenceId = evidence.rows.find(
    (row) => row.organizationId === otherOrganizationId,
  ).id

  const event = await database.query(
    `INSERT INTO company_events (
       organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
       source_family, source_record_id, evidence_ids, event_fingerprint,
       confidence, payload, normalizer_version
     )
     VALUES (
       $1, 'job_posting', '2026-07-01T09:00:00.000Z',
       '2026-07-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z',
       'career-pages', 'state-event-1', ARRAY[$2]::BIGINT[], $3, 0.9,
       '{"title":"Backend engineer","region":"Moscow"}',
       'company-event-normalizer-v1'
     )
     RETURNING id::TEXT AS id`,
    [organizationId, ownEvidenceId, hash('d')],
  )
  const companyEventId = event.rows[0].id
  await database.query(
    `INSERT INTO company_event_evidence (
       company_event_id, organization_id, evidence_id
     ) VALUES ($1, $2, $3)`,
    [companyEventId, organizationId, ownEvidenceId],
  )
  const otherEvent = await database.query(
    `INSERT INTO company_events (
       organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
       source_family, source_record_id, evidence_ids, event_fingerprint,
       confidence, payload, normalizer_version
     )
     VALUES (
       $1, 'job_posting', '2026-07-02T09:00:00.000Z',
       '2026-07-02T09:00:00.000Z', '2026-07-02T09:00:00.000Z',
       'career-pages', 'other-state-event-1', ARRAY[$2]::BIGINT[], $3, 0.9,
       '{"title":"Other engineer","region":"Kazan"}',
       'company-event-normalizer-v1'
     )
     RETURNING id::TEXT AS id`,
    [otherOrganizationId, foreignEvidenceId, hash('2')],
  )
  const otherCompanyEventId = otherEvent.rows[0].id
  await database.query(
    `INSERT INTO company_event_evidence (
       company_event_id, organization_id, evidence_id
     ) VALUES ($1, $2, $3)`,
    [otherCompanyEventId, otherOrganizationId, foreignEvidenceId],
  )

  const snapshotValues = [
    organizationId,
    '2026-08-04T12:00:00.000Z',
    '2026-07-01T09:00:00.000Z',
    '2026-07-01T09:00:00.000Z',
    JSON.stringify({
      vacancies7d: 1,
      vacancies14d: 1,
      vacancies30d: 1,
      medianHiringVelocityPer7d: 1,
      historyEventCount: 1,
      historyCoverageDays: 34,
      historicalPeriodCount: 1,
      sufficientHistory: false,
      fallbackReason: 'insufficient_history',
    }),
    JSON.stringify({
      vacancies7d: 0,
      vacancies14d: 0,
      vacancies30d: 0,
      baselineDeviation14d: null,
      direction: 'unknown',
    }),
    JSON.stringify({ current: {}, baseline: { backend: 1 } }),
    JSON.stringify({ current: {}, baseline: { unspecified: 1 } }),
    JSON.stringify({ current: {}, baseline: { Moscow: 1 }, newRegions: [] }),
    JSON.stringify({ observedCount: 1, medianDays: 0 }),
    JSON.stringify({ supported: false, observedCount: 1, repostCount: 0, rate: null }),
    JSON.stringify({ currentRecruiterVacancies: 0, baselineRecruiterVacancies: 0 }),
    JSON.stringify({ current30d: {} }),
    'insufficient_history',
    0.2,
    'company-state-v1',
    hash('e'),
    hash('f'),
  ]
  const insertSnapshotSql = `INSERT INTO company_state_snapshots (
      organization_id, snapshot_at, observation_started_at,
      observation_ended_at, hiring_baseline, current_hiring_velocity,
      role_distribution, seniority_distribution, region_distribution,
      vacancy_lifetime, repost_rate, recruiting_capacity_signals,
      business_change_signals, state_classification, state_confidence,
      feature_version, evidence_hash, input_hash
    ) VALUES (
      $1, $2, $3, $4, $5::JSONB, $6::JSONB, $7::JSONB, $8::JSONB,
      $9::JSONB, $10::JSONB, $11::JSONB, $12::JSONB, $13::JSONB,
      $14, $15, $16, $17, $18
    )
    ON CONFLICT (organization_id, feature_version, input_hash) DO NOTHING
    RETURNING id::TEXT AS id`
  const snapshot = await database.query(insertSnapshotSql, snapshotValues)
  assert.equal(snapshot.rowCount, 1)
  const snapshotId = snapshot.rows[0].id
  const replay = await database.query(insertSnapshotSql, snapshotValues)
  assert.equal(replay.rowCount, 0)

  await database.query(
    `INSERT INTO company_state_snapshot_events (
       snapshot_id, organization_id, company_event_id
     ) VALUES ($1, $2, $3)`,
    [snapshotId, organizationId, companyEventId],
  )
  await database.query(
    `INSERT INTO company_state_snapshot_evidence (
       snapshot_id, organization_id, evidence_id
     ) VALUES ($1, $2, $3)`,
    [snapshotId, organizationId, ownEvidenceId],
  )

  await assert.rejects(
    database.query(
      `INSERT INTO company_state_snapshot_events (
         snapshot_id, organization_id, company_event_id
       ) VALUES ($1, $2, $3)`,
      [snapshotId, organizationId, otherCompanyEventId],
    ),
    (error) => error?.code === '23503',
  )
  await assert.rejects(
    database.query(
      `INSERT INTO company_state_snapshot_evidence (
         snapshot_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [snapshotId, organizationId, foreignEvidenceId],
    ),
    (error) => error?.code === '23503',
  )
  await assert.rejects(
    database.query(
      `INSERT INTO company_state_snapshot_evidence (
         snapshot_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [snapshotId, organizationId, unlinkedOwnEvidenceId],
    ),
    (error) => error?.code === '23503',
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
    [snapshotId, organizationId, hash('e'), hash('1')],
  )
  const changeId = change.rows[0].id
  await database.query(
    `INSERT INTO company_state_change_events (
       change_id, organization_id, company_event_id
     ) VALUES ($1, $2, $3)`,
    [changeId, organizationId, companyEventId],
  )
  await database.query(
    `INSERT INTO company_state_change_evidence (
       change_id, organization_id, evidence_id
     ) VALUES ($1, $2, $3)`,
    [changeId, organizationId, ownEvidenceId],
  )

  await assert.rejects(
    database.query(
      'UPDATE company_state_snapshots SET state_confidence = 0.9 WHERE id = $1',
      [snapshotId],
    ),
    (error) => error?.code === 'P0001',
  )
  await assert.rejects(
    database.query('DELETE FROM company_state_changes WHERE id = $1', [changeId]),
    (error) => error?.code === 'P0001',
  )
  await assert.rejects(database.query(downSql), (error) => error?.code === 'P0001')
  await database.query('ROLLBACK')

  await database.query('TRUNCATE TABLE company_state_snapshots CASCADE')
  await database.query(agencyDnaMatchDownSql)
  await database.query(externalAgencyPropensityDownSql)
  await database.query(commercialThesesDownSql)
  await database.query(signalEpisodesDownSql)
  await database.query(downSql)
  const removed = await database.query(
    `SELECT
       TO_REGCLASS('public.company_state_snapshots') AS snapshots,
       TO_REGCLASS('public.company_state_changes') AS changes`,
  )
  assert.deepEqual(removed.rows[0], { snapshots: null, changes: null })

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'snapshot_replay_idempotent',
      'event_tenant_scope_guarded',
      'evidence_tenant_scope_guarded',
      'evidence_must_come_from_linked_event',
      'snapshot_append_only',
      'change_append_only',
      'rollback_refuses_data_loss',
      'rollback_removes_empty_schema',
    ],
  }))
} finally {
  await database.end()
}
