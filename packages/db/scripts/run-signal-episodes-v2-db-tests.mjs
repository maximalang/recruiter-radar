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
const verifierScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-signal-episodes-v2.mjs',
)
const admin = new Client({ connectionString: databaseUrl })
const databaseName = `rr_signal_episodes_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
const testEnvironment = {
  ...process.env,
  DATABASE_URL: temporaryUrl.toString(),
  SIGNAL_EPISODES_V2_DB_TEST_ACK: 'isolated',
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function run(command, args) {
  const result = await execFileAsync(command, args, {
    cwd: root,
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
  await run(process.execPath, [verifierScript])
} finally {
  await admin.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
  )
  await admin.end()
}
