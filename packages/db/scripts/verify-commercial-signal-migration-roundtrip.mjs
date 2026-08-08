import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')

const ROUNDTRIP_MIGRATIONS = [
  '20260807170000_add_commercial_signal_canary_runtime',
  '20260807173000_harden_company_event_and_enrichment_lineage',
  '20260807173500_restore_immutable_company_event_publications',
  '20260807173600_enforce_company_event_publication_append_only',
  '20260807174500_extend_query_plan_yield_metrics',
  '20260807175500_extend_commercial_signal_annotation_taxonomy',
  '20260807180500_complete_query_plan_supply_metrics',
]

const admin = new Client({ connectionString: databaseUrl })
const databaseName = `rr_commercial_signal_roundtrip_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`

await admin.connect()
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  await runMigrate()

  const database = new Client({ connectionString: temporaryUrl.toString() })
  await database.connect()
  try {
    await assertAllApplied(database)
    const rollbackFixture = await seedRollbackCompatibilityFixtures(database)

    for (const version of [...ROUNDTRIP_MIGRATIONS].reverse()) {
      const sql = await readFile(
        resolve(migrationsDir, `${version}.down.sql`),
        'utf8',
      )
      await database.query(sql)
      if (version === '20260807175500_extend_commercial_signal_annotation_taxonomy') {
        await assertAnnotationRollbackPreserved(
          database,
          rollbackFixture.annotationId,
        )
      }
      if (version === '20260807174500_extend_query_plan_yield_metrics' ||
          version === '20260807180500_complete_query_plan_supply_metrics') {
        await assertQueryPlanMetricRollbackPreserved(
          database,
          rollbackFixture.queryPlanMetricId,
        )
      }
      if (version === '20260807173000_harden_company_event_and_enrichment_lineage') {
        await assertEnrichmentEvidenceRollbackPreserved(
          database,
          rollbackFixture.enrichmentEvidenceId,
        )
        await assertQueryPlanMetricRollbackPreserved(
          database,
          rollbackFixture.queryPlanMetricId,
        )
      }
      if (version === '20260807170000_add_commercial_signal_canary_runtime') {
        await assertAnnotationRollbackPreserved(
          database,
          rollbackFixture.annotationId,
        )
        await assertOutcomeRollbackPreserved(
          database,
          rollbackFixture.outcomeEventId,
        )
        await assertEnrichmentEvidenceRollbackPreserved(
          database,
          rollbackFixture.enrichmentEvidenceId,
        )
      }
      const deleted = await database.query(
        'DELETE FROM schema_migrations WHERE version = $1',
        [version],
      )
      if (deleted.rowCount !== 1) {
        throw new Error(`Round-trip marker missing while rolling back ${version}.`)
      }
    }

    const remaining = await database.query(
      `SELECT version
       FROM schema_migrations
       WHERE version = ANY($1::TEXT[])
       ORDER BY version`,
      [ROUNDTRIP_MIGRATIONS],
    )
    if (remaining.rowCount !== 0) {
      throw new Error(
        `Commercial Signal rollback left migration markers: ${remaining.rows
          .map((row) => row.version).join(', ')}`,
      )
    }
  } finally {
    await database.end()
  }

  await runMigrate()

  const verified = new Client({ connectionString: temporaryUrl.toString() })
  await verified.connect()
  try {
    await assertAllApplied(verified)
    await assertForwardContractRestored(verified)
  } finally {
    await verified.end()
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    migrations: ROUNDTRIP_MIGRATIONS,
    checks: [
      'up_chain_applies',
      'down_chain_reverses_in_exact_reverse_order',
      'migration_markers_removed_on_down',
      'up_chain_reapplies_after_down',
      'publication_update_is_append_through',
      'publication_delete_is_rejected',
      'canonical_annotation_taxonomy_restored',
      'annotation_history_is_not_rewritten_on_taxonomy_down',
      'annotation_history_survives_runtime_down',
      'enrichment_evidence_survives_down_chain',
      'outcome_lineage_snapshot_survives_runtime_down',
      'query_plan_supply_metrics_survive_down_chain',
    ],
  })}\n`)
} finally {
  await admin.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [databaseName],
  ).catch(() => undefined)
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`)
    .catch(() => undefined)
  await admin.end()
}

async function runMigrate() {
  const { stdout, stderr } = await execFileAsync(process.execPath, [migrateScript], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: temporaryUrl.toString() },
    maxBuffer: 8 * 1024 * 1024,
  })
  if (stderr?.trim()) process.stderr.write(stderr)
  if (stdout?.trim()) process.stdout.write(stdout)
}

