import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}
if (process.env.AUTH_V2_DISPOSABLE_DB_CONFIRMED !== 'true') {
  throw new Error(
    'AUTH_V2_DISPOSABLE_DB_CONFIRMED=true is required before creating a disposable database.',
  )
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const webRoot = resolve(root, 'apps', 'web')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const rollbackPath = resolve(
  root,
  'packages',
  'db',
  'migrations',
  '20260729132000_add_auth_passkeys.down.sql',
)
const jestScript = resolve(root, 'node_modules', 'jest', 'bin', 'jest.js')
const databaseName = `auth_v2_test_passkeys_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
temporaryUrl.searchParams.delete('schema')
const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: temporaryUrl.toString(),
  AUTH_V2_PASSKEY_DB_TEST: 'true',
  AUTH_PLATFORM_V2_ENABLED: 'true',
  AUTH_WORKSPACES_V2_ENABLED: 'true',
  AUTH_PASSKEYS_ENABLED: 'true',
  AUTH_SITE_URL: 'https://radar.example',
  AUTH_PASSKEY_RP_ID: 'radar.example',
  AUTH_RATE_LIMIT_SECRET:
    'auth-v2-passkey-db-test-rate-limit-secret-000000000001',
  SESSION_SECRET:
    'auth-v2-passkey-db-test-session-secret-000000000000001',
}
const admin = new Client({ connectionString: databaseUrl })

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function run(command, args, cwd = root) {
  const result = await execFileAsync(command, args, {
    cwd,
    env: testEnvironment,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

async function verifyGuardedRollback() {
  const rollback = await readFile(rollbackPath, 'utf8')
  const verifier = new Client({ connectionString: temporaryUrl.toString() })
  await verifier.connect()
  try {
    let rejection
    try {
      await verifier.query(rollback)
    } catch (error) {
      rejection = error
    }
    assert.match(
      String(rejection?.message),
      /refusing to drop non-empty user_passkeys/,
      'Rollback did not refuse to drop persisted credentials.',
    )
    await verifier.query('ROLLBACK')
    await verifier.query('DELETE FROM user_passkeys')
    await verifier.query(rollback)

    const result = await verifier.query(
      `SELECT
         TO_REGCLASS('public.user_passkeys') IS NULL AS passkeys_removed,
         (
           SELECT is_nullable = 'NO'
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'auth_challenges'
             AND column_name = 'email_normalized'
         ) AS email_required,
         (
           SELECT indexdef NOT ILIKE '%email_normalized IS NOT NULL%'
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'auth_challenges_active_identity_uidx'
         ) AS legacy_index_restored`,
    )
    assert.deepEqual(result.rows[0], {
      passkeys_removed: true,
      email_required: true,
      legacy_index_restored: true,
    })
    process.stdout.write(
      'Guarded passkey rollback rejected non-empty data and restored the prior schema after explicit cleanup.\n',
    )
  } finally {
    await verifier.end()
  }
}

await admin.connect()
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  await run(process.execPath, [migrateScript])
  await run(
    process.execPath,
    [
      jestScript,
      '--runInBand',
      '--runTestsByPath',
      'src/__tests__/lib/auth-v2-passkeys-db.test.ts',
    ],
    webRoot,
  )
  await verifyGuardedRollback()
} finally {
  await admin.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
  )
  await admin.end()
}
