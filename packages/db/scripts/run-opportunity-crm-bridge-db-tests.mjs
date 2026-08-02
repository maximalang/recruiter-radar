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
const jestScript = resolve(root, 'node_modules', 'jest', 'bin', 'jest.js')
const webRoot = resolve(root, 'apps', 'web')
const databaseName = `rr_crm_bridge_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
const admin = new Client({ connectionString: databaseUrl })
const environment = {
  ...process.env,
  DATABASE_URL: temporaryUrl.toString(),
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function run(command, args, cwd = root) {
  const result = await execFileAsync(command, args, {
    cwd,
    env: environment,
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
    'src/__tests__/lib/opportunities/crm-runtime-db.test.ts',
  ], webRoot)
} finally {
  await admin.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
  )
  await admin.end()
}