async function assertAllApplied(database) {
  const result = await database.query(
    `SELECT version
     FROM schema_migrations
     WHERE version = ANY($1::TEXT[])
     ORDER BY version`,
    [ROUNDTRIP_MIGRATIONS],
  )
  const actual = result.rows.map((row) => row.version)
  if (actual.length !== ROUNDTRIP_MIGRATIONS.length ||
      ROUNDTRIP_MIGRATIONS.some((version) => !actual.includes(version))) {
    throw new Error(
      `Commercial Signal migration chain incomplete: ${actual.join(', ')}`,
    )
  }
}

async function seedRollbackCompatibilityFixtures(database) {
  await database.query('SET session_replication_role = replica')
  try {
    const annotation = await database.query(
      `INSERT INTO commercial_signal_annotations (
         lineage_id, workspace_id, client_profile_id, reviewer_user_id,
         annotation_generation, label, reason_code, review_set, note
       )
       VALUES (
         9000001, 9000002, 9000003, 9000004,
         1, 'not_a_lead', 'weak_agency_fit', 'canary',
         'rollback preservation fixture'
       )
       RETURNING id::TEXT AS id`,
    )
    const outcome = await database.query(
      `INSERT INTO opportunity_outcome_events (
         owner_id, client_profile_id, opportunity_id, hiring_episode_id,
         organization_id, event_type, previous_stage, new_stage, reason_code,
         occurred_at, actor_type, metadata, analytics_snapshot,
         idempotency_key, payload_hash,
         commercial_signal_lineage_id, commercial_signal_candidate_id,
         commercial_signal_candidate_generation, commercial_signal_episode_id,
         commercial_signal_episode_generation,
         commercial_signal_query_plan_snapshot_ids,
         commercial_signal_score_snapshot
       )
       VALUES (
         9000001, 9000003, 9000005, 9000006,
         9000007, 'dismissed', 'new', 'dismissed', 'ordinary_hiring',
         NOW(), 'system', '{}'::JSONB, '{}'::JSONB,
         'commercial-signal-roundtrip-outcome', REPEAT('a', 64),
         9000001, 9000008, 3, 9000009, 2,
         ARRAY[9000010, 9000011]::BIGINT[],
         '{"qualityScore":0.82,"scoreVersion":"opportunity-v3"}'::JSONB
       )
       RETURNING id::TEXT AS id`,
    )
    const enrichmentEvidence = await database.query(
      `INSERT INTO commercial_signal_enrichment_evidence (
         lineage_id, evidence_id, workspace_id, client_profile_id,
         organization_id, surface_type
       )
       VALUES (
         9000001, 9000012, 9000002, 9000003,
         9000007, 'corporate_contact_page'
       )
       RETURNING evidence_id::TEXT AS id`,
    )
    const queryPlanMetric = await database.query(
      `INSERT INTO query_plan_metric_snapshots (
         plan_snapshot_id, workspace_id, client_profile_id, metric_version,
         measurement_window_start, measurement_window_end,
         execution_count, zero_result_executions, input_hash,
         new_company_events, actionable_opportunities, won_opportunities,
         qualified_episodes, stale_opportunities, stale_rate
       )
       VALUES (
         9000013, 9000002, 9000003, 'query-plan-yield-v2',
         NOW() - INTERVAL '1 day', NOW(),
         1, 0, REPEAT('b', 64),
         11, 7, 2, 9, 3, 0.3333333
       )
       RETURNING id::TEXT AS id`,
    )
    return {
      annotationId: annotation.rows[0].id,
      outcomeEventId: outcome.rows[0].id,
      enrichmentEvidenceId: enrichmentEvidence.rows[0].id,
      queryPlanMetricId: queryPlanMetric.rows[0].id,
    }
  } finally {
    await database.query('SET session_replication_role = origin')
  }
}

async function assertAnnotationRollbackPreserved(database, annotationId) {
  const result = await database.query(
    `SELECT reason_code, note
     FROM commercial_signal_annotations
     WHERE id = $1`,
    [annotationId],
  )
  const row = result.rows[0]
  if (row?.reason_code !== 'weak_agency_fit' ||
      row?.note !== 'rollback preservation fixture') {
    throw new Error('Annotation history changed during taxonomy rollback.')
  }
}

