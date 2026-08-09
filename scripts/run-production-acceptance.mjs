import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const webRoot = resolve(root, 'apps', 'web')
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the production acceptance gate.')
}
if (process.env.AUTH_V2_DISPOSABLE_DB_CONFIRMED !== 'true') {
  throw new Error(
    'AUTH_V2_DISPOSABLE_DB_CONFIRMED=true is required; this gate creates and drops disposable databases.',
  )
}

const acceptanceDatabaseName = `production_acceptance_${process.pid}_${Date.now()}`
const acceptanceUrl = new URL(databaseUrl)
acceptanceUrl.pathname = `/${acceptanceDatabaseName}`
acceptanceUrl.searchParams.delete('schema')
const admin = new Client({ connectionString: databaseUrl })
let acceptanceDatabaseCreated = false

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function run(label, command, args, options = {}) {
  process.stdout.write(`\n[production-acceptance] ${label}\n`)
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    maxBuffer: 30 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

try {
  await run(
    'Scenario C: expired entitlement denies premium mutation and renders upgrade state',
    process.execPath,
    [
      resolve(root, 'node_modules', 'jest', 'bin', 'jest.js'),
      '--runInBand',
      '--runTestsByPath',
      'src/__tests__/app/leads/lead-actions-ownership.test.ts',
      'src/__tests__/app/dashboard/dashboard-access.test.tsx',
    ],
    { cwd: webRoot },
  )

  await run(
    'Scenario A: new client magic-link, onboarding, settings, logout and repeat login',
    process.execPath,
    [resolve(root, 'packages', 'db', 'scripts', 'run-auth-v2-account-team-e2e.mjs')],
  )

  await run(
    'Scenarios B/C: admin grant without checkout and entitlement lifecycle',
    process.execPath,
    [resolve(root, 'packages', 'db', 'scripts', 'run-auth-v2-account-team-db-tests.mjs')],
  )

  await admin.connect()
  await admin.query(`CREATE DATABASE ${quoteIdentifier(acceptanceDatabaseName)}`)
  acceptanceDatabaseCreated = true
  const paymentEnvironment = {
    ...process.env,
    DATABASE_URL: acceptanceUrl.toString(),
  }

  await run(
    'Scenario D: prepare disposable payment database',
    process.execPath,
    [resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')],
    { env: paymentEnvironment },
  )
  await run(
    'Scenario D: paid webhook entitlement, replay and refund transitions',
    process.execPath,
    [resolve(root, 'packages', 'db', 'scripts', 'verify-robokassa-billing.mjs')],
    { env: paymentEnvironment },
  )

  process.stdout.write('\n[production-acceptance] Scenarios A-D passed.\n')
} finally {
  if (acceptanceDatabaseCreated) {
    await admin.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(acceptanceDatabaseName)} WITH (FORCE)`,
    ).catch(() => undefined)
  }
  await admin.end().catch(() => undefined)
}
