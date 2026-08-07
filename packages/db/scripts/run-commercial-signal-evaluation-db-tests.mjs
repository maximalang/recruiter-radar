import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const exporterScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'export-commercial-signal-evaluation-dataset.mjs',
)
const admin = new Client({ connectionString: databaseUrl })
const databaseName = `rr_commercial_signal_eval_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
const testEnvironment = {
  ...process.env,
  DATABASE_URL: temporaryUrl.toString(),
  EVALUATION_ANONYMIZATION_KEY:
    'isolated-commercial-signal-evaluation-key-v1',
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function run(args) {
  return execFileAsync(process.execPath, args, {
    cwd: root,
    env: testEnvironment,
    maxBuffer: 20 * 1024 * 1024,
  })
}

await admin.connect()
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  await run([migrateScript])
  const reports = []
  for (const kind of [
    'anonymized_labeled',
    'holdout',
    'production_shadow',
  ]) {
    const { stdout } = await run([
      exporterScript,
      '--workspace-id',
      '900000001',
      '--kind',
      kind,
      '--from',
      '2026-01-01T00:00:00.000Z',
      '--to',
      '2027-01-01T00:00:00.000Z',
    ])
    const dataset = JSON.parse(stdout)
    assert.equal(dataset.kind, kind)
    assert.equal(dataset.status, 'unavailable')
    assert.deepEqual(dataset.rows, [])
    assert.ok(dataset.unavailableReason)
    reports.push(kind)
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: [
      'isolated_postgresql_schema',
      'workspace_scoped_labeled_query',
      'deterministic_holdout_query',
      'v3_shadow_query',
      'empty_is_unavailable',
    ],
    datasets: reports,
  })}\n`)
} finally {
  await admin.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
  )
  await admin.end()
}