async function assertEnrichmentEvidenceRollbackPreserved(
  database,
  evidenceId,
) {
  const result = await database.query(
    `SELECT surface_type
     FROM commercial_signal_enrichment_evidence
     WHERE evidence_id = $1`,
    [evidenceId],
  )
  if (result.rows[0]?.surface_type !== 'corporate_contact_page') {
    throw new Error('Enrichment evidence changed during rollback.')
  }
}

async function assertOutcomeRollbackPreserved(database, outcomeEventId) {
  const result = await database.query(
    `SELECT
       reason_code,
       commercial_signal_lineage_id::TEXT AS lineage_id,
       commercial_signal_candidate_id::TEXT AS candidate_id,
       commercial_signal_candidate_generation AS candidate_generation,
       commercial_signal_episode_id::TEXT AS episode_id,
       commercial_signal_episode_generation AS episode_generation,
       commercial_signal_query_plan_snapshot_ids AS query_plan_snapshot_ids,
       commercial_signal_score_snapshot AS score_snapshot
     FROM opportunity_outcome_events
     WHERE id = $1`,
    [outcomeEventId],
  )
  const row = result.rows[0]
  if (row?.reason_code !== 'ordinary_hiring' ||
      row?.lineage_id !== '9000001' || row?.candidate_id !== '9000008' ||
      row?.candidate_generation !== 3 || row?.episode_id !== '9000009' ||
      row?.episode_generation !== 2 ||
      row?.query_plan_snapshot_ids?.map(String).join(',') !==
        '9000010,9000011' ||
      row?.score_snapshot?.qualityScore !== 0.82 ||
      row?.score_snapshot?.scoreVersion !== 'opportunity-v3') {
    throw new Error('Outcome lineage snapshot changed during Commercial Signal rollback.')
  }
}

async function assertQueryPlanMetricRollbackPreserved(database, metricId) {
  const result = await database.query(
    `SELECT
       new_company_events::TEXT AS new_company_events,
       actionable_opportunities::TEXT AS actionable_opportunities,
       won_opportunities::TEXT AS won_opportunities,
       qualified_episodes::TEXT AS qualified_episodes,
       stale_opportunities::TEXT AS stale_opportunities,
       stale_rate::TEXT AS stale_rate
     FROM query_plan_metric_snapshots
     WHERE id = $1`,
    [metricId],
  )
  const row = result.rows[0]
  if (row?.new_company_events !== '11' ||
      row?.actionable_opportunities !== '7' ||
      row?.won_opportunities !== '2' || row?.qualified_episodes !== '9' ||
      row?.stale_opportunities !== '3' || row?.stale_rate !== '0.3333333') {
    throw new Error('Query-plan metric snapshot changed during rollback.')
  }
}

async function assertForwardContractRestored(database) {
  const triggerResult = await database.query(
    `SELECT tgname
     FROM pg_trigger
     WHERE tgrelid = 'company_event_publications'::regclass
       AND NOT tgisinternal
       AND tgname IN (
         'company_event_publications_append_only',
         'company_event_publications_append_only_update',
         'company_event_publications_append_only_delete'
       )
     ORDER BY tgname`,
  )
  const triggers = triggerResult.rows.map((row) => row.tgname)
  if (triggers.includes('company_event_publications_append_only') ||
      !triggers.includes('company_event_publications_append_only_update') ||
      !triggers.includes('company_event_publications_append_only_delete')) {
    throw new Error(`Unexpected publication mutation triggers: ${triggers.join(', ')}`)
  }

  const columns = await database.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'query_plan_metric_snapshots'
       AND column_name IN ('qualified_episodes', 'stale_opportunities', 'stale_rate')
     ORDER BY column_name`,
  )
  if (columns.rowCount !== 3) {
    throw new Error('Query Planner supply metric columns were not restored.')
  }

  const annotationConstraint = await database.query(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conrelid = 'commercial_signal_annotations'::regclass
       AND conname = 'commercial_signal_annotations_reason_check'`,
  )
  const definition = String(annotationConstraint.rows[0]?.definition ?? '')
  for (const reason of [
    'ordinary_hiring',
    'weak_agency_fit',
    'weak_external_need',
    'bad_economics',
    'stale_signal',
    'duplicate_event',
    'unverified_company',
    'wrong_role',
    'wrong_region',
    'internal_recruiting_sufficient',
    'no_actual_change',
  ]) {
    if (!definition.includes(reason)) {
      throw new Error(`Annotation taxonomy missing ${reason}.`)
    }
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}
