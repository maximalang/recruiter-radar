import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
if (process.env.QUERY_PLANNER_V2_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing schema verification without QUERY_PLANNER_V2_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const migrations = resolve(import.meta.dirname, '..', 'migrations')
const downSql = await readFile(
  resolve(migrations, '20260804160000_add_query_planner_v2.down.sql'),
  'utf8',
)

try {
  const relations = await database.query(
    `SELECT
       TO_REGCLASS('public.query_plan_snapshots')::TEXT AS plans,
       TO_REGCLASS('public.query_plan_shared_requests')::TEXT AS requests,
       TO_REGCLASS('public.query_plan_request_consumers')::TEXT AS consumers,
       TO_REGCLASS('public.query_plan_metric_snapshots')::TEXT AS metrics,
       TO_REGCLASS('public.opportunity_candidates')::TEXT AS candidates`,
  )
  assert.deepEqual(relations.rows[0], {
    plans: 'query_plan_snapshots',
    requests: 'query_plan_shared_requests',
    consumers: 'query_plan_request_consumers',
    metrics: 'query_plan_metric_snapshots',
    candidates: 'opportunity_candidates',
  })

  const constraints = await database.query(
    `SELECT conname
     FROM pg_constraint
     WHERE conrelid IN (
       'query_plan_snapshots'::REGCLASS,
       'query_plan_shared_requests'::REGCLASS,
       'query_plan_request_consumers'::REGCLASS,
       'query_plan_metric_snapshots'::REGCLASS
     )`,
  )
  const names = new Set(constraints.rows.map((row) => row.conname))
  for (const name of [
    'query_plan_snapshots_profile_scope_fkey',
    'query_plan_snapshots_identity_generation_unique',
    'query_plan_snapshots_input_unique',
    'query_plan_shared_requests_unique',
    'query_plan_request_consumers_plan_scope_fkey',
    'query_plan_request_consumers_profile_unique',
    'query_plan_metric_snapshots_plan_scope_fkey',
    'query_plan_metric_snapshots_input_unique',
  ]) {
    assert.ok(names.has(name), `missing constraint ${name}`)
  }

  const triggers = await database.query(
    `SELECT tgname
     FROM pg_trigger
     WHERE tgrelid IN (
       'query_plan_snapshots'::REGCLASS,
       'query_plan_shared_requests'::REGCLASS,
       'query_plan_request_consumers'::REGCLASS,
       'query_plan_metric_snapshots'::REGCLASS
     ) AND NOT tgisinternal`,
  )
  const triggerNames = new Set(triggers.rows.map((row) => row.tgname))
  for (const name of [
    'query_plan_snapshots_validate_generation',
    'query_plan_snapshots_validate_profile',
    'query_plan_request_consumers_validate_request',
    'query_plan_snapshots_immutable',
    'query_plan_shared_requests_immutable',
    'query_plan_request_consumers_immutable',
    'query_plan_metric_snapshots_immutable',
  ]) {
    assert.ok(triggerNames.has(name), `missing trigger ${name}`)
  }

  await database.query(downSql)
  const removed = await database.query(
    `SELECT
       TO_REGCLASS('public.query_plan_snapshots') AS plans,
       TO_REGCLASS('public.query_plan_shared_requests') AS requests,
       TO_REGCLASS('public.opportunity_candidates')::TEXT AS candidates`,
  )
  assert.deepEqual(removed.rows[0], {
    plans: null,
    requests: null,
    candidates: 'opportunity_candidates',
  })

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'profile_scope_constraints_present',
      'shared_request_consumer_boundary_present',
      'append_only_triggers_present',
      'rollback_preserves_opportunity_candidates_parent',
    ],
  }))
} finally {
  await database.end()
}
