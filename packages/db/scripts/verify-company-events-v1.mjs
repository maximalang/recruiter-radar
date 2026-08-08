import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

import {
  COMMERCIAL_SIGNAL_ISOLATED_TEST_CLEANUP_SQL,
} from './lib/commercial-signal-isolated-test-cleanup.mjs'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.')
}
if (process.env.COMPANY_EVENTS_V1_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing to write fixtures without COMPANY_EVENTS_V1_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const migrations = resolve(import.meta.dirname, '..', 'migrations')
const downSql = await readFile(
  resolve(migrations, '20260803120000_add_company_events_v1.down.sql'),
  'utf8',
)
const companyStateDownSql = await readFile(
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
const opportunityScoringV3DownSql = await readFile(
  resolve(migrations, '20260804150000_add_opportunity_candidates_v3.down.sql'),
  'utf8',
)
const queryPlannerV2DownSql = await readFile(
  resolve(migrations, '20260804160000_add_query_planner_v2.down.sql'),
  'utf8',
)
const commercialSignalDependentDownSql = await Promise.all([
  '20260807180500_complete_query_plan_supply_metrics.down.sql',
  '20260807175500_extend_commercial_signal_annotation_taxonomy.down.sql',
  '20260807174500_extend_query_plan_yield_metrics.down.sql',
  '20260807173600_enforce_company_event_publication_append_only.down.sql',
  '20260807173500_restore_immutable_company_event_publications.down.sql',
  '20260807173000_harden_company_event_and_enrichment_lineage.down.sql',
  '20260807170000_add_commercial_signal_canary_runtime.down.sql',
].map((filename) => readFile(resolve(migrations, filename), 'utf8')))
assert.ok(
  downSql.indexOf('LOCK TABLE company_events IN ACCESS EXCLUSIVE MODE') > -1 &&
  downSql.indexOf('LOCK TABLE company_events IN ACCESS EXCLUSIVE MODE') <
    downSql.indexOf('IF EXISTS (SELECT 1 FROM company_events)'),
  'rollback must lock company_events before checking for data',
)

const hash = (character) => character.repeat(64)

try {
  const organization = await database.query(
    `INSERT INTO orgs (name, domain)
     VALUES ('Company Events verifier', 'company-events.example.invalid')
     RETURNING id::TEXT AS id`,
  )
  const otherOrganization = await database.query(
    `INSERT INTO orgs (name, domain)
     VALUES ('Company Events other', 'company-events-other.example.invalid')
     RETURNING id::TEXT AS id`,
  )
  const organizationId = organization.rows[0].id
  const otherOrganizationId = otherOrganization.rows[0].id

  const signals = await database.query(
    `INSERT INTO signals (
       org_id, signal_type, source, external_id, headline, source_url,
       occurred_at, payload
     )
     VALUES
       ($1, 'job_posting', 'hh', 'hh-101', 'Senior Java developer',
        'https://hh.example.invalid/vacancy/101',
        '2026-08-02T09:00:00.000Z', '{"vacancy_name":"Senior Java developer"}'),
       ($1, 'job_posting', 'career-pages', 'career-77',
        'Senior Java developer',
        'https://company-events.example.invalid/career/java',
        '2026-08-02T09:00:00.000Z', '{"vacancy_name":"Senior Java developer"}')
     RETURNING id::TEXT AS id, source`,
    [organizationId],
  )
  const signalBySource = Object.fromEntries(
    signals.rows.map((row) => [row.source, row.id]),
  )

  const evidence = await database.query(
    `INSERT INTO evidence_items (
       org_id, source, url, fetched_at, content_hash, tier
     )
     VALUES
       ($1, 'hh', 'https://hh.example.invalid/vacancy/101', NOW(), $2, 'direct'),
       ($1, 'career-pages',
        'https://company-events.example.invalid/career/java', NOW(), $3,
        'direct'),
       ($4, 'career-pages',
        'https://company-events-other.example.invalid/career/java', NOW(), $5,
        'direct')
     RETURNING id::TEXT AS id, org_id::TEXT AS "organizationId"`,
    [organizationId, hash('a'), hash('b'), otherOrganizationId, hash('c')],
  )
  const ownEvidenceIds = evidence.rows
    .filter((row) => row.organizationId === organizationId)
    .map((row) => row.id)
  const foreignEvidenceId = evidence.rows.find(
    (row) => row.organizationId === otherOrganizationId,
  ).id

  await assert.rejects(
    database.query(
      `INSERT INTO company_events (
         organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
         source_family, source_record_id, evidence_ids, event_fingerprint,
         payload, normalizer_version
       )
       VALUES (
         $1, 'job_posting', '2026-08-02T09:00:00.000Z',
         '2026-08-02T09:05:00.000Z', '2026-08-02T10:00:00.000Z',
         'hh', $2, ARRAY[$3]::BIGINT[], $4, '{}'::JSONB,
         'company-event-normalizer-v1'
       )`,
      [organizationId, signalBySource.hh, foreignEvidenceId, hash('9')],
    ),
    (error) => error?.code === '23503',
  )

  const inserted = await database.query(
    `INSERT INTO company_events (
       organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
       source_family, source_record_id, evidence_ids, event_fingerprint,
       confidence, payload, normalizer_version
     )
     VALUES (
       $1, 'job_posting', '2026-08-02T09:00:00.000Z',
       '2026-08-02T09:05:00.000Z', '2026-08-02T10:00:00.000Z',
       'hh', $2, $3::BIGINT[], $4, NULL,
       '{"publicationCount":2,"sourceFamilies":["career-pages","hh"]}',
       'company-event-normalizer-v1'
     )
     ON CONFLICT (event_fingerprint) DO NOTHING
     RETURNING id::TEXT AS id`,
    [
      organizationId,
      signalBySource.hh,
      ownEvidenceIds,
      hash('d'),
    ],
  )
  assert.equal(inserted.rowCount, 1)
  const companyEventId = inserted.rows[0].id

  await assert.rejects(
    database.query(
      `INSERT INTO company_event_publications (
         company_event_id, organization_id, signal_id, source_family,
         source_record_id, occurred_at, first_seen_at, last_seen_at,
         evidence_ids, publication_fingerprint, source_snapshot
       )
       VALUES (
         $1, $2, $3::BIGINT, 'hh', ($3::BIGINT)::TEXT,
         '2026-08-02T09:00:00.000Z', '2026-08-02T09:05:00.000Z',
         '2026-08-02T10:00:00.000Z', ARRAY[$4]::BIGINT[], $5, '{}'::JSONB
       )`,
      [
        companyEventId,
        organizationId,
        signalBySource.hh,
        foreignEvidenceId,
        hash('8'),
      ],
    ),
    (error) => error?.code === '23503',
  )

  const replay = await database.query(
    `INSERT INTO company_events (
       organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
       source_family, source_record_id, evidence_ids, event_fingerprint,
       payload, normalizer_version
     )
     SELECT
       organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
       source_family, source_record_id, evidence_ids, event_fingerprint,
       payload, normalizer_version
     FROM company_events
     WHERE id = $1
     ON CONFLICT (event_fingerprint) DO NOTHING`,
    [companyEventId],
  )
  assert.equal(replay.rowCount, 0)

  for (const [index, source] of ['hh', 'career-pages'].entries()) {
    await database.query(
      `INSERT INTO company_event_publications (
         company_event_id, organization_id, signal_id, source_family,
         source_record_id, source_url, external_id, occurred_at, first_seen_at,
         last_seen_at, evidence_ids, publication_fingerprint, source_snapshot
       )
       VALUES (
         $1, $2, $3::BIGINT, $4, ($3::BIGINT)::TEXT,
         CASE WHEN $4 = 'hh'
           THEN 'https://hh.example.invalid/vacancy/101'
           ELSE 'https://company-events.example.invalid/career/java'
         END,
         CASE WHEN $4 = 'hh' THEN 'hh-101' ELSE 'career-77' END,
         '2026-08-02T09:00:00.000Z', '2026-08-02T09:05:00.000Z',
         '2026-08-02T10:00:00.000Z', ARRAY[$5]::BIGINT[], $6,
         '{"vacancy_name":"Senior Java developer"}'
       )
       ON CONFLICT (publication_fingerprint)
       DO NOTHING`,
      [
        companyEventId,
        organizationId,
        signalBySource[source],
        source,
        ownEvidenceIds[index],
        index === 0 ? hash('e') : hash('f'),
      ],
    )
  }

  for (const evidenceId of ownEvidenceIds) {
    await database.query(
      `INSERT INTO company_event_evidence (
         company_event_id, organization_id, evidence_id
       )
       VALUES ($1, $2, $3)
       ON CONFLICT (company_event_id, evidence_id) DO NOTHING`,
      [companyEventId, organizationId, evidenceId],
    )
  }

  const counts = await database.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER FROM company_events) AS events,
       (SELECT COUNT(*)::INTEGER FROM company_event_publications) AS publications,
       (SELECT COUNT(*)::INTEGER FROM company_event_evidence) AS evidence`,
  )
  assert.deepEqual(counts.rows[0], {
    events: 1,
    publications: 2,
    evidence: 2,
  })

  await assert.rejects(
    database.query(
      `INSERT INTO company_event_evidence (
         company_event_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [companyEventId, organizationId, foreignEvidenceId],
    ),
    (error) => error?.code === '23503',
  )

  await database.query(
    `UPDATE company_events
     SET last_seen_at = '2026-08-03T10:00:00.000Z', confidence = 0.8
     WHERE id = $1`,
    [companyEventId],
  )
  await assert.rejects(
    database.query(
      `UPDATE company_events
       SET payload = '{"publicationCount":999}'
       WHERE id = $1`,
      [companyEventId],
    ),
    (error) => error?.code === 'P0001',
  )
  await assert.rejects(
    database.query(
      `UPDATE company_events
       SET evidence_ids = ARRAY[$2]::BIGINT[]
       WHERE id = $1`,
      [companyEventId, ownEvidenceIds[0]],
    ),
    (error) => error?.code === 'P0001',
  )
  await assert.rejects(
    database.query(
      `DELETE FROM company_event_publications
       WHERE company_event_id = $1`,
      [companyEventId],
    ),
    (error) => error?.code === 'P0001',
  )

  await assert.rejects(
    database.query(downSql),
    (error) => error?.code === 'P0001',
  )
  await database.query('ROLLBACK')
  await database.query('TRUNCATE TABLE company_events CASCADE')
  for (const dependentDownSql of commercialSignalDependentDownSql) {
    await database.query(dependentDownSql)
  }
  await database.query(COMMERCIAL_SIGNAL_ISOLATED_TEST_CLEANUP_SQL)
  await database.query(queryPlannerV2DownSql)
  await database.query(opportunityScoringV3DownSql)
  await database.query(agencyDnaMatchDownSql)
  await database.query(externalAgencyPropensityDownSql)
  await database.query(commercialThesesDownSql)
  await database.query(signalEpisodesDownSql)
  await database.query(companyStateDownSql)
  await database.query(downSql)

  const removed = await database.query(
    `SELECT TO_REGCLASS('public.company_events') AS events,
            TO_REGCLASS('public.company_event_publications') AS publications,
            TO_REGCLASS('public.company_event_evidence') AS evidence,
            TO_REGCLASS('public.company_state_snapshots') AS "stateSnapshots",
            TO_REGCLASS('public.signals_company_events_job_posting_idx')
              AS "signalIndex",
            TO_REGCLASS('public.evidence_items_company_events_url_idx')
              AS "evidenceIndex"`,
  )
  assert.deepEqual(removed.rows[0], {
    events: null,
    publications: null,
    evidence: null,
    stateSnapshots: null,
    signalIndex: null,
    evidenceIndex: null,
  })

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'event_replay_idempotent',
      'cross_source_publications_preserved',
      'event_evidence_array_organization_guarded',
      'publication_evidence_array_organization_guarded',
      'evidence_organization_guarded',
      'event_core_immutable',
      'event_evidence_monotonic',
      'publication_append_only',
      'rollback_refuses_data_loss',
      'commercial_signal_dependents_roll_back_before_query_planner',
      'dependent_company_state_rolls_back_first',
      'rollback_locks_before_empty_check',
      'rollback_removes_schema_when_empty',
    ],
  }))
} finally {
  await database.end()
}
