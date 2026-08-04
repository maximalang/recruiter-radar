import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
if (process.env.EXTERNAL_AGENCY_PROPENSITY_V1_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing schema verification without ' +
    'EXTERNAL_AGENCY_PROPENSITY_V1_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const migrations = resolve(import.meta.dirname, '..', 'migrations')
const downSql = await readFile(
  resolve(migrations, '20260804130000_add_external_agency_propensity_v1.down.sql'),
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

try {
  const relations = await database.query(
    `SELECT
       TO_REGCLASS('public.external_agency_propensity_snapshots')::TEXT
         AS snapshots,
       TO_REGCLASS('public.external_agency_propensity_evidence')::TEXT
         AS evidence`,
  )
  assert.deepEqual(relations.rows[0], {
    snapshots: 'external_agency_propensity_snapshots',
    evidence: 'external_agency_propensity_evidence',
  })

  const constraints = await database.query(
    `SELECT conname, contype
     FROM pg_constraint
     WHERE conrelid IN (
       'external_agency_propensity_snapshots'::REGCLASS,
       'external_agency_propensity_evidence'::REGCLASS
     )`,
  )
  const constraintNames = new Set(constraints.rows.map((row) => row.conname))
  for (const name of [
    'external_agency_propensity_profile_scope_fkey',
    'external_agency_propensity_thesis_fkey',
    'external_agency_propensity_evidence_item_fkey',
    'external_agency_propensity_identity_generation_unique',
    'external_agency_propensity_input_unique',
    'external_agency_propensity_positive_reasons_check',
    'external_agency_propensity_negative_reasons_check',
  ]) {
    assert.ok(constraintNames.has(name), `missing constraint ${name}`)
  }

  const triggers = await database.query(
    `SELECT tgname, pg_get_triggerdef(oid) AS definition
     FROM pg_trigger
     WHERE tgrelid IN (
       'external_agency_propensity_snapshots'::REGCLASS,
       'external_agency_propensity_evidence'::REGCLASS
     )
       AND NOT tgisinternal`,
  )
  const triggerDefinitions = new Map(
    triggers.rows.map((row) => [row.tgname, row.definition]),
  )
  assert.match(
    triggerDefinitions.get('external_agency_propensity_requires_evidence') ?? '',
    /DEFERRABLE INITIALLY DEFERRED/,
  )
  for (const name of [
    'external_agency_propensity_validate_source',
    'external_agency_propensity_validate_evidence',
    'external_agency_propensity_immutable',
    'external_agency_propensity_evidence_immutable',
  ]) {
    assert.ok(triggerDefinitions.has(name), `missing trigger ${name}`)
  }

  const childSchema = await database.query(
    `SELECT TO_REGCLASS('public.agency_dna_match_snapshots')::TEXT AS snapshots`,
  )
  if (childSchema.rows[0]?.snapshots) {
    await database.query(opportunityScoringV3DownSql)
    await database.query(agencyDnaMatchDownSql)
  }
  await database.query(downSql)
  const removed = await database.query(
    `SELECT
       TO_REGCLASS('public.external_agency_propensity_snapshots') AS snapshots,
       TO_REGCLASS('public.external_agency_propensity_evidence') AS evidence`,
  )
  assert.deepEqual(removed.rows[0], { snapshots: null, evidence: null })

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'tenant_source_constraints_present',
      'append_only_triggers_present',
      'deferred_evidence_trigger_present',
      'rollback_removes_empty_schema',
    ],
  }))
} finally {
  await database.end()
}
