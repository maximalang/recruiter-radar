import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}
if (process.env.AUTH_V2_DISPOSABLE_DB_CONFIRMED !== 'true') {
  throw new Error(
    'AUTH_V2_DISPOSABLE_DB_CONFIRMED=true is required before creating disposable databases.',
  )
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const testCases = [
  {
    name: 'foundation-clean',
    prefix: 'auth_v2_test_foundation_',
    script: 'verify-auth-v2-foundation.mjs',
    env: { AUTH_V2_DB_CASE: 'clean' },
  },
  {
    name: 'foundation-upgrade',
    prefix: 'auth_v2_test_foundation_',
    script: 'verify-auth-v2-foundation.mjs',
    env: { AUTH_V2_DB_CASE: 'upgrade' },
  },
  {
    name: 'foundation-down',
    prefix: 'auth_v2_test_foundation_',
    script: 'verify-auth-v2-foundation.mjs',
    env: { AUTH_V2_DB_CASE: 'down' },
  },
  {
    name: 'challenge-issuance',
    prefix: 'auth_v2_test_challenges_',
    script: 'verify-auth-v2-challenges.mjs',
    env: {},
  },
  {
    name: 'challenge-consumption',
    prefix: 'auth_v2_test_consumption_',
    script: 'verify-auth-v2-consumption.mjs',
    env: {},
  },
  {
    name: 'session-lifecycle',
    prefix: 'auth_v2_test_sessions_',
    script: 'verify-auth-v2-sessions.mjs',
    env: {},
  },
  {
    name: 'legacy-exchange-and-revocation',
    prefix: 'auth_v2_test_legacy_',
    script: 'verify-auth-v2-legacy-exchange.mjs',
    env: {},
  },
  {
    name: 'rollback-clean',
    prefix: 'auth_v2_test_rollback_',
    script: 'verify-auth-v2-rollback.mjs',
    env: { AUTH_V2_ROLLBACK_CASE: 'clean' },
  },
  {
    name: 'rollback-guard',
    prefix: 'auth_v2_test_rollback_',
    script: 'verify-auth-v2-rollback.mjs',
    env: { AUTH_V2_ROLLBACK_CASE: 'guard' },
  },
  {
    name: 'email-identity-hardening',
    prefix: 'auth_v2_test_identity_',
    script: 'verify-auth-v2-identity.mjs',
    env: {},
  },
]
const admin = new Client({ connectionString: databaseUrl })

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function runVerifier(testCase, index) {
  const databaseName =
    `${testCase.prefix}${process.pid}_${Date.now()}_${index}`
  const temporaryUrl = new URL(databaseUrl)
  temporaryUrl.pathname = `/${databaseName}`
  temporaryUrl.searchParams.delete('schema')
  const scriptPath = resolve(import.meta.dirname, testCase.script)

  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  try {
    process.stdout.write(`Auth v2 core DB: ${testCase.name}\n`)
    const result = await execFileAsync(process.execPath, [scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: temporaryUrl.toString(),
        AUTH_V2_DB_TEST_ISOLATED: 'true',
        AUTH_PLATFORM_V2_ENABLED: 'false',
        AUTH_WORKSPACES_V2_ENABLED: 'false',
        AUTH_ONBOARDING_V2_ENABLED: 'false',
        AUTH_PASSKEYS_ENABLED: 'false',
        AUTH_LEGACY_SESSION_MIGRATION_ENABLED: 'false',
        AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED: 'false',
        ...testCase.env,
      },
      maxBuffer: 20 * 1024 * 1024,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  } catch (error) {
    if (error?.stdout) process.stdout.write(error.stdout)
    if (error?.stderr) process.stderr.write(error.stderr)
    throw error
  } finally {
    await admin.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
    )
  }
}

await admin.connect()
try {
  for (const [index, testCase] of testCases.entries()) {
    await runVerifier(testCase, index)
  }
} finally {
  await admin.end()
}
