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
const rollbackCommercialSignalScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'rollback-commercial-signal-test-dependents.mjs',
)
const verifierScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-signal-episodes-v2.mjs',
)
const jestScript = resolve(root, 'node_modules', 'jest', 'bin', 'jest.js')
const webRoot = resolve(root, 'apps', 'web')
const admin = new Client({ connectionString: databaseUrl })
const databaseName = `rr_signal_episodes_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
const testEnvironment = {
  ...process.env,
  DATABASE_URL: temporaryUrl.toString(),
  SIGNAL_EPISODES_V2_DB_TEST_ACK: 'isolated',
  COMMERCIAL_SIGNAL_TEST_ROLLBACK_ACK: 'isolated',
}

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
  await run(process.execPath, [
    jestScript,
    '--runInBand',
    '--runTestsByPath',
    'src/__tests__/lib/opportunities/signal-episode-runtime-db.test.ts',
  ], webRoot)
  await run(process.execPath, [rollbackCommercialSignalScript])
  await run(process.execPath, [verifierScript])
} finally {
  await admin.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
  )
  await admin.end()
}