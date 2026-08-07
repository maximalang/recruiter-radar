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

    for (const version of [...ROUNDTRIP_MIGRATIONS].reverse()) {
      const sql = await readFile(
        resolve(migrationsDir, `${version}.down.sql`),
        'utf8',
      )
      await database.query(sql)
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
      'query_plan_supply_metrics_restored',
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
