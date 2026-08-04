import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
if (process.env.AGENCY_DNA_MATCH_V2_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing schema verification without ' +
    'AGENCY_DNA_MATCH_V2_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const migrations = resolve(import.meta.dirname, '..', 'migrations')
const downSql = await readFile(
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
       TO_REGCLASS('public.agency_dna_match_snapshots')::TEXT AS snapshots,
       TO_REGCLASS('public.agency_dna_match_evidence')::TEXT AS evidence,
       TO_REGCLASS('public.external_agency_propensity_snapshots')::TEXT
         AS propensity`,
  )
  assert.deepEqual(relations.rows[0], {
    snapshots: 'agency_dna_match_snapshots',
    evidence: 'agency_dna_match_evidence',
    propensity: 'external_agency_propensity_snapshots',
  })

  const profileColumns = await database.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'client_profiles'
       AND column_name IN (
         'technology_qualification_tags', 'preferred_regions',
         'minimum_fee_minor', 'average_fee_minor',
         'minimum_opportunity_value_minor', 'undesirable_hiring_types'
       )`,
  )
  assert.equal(profileColumns.rowCount, 6)
  const fullSnapshot = await database.query(
    `SELECT TO_REGPROCEDURE(
       'public.agency_dna_full_snapshot(client_profiles)'
     )::TEXT AS function_name`,
  )
  assert.equal(
    fullSnapshot.rows[0]?.function_name,
    'agency_dna_full_snapshot(client_profiles)',
  )

  const constraints = await database.query(
    `SELECT conname
     FROM pg_constraint
     WHERE conrelid IN (
       'agency_dna_match_snapshots'::REGCLASS,
       'agency_dna_match_evidence'::REGCLASS
     )`,
  )
  const constraintNames = new Set(constraints.rows.map((row) => row.conname))
  for (const name of [
    'agency_dna_match_profile_scope_fkey',
    'agency_dna_match_propensity_fkey',
    'agency_dna_match_evidence_item_fkey',
    'agency_dna_match_identity_generation_unique',
    'agency_dna_match_input_unique',
    'agency_dna_match_dimensions_check',
    'agency_dna_match_reasons_check',
    'agency_dna_match_modes_check',
    'agency_dna_match_selection_policy_check',
  ]) {
    assert.ok(constraintNames.has(name), `missing constraint ${name}`)
  }

  const triggers = await database.query(
    `SELECT tgname, pg_get_triggerdef(oid) AS definition
     FROM pg_trigger
     WHERE tgrelid IN (
       'agency_dna_match_snapshots'::REGCLASS,
       'agency_dna_match_evidence'::REGCLASS
     ) AND NOT tgisinternal`,
  )
  const definitions = new Map(
    triggers.rows.map((row) => [row.tgname, row.definition]),
  )
  assert.match(
    definitions.get('agency_dna_match_requires_evidence') ?? '',
    /DEFERRABLE INITIALLY DEFERRED/,
  )
  for (const name of [
    'agency_dna_match_validate_source',
    'agency_dna_match_validate_evidence',
    'agency_dna_match_immutable',
    'agency_dna_match_evidence_immutable',
  ]) {
    assert.ok(definitions.has(name), `missing trigger ${name}`)
  }

  await database.query(opportunityScoringV3DownSql)
  await database.query(downSql)
  const removed = await database.query(
    `SELECT
       TO_REGCLASS('public.agency_dna_match_snapshots') AS snapshots,
       TO_REGCLASS('public.agency_dna_match_evidence') AS evidence,
       TO_REGCLASS('public.external_agency_propensity_snapshots')::TEXT
         AS propensity,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'client_profiles'
           AND column_name = 'technology_qualification_tags'
       ) AS profile_extension`,
  )
  assert.deepEqual(removed.rows[0], {
    snapshots: null,
    evidence: null,
    propensity: 'external_agency_propensity_snapshots',
    profile_extension: false,
  })

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'profile_dimensions_versioned',
      'tenant_propensity_constraints_present',
      'append_only_triggers_present',
      'deferred_evidence_trigger_present',
      'rollback_preserves_parent_schema',
    ],
  }))
} finally {
  await database.end()
}
