import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
const jestScript = resolve(root, 'node_modules', 'jest', 'bin', 'jest.js')
const databaseName =
  `auth_v2_test_account_team_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
temporaryUrl.searchParams.delete('schema')

const outboxDirectory = await mkdtemp(
  join(tmpdir(), 'rr-auth-v2-account-team-'),
)
const outboxPath = join(outboxDirectory, 'outbox.json')
const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: temporaryUrl.toString(),
  AUTH_V2_ACCOUNT_TEAM_DB_TEST: 'true',
  AUTH_PLATFORM_V2_ENABLED: 'true',
  AUTH_WORKSPACES_V2_ENABLED: 'true',
  AUTH_SITE_URL: 'https://radar.example',
  AUTH_RATE_LIMIT_SECRET:
    'auth-v2-account-team-db-test-rate-limit-secret-00000001',
  SESSION_SECRET:
    'auth-v2-account-team-db-test-session-secret-0000000000001',
  AUTH_EMAIL_TRANSPORT: 'test',
  AUTH_EMAIL_TEST_OUTBOX_PATH: outboxPath,
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
      'src/__tests__/lib/auth-v2-account-team-db.test.ts',
    ],
    webRoot,
  )
} finally {
  await admin.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
  )
  await admin.end()
  await rm(outboxDirectory, { recursive: true, force: true })
}
