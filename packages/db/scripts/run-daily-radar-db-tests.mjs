import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../../..')
const webRoot = resolve(root, 'apps', 'web')
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl || process.env.DAILY_RADAR_DB_TEST_ACK !== 'isolated') {
  throw new Error('DATABASE_URL and DAILY_RADAR_DB_TEST_ACK=isolated are required for the disposable daily-radar DB verifier.')
}

const databaseName = `daily_radar_${process.pid}_${Date.now()}`
const isolatedUrl = new URL(databaseUrl)
isolatedUrl.pathname = `/${databaseName}`
isolatedUrl.searchParams.delete('schema')
const admin = new Client({ connectionString: databaseUrl })
let created = false

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function run(label, command, args, env) {
  process.stdout.write(`\n[daily-radar-db] ${label}\n`)
  const result = await execFileAsync(command, args, {
    cwd: label.includes('Jest') ? webRoot : root,
    env,
    maxBuffer: 30 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

const isolatedEnv = {
  ...process.env,
  DATABASE_URL: isolatedUrl.toString(),
  DAILY_RADAR_DB_TEST_ACK: 'isolated',
}

const integrationTests = [
  'src/__tests__/db-integration/daily-radar-state-db.test.ts',
  'src/__tests__/db-integration/channel-delivery-state-db.test.ts',
]

try {
  await admin.connect()
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  created = true

  await run('Initial migration up', process.execPath, [resolve(root, 'packages/db/scripts/migrate.mjs')], isolatedEnv)
  await run(
    'Jest real lease/takeover integration',
    process.execPath,
    [resolve(root, 'node_modules/jest/bin/jest.js'), '--runInBand', '--runTestsByPath', ...integrationTests],
    isolatedEnv,
  )

  const isolated = new Client({ connectionString: isolatedUrl.toString() })
  await isolated.connect()
  try {
    for (const version of ['20260814090000_harden_daily_radar_recovery', '20260814080000_harden_channel_delivery_state']) {
      const down = await readFile(resolve(root, `packages/db/migrations/${version}.down.sql`), 'utf8')
      await isolated.query(down)
      await isolated.query('DELETE FROM schema_migrations WHERE version = $1', [version])
    }
  } finally {
    await isolated.end()
  }

  await run('Migration re-up after down', process.execPath, [resolve(root, 'packages/db/scripts/migrate.mjs')], isolatedEnv)
  await run(
    'Jest real lease/takeover integration after re-up',
    process.execPath,
    [resolve(root, 'node_modules/jest/bin/jest.js'), '--runInBand', '--runTestsByPath', ...integrationTests],
    isolatedEnv,
  )
  process.stdout.write('\n[daily-radar-db] up/down/re-up and real PostgreSQL fencing passed.\n')
} finally {
  if (created) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch(() => undefined)
  }
  await admin.end().catch(() => undefined)
}
