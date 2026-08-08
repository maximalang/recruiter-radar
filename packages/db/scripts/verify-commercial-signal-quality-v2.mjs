import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
if (process.env.COMMERCIAL_SIGNAL_QUALITY_V2_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing schema verification without ' +
    'COMMERCIAL_SIGNAL_QUALITY_V2_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const migrations = resolve(import.meta.dirname, '..', 'migrations')
const downSql = await readFile(
  resolve(
    migrations,
    '20260809100000_add_commercial_signal_quality_v2.down.sql',
  ),
  'utf8',
)

try {
  const relations = await database.query(
    `SELECT
       TO_REGCLASS('public.commercial_signal_quality_snapshots')::TEXT
         AS snapshots,
       TO_REGCLASS('public.commercial_signal_quality_evidence')::TEXT
         AS evidence,
       TO_REGCLASS('public.opportunity_candidates')::TEXT AS candidates`,
  )
  assert.deepEqual(relations.rows[0], {
    snapshots: 'commercial_signal_quality_snapshots',
    evidence: 'commercial_signal_quality_evidence',
    candidates: 'opportunity_candidates',
  })

  const constraints = await database.query(
    `SELECT conname
     FROM pg_constraint
     WHERE conrelid IN (
       'commercial_signal_quality_snapshots'::REGCLASS,
       'commercial_signal_quality_evidence'::REGCLASS
     )`,
  )
  const constraintNames = new Set(constraints.rows.map((row) => row.conname))
  for (const name of [
    'commercial_signal_quality_snapshots_candidate_fkey',
    'commercial_signal_quality_snapshots_identity_generation_unique',
    'commercial_signal_quality_snapshots_input_unique',
    'commercial_signal_quality_snapshots_scores_check',
    'commercial_signal_quality_snapshots_model_check',
    'commercial_signal_quality_evidence_snapshot_fkey',
    'commercial_signal_quality_evidence_candidate_lineage_fkey',
    'commercial_signal_quality_evidence_item_fkey',
    'commercial_signal_quality_evidence_reason_check',
  ]) {
    assert.ok(constraintNames.has(name), `missing constraint ${name}`)
  }

  const triggers = await database.query(
    `SELECT tgname
     FROM pg_trigger
     WHERE tgrelid IN (
       'commercial_signal_quality_snapshots'::REGCLASS,
       'commercial_signal_quality_evidence'::REGCLASS
     ) AND NOT tgisinternal`,
  )
  const triggerNames = new Set(triggers.rows.map((row) => row.tgname))
  for (const name of [
    'commercial_signal_quality_snapshots_immutable',
    'commercial_signal_quality_evidence_immutable',
  ]) {
    assert.ok(triggerNames.has(name), `missing trigger ${name}`)
  }

  await database.query(downSql)
  const removed = await database.query(
    `SELECT
       TO_REGCLASS('public.commercial_signal_quality_snapshots') AS snapshots,
       TO_REGCLASS('public.commercial_signal_quality_evidence') AS evidence,
       TO_REGCLASS('public.opportunity_candidates')::TEXT AS candidates`,
  )
  assert.deepEqual(removed.rows[0], {
    snapshots: null,
    evidence: null,
    candidates: 'opportunity_candidates',
  })

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'tenant_lineage_constraints_present',
      'provenance_constraints_present',
      'append_only_triggers_present',
      'rollback_preserves_v3_candidates',
    ],
  }))
} finally {
  await database.end()
}
