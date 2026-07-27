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
  'verify-opportunity-engine-v1.mjs',
)
const upgradeVerifierScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-opportunity-authoritative-state-upgrade.mjs',
)
const outcomeRebuildVerifierScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-opportunity-outcome-rebuild.mjs',
)
const jestScript = resolve(root, 'node_modules', 'jest', 'bin', 'jest.js')
const webRoot = resolve(root, 'apps', 'web')
const admin = new Client({ connectionString: databaseUrl })
const databaseName = `rr_opportunity_runtime_${process.pid}_${Date.now()}`
const upgradeDatabaseName = `rr_opportunity_upgrade_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
const upgradeUrl = new URL(databaseUrl)
upgradeUrl.pathname = `/${upgradeDatabaseName}`
const testEnvironment = {
  ...process.env,
  DATABASE_URL: temporaryUrl.toString(),
  OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
  OPPORTUNITY_OUTCOMES_ENABLED: 'true',
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function run(command, args, cwd = root, environment = testEnvironment) {
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
  await run(process.execPath, [verifierScript])
  await run(process.execPath, [
    jestScript,
    '--runInBand',
    '--runTestsByPath',
    'src/__tests__/lib/opportunities/runtime-db.test.ts',
    'src/__tests__/lib/opportunities/outcome-runtime-db.test.ts',
  ], webRoot)
  await run(process.execPath, [outcomeRebuildVerifierScript])
  await admin.query(`CREATE DATABASE ${quoteIdentifier(upgradeDatabaseName)}`)
  await run(process.execPath, [upgradeVerifierScript], root, {
    ...process.env,
    DATABASE_URL: upgradeUrl.toString(),
  })
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`)
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(upgradeDatabaseName)} WITH (FORCE)`)
  await admin.end()
}
