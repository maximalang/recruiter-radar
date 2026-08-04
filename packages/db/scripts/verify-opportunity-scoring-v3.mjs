import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
if (process.env.OPPORTUNITY_SCORING_V3_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing schema verification without ' +
    'OPPORTUNITY_SCORING_V3_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const migrations = resolve(import.meta.dirname, '..', 'migrations')
const downSql = await readFile(
  resolve(migrations, '20260804150000_add_opportunity_candidates_v3.down.sql'),
  'utf8',
)
const queryPlannerV2DownSql = await readFile(
  resolve(migrations, '20260804160000_add_query_planner_v2.down.sql'),
  'utf8',
)

try {
  const relations = await database.query(
    `SELECT
       TO_REGCLASS('public.opportunity_candidates')::TEXT AS candidates,
       TO_REGCLASS('public.opportunity_candidate_evidence')::TEXT AS evidence,
       TO_REGCLASS('public.agency_dna_match_snapshots')::TEXT AS match`,
  )
  assert.deepEqual(relations.rows[0], {
    candidates: 'opportunity_candidates',
    evidence: 'opportunity_candidate_evidence',
    match: 'agency_dna_match_snapshots',
  })

  const constraints = await database.query(
    `SELECT conname
     FROM pg_constraint
     WHERE conrelid IN (
       'opportunity_candidates'::REGCLASS,
       'opportunity_candidate_evidence'::REGCLASS
     )`,
  )
  const constraintNames = new Set(constraints.rows.map((row) => row.conname))
  for (const name of [
    'opportunity_candidates_profile_scope_fkey',
    'opportunity_candidates_match_scope_fkey',
    'opportunity_candidates_propensity_scope_fkey',
    'opportunity_candidates_thesis_fkey',
    'opportunity_candidates_episode_fkey',
    'opportunity_candidates_state_fkey',
    'opportunity_candidates_identity_generation_unique',
    'opportunity_candidates_input_unique',
    'opportunity_candidate_evidence_item_fkey',
  ]) {
    assert.ok(constraintNames.has(name), `missing constraint ${name}`)
  }

  const triggers = await database.query(
    `SELECT tgname, pg_get_triggerdef(oid) AS definition
     FROM pg_trigger
     WHERE tgrelid IN (
       'opportunity_candidates'::REGCLASS,
       'opportunity_candidate_evidence'::REGCLASS
     ) AND NOT tgisinternal`,
  )
  const definitions = new Map(
    triggers.rows.map((row) => [row.tgname, row.definition]),
  )
  assert.match(
    definitions.get('opportunity_candidate_requires_evidence') ?? '',
    /DEFERRABLE INITIALLY DEFERRED/,
  )
  for (const name of [
    'opportunity_candidate_validate_generation',
    'opportunity_candidate_validate_source',
    'opportunity_candidate_validate_evidence',
    'opportunity_candidates_immutable',
    'opportunity_candidate_evidence_immutable',
  ]) {
    assert.ok(definitions.has(name), `missing trigger ${name}`)
  }

  await database.query(queryPlannerV2DownSql)
  await database.query(downSql)
  const removed = await database.query(
    `SELECT
       TO_REGCLASS('public.opportunity_candidates') AS candidates,
       TO_REGCLASS('public.opportunity_candidate_evidence') AS evidence,
       TO_REGCLASS('public.agency_dna_match_snapshots')::TEXT AS match`,
  )
  assert.deepEqual(removed.rows[0], {
    candidates: null,
    evidence: null,
    match: 'agency_dna_match_snapshots',
  })

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'tenant_lineage_constraints_present',
      'append_only_triggers_present',
      'deferred_evidence_trigger_present',
      'rollback_preserves_agency_match_parent',
    ],
  }))
} finally {
  await database.end()
}
