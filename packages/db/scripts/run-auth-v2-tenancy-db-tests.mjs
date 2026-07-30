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
    prefix: 'auth_v2_test_workspace_tenancy_',
    script: 'verify-auth-v2-workspace-tenancy.mjs',
  },
  {
    prefix: 'auth_v2_test_workspace_sessions_',
    script: 'verify-auth-v2-workspace-sessions.mjs',
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
    const result = await execFileAsync(process.execPath, [scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: temporaryUrl.toString(),
        AUTH_V2_DB_TEST_ISOLATED: 'true',
      },
      maxBuffer: 20 * 1024 * 1024,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
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
