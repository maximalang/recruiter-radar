import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL
const migrationVersion = '20260809100000_add_canonical_entitlement_grants'

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.ENTITLEMENT_DISPOSABLE_DB_CONFIRMED !== 'true') {
  throw new Error(
    'ENTITLEMENT_DISPOSABLE_DB_CONFIRMED=true is required before creating a disposable database.',
  )
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const downMigrationPath = resolve(
  root,
  'packages',
  'db',
  'migrations',
  `${migrationVersion}.down.sql`,
)
const databaseName = `entitlement_migration_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
temporaryUrl.searchParams.delete('schema')
const admin = new Client({ connectionString: databaseUrl })
let fixture

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function runMigrations() {
  const result = await execFileAsync(process.execPath, [migrateScript], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: temporaryUrl.toString() },
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

await admin.connect()
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  fixture = new Client({ connectionString: temporaryUrl.toString() })
  await fixture.connect()
  await fixture.query(`
    CREATE TABLE schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  // Hold back the migration under test while the authoritative prior chain runs.
  await fixture.query(
    'INSERT INTO schema_migrations (version) VALUES ($1)',
    [migrationVersion],
  )
  await fixture.end()
  fixture = undefined
  await runMigrations()

  fixture = new Client({ connectionString: temporaryUrl.toString() })
  await fixture.connect()
  const user = await fixture.query(
    `INSERT INTO users (email, email_normalized, email_verified_at, status)
     VALUES (
       'legacy-admin@example.test',
       'legacy-admin@example.test',
       CURRENT_TIMESTAMP,
       'active'
     )
     RETURNING id::TEXT AS id`,
  )
  await fixture.query(
    `INSERT INTO pilot_enrollments (
       user_id, status, starts_at, ends_at, activated_by
     ) VALUES ($1, 'active', CURRENT_TIMESTAMP - INTERVAL '30 days', NULL, 'admin')`,
    [user.rows[0].id],
  )
  await fixture.query(
    'DELETE FROM schema_migrations WHERE version = $1',
    [migrationVersion],
  )
  await fixture.end()
  fixture = undefined
  await runMigrations()

  fixture = new Client({ connectionString: temporaryUrl.toString() })
  await fixture.connect()
  const grant = await fixture.query(
    `SELECT source, plan_code, status, ends_at, revoked_at
     FROM entitlement_grants
     WHERE user_id = $1`,
    [user.rows[0].id],
  )
  const row = grant.rows[0]
  if (
    grant.rowCount !== 1
    || row.source !== 'admin'
    || row.plan_code !== 'legacy-admin-review-required'
    || row.status !== 'revoked'
    || row.ends_at !== null
    || row.revoked_at === null
  ) {
    throw new Error(`Unexpected legacy-admin quarantine result: ${JSON.stringify(grant.rows)}`)
  }

  const downSql = await readFile(downMigrationPath, 'utf8')
  await fixture.query(downSql).then(
    () => { throw new Error('Down migration unexpectedly dropped entitlement audit history.') },
    (error) => {
      if (!String(error?.message).includes('audit history must be retained')) throw error
    },
  )
  const tableStillExists = await fixture.query(
    `SELECT TO_REGCLASS('public.entitlement_grants') IS NOT NULL AS present`,
  )
  if (tableStillExists.rows[0]?.present !== true) {
    throw new Error('Entitlement audit table was removed after a refused rollback.')
  }
  console.log('Entitlement migration quarantine and rollback-retention checks passed.')
} finally {
  await fixture?.end().catch(() => {})
  await admin.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
  ).catch(() => {})
  await admin.end().catch(() => {})
}
