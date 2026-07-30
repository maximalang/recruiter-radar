import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Pool } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL?.trim()
const targetMigration = '20260728121000_add_auth_challenge_issuance.sql'
const cleanupLockKey = 2_026_073_005

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DB_TEST_ISOLATED !== 'true') {
  throw new Error('AUTH_V2_DB_TEST_ISOLATED=true is required.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const cleanupScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'cleanup-auth-v2-challenges.mjs',
)
const pool = new Pool({ connectionString: databaseUrl, max: 5 })

try {
  const databaseName = await pool.query('SELECT CURRENT_DATABASE() AS name')
  if (!/^auth_v2_test_challenges_[a-z0-9_]+$/.test(
    databaseName.rows[0]?.name ?? '',
  )) {
    throw new Error(
      'Refusing to run outside auth_v2_test_challenges_<suffix>.',
    )
  }

  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
  for (const filename of migrations) {
    if (filename > targetMigration) break
    await pool.query(await readFile(resolve(migrationsDir, filename), 'utf8'))
  }

  const usersBefore = await count(pool, 'users')
  const first = await issue(pool, {
    email: 'new@example.invalid',
    tokenHash: 'a'.repeat(64),
    globalHash: '1'.repeat(64),
    emailHash: '3'.repeat(64),
  })
  const second = await issue(pool, {
    email: 'new@example.invalid',
    tokenHash: 'b'.repeat(64),
    globalHash: '1'.repeat(64),
    emailHash: '3'.repeat(64),
  })
  const usersAfter = await count(pool, 'users')
  const signupState = await pool.query(
    `SELECT
       COUNT(*)::INTEGER AS total,
       COUNT(*) FILTER (
         WHERE consumed_at IS NULL AND invalidated_at IS NULL
       )::INTEGER AS active,
       COUNT(*) FILTER (
         WHERE invalidated_at IS NOT NULL
       )::INTEGER AS invalidated,
       BOOL_AND(purpose = 'signup') AS "signupOnly",
       BOOL_AND(user_id IS NULL) AS "withoutUser"
     FROM auth_challenges
     WHERE email_normalized = 'new@example.invalid'`,
  )
  if (
    !first.issued
    || !second.issued
    || usersAfter !== usersBefore
    || signupState.rows[0]?.total !== 2
    || signupState.rows[0]?.active !== 1
    || signupState.rows[0]?.invalidated !== 1
    || signupState.rows[0]?.signupOnly !== true
    || signupState.rows[0]?.withoutUser !== true
  ) {
    throw new Error('Challenge request/resend invariant failed.')
  }

  const concurrentEmail = 'concurrent@example.invalid'
  const [concurrentA, concurrentB] = await Promise.all([
    issue(pool, {
      email: concurrentEmail,
      tokenHash: 'c'.repeat(64),
      globalHash: '1'.repeat(64),
      emailHash: '4'.repeat(64),
    }),
    issue(pool, {
      email: concurrentEmail,
      tokenHash: 'd'.repeat(64),
      globalHash: '1'.repeat(64),
      emailHash: '4'.repeat(64),
    }),
  ])
  const concurrentState = await pool.query(
    `SELECT
       COUNT(*)::INTEGER AS total,
       COUNT(*) FILTER (
         WHERE consumed_at IS NULL AND invalidated_at IS NULL
       )::INTEGER AS active
     FROM auth_challenges
     WHERE email_normalized = $1`,
    [concurrentEmail],
  )
  if (
    !concurrentA.issued
    || !concurrentB.issued
    || concurrentState.rows[0]?.total !== 2
    || concurrentState.rows[0]?.active !== 1
  ) {
    throw new Error('Concurrent resend did not leave one active challenge.')
  }

  const existing = await pool.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at
     )
     VALUES ('existing@example.invalid', 'existing@example.invalid', NOW())
     RETURNING id::TEXT AS id`,
  )
  const login = await issue(pool, {
    email: 'existing@example.invalid',
    tokenHash: 'e'.repeat(64),
    globalHash: '1'.repeat(64),
    emailHash: '5'.repeat(64),
  })
  const loginState = await pool.query(
    `SELECT purpose, user_id::TEXT AS "userId"
     FROM auth_challenges
     WHERE id = $1`,
    [login.challengeId],
  )
  if (
    !login.issued
    || loginState.rows[0]?.purpose !== 'login'
    || loginState.rows[0]?.userId !== existing.rows[0]?.id
  ) {
    throw new Error('Existing verified user was not linked internally.')
  }

  const rateEmail = 'rate@example.invalid'
  const rateResults = []
  for (const tokenChar of ['f', '6', '7', '8']) {
    rateResults.push(await issue(pool, {
      email: rateEmail,
      tokenHash: tokenChar.repeat(64),
      globalHash: '1'.repeat(64),
      emailHash: '6'.repeat(64),
      ipHash: null,
    }))
  }
  const rateRows = await pool.query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM auth_challenges
     WHERE email_normalized = $1`,
    [rateEmail],
  )
  if (
    rateResults.slice(0, 3).some((result) => !result.issued)
    || rateResults[3]?.issued !== false
    || rateRows.rows[0]?.total !== 3
  ) {
    throw new Error('Email rate limit did not deny the fourth issue.')
  }

  await pool.query(
    `UPDATE auth_challenges
     SET created_at = NOW() - INTERVAL '20 days 10 minutes',
         invalidated_at = NOW() - INTERVAL '20 days',
         expires_at = NOW() - INTERVAL '20 days'
     WHERE id = $1`,
    [first.challengeId],
  )
  const cleanupDryRun = await runCleanup()
  if (
    cleanupDryRun.exitCode !== 0
    || cleanupDryRun.report?.ok !== true
    || cleanupDryRun.report?.mode !== 'dry-run'
    || !Number.isInteger(cleanupDryRun.report?.eligible)
    || cleanupDryRun.report.eligible < 1
    || cleanupDryRun.report?.remaining !== cleanupDryRun.report?.eligible
    || !Number.isInteger(cleanupDryRun.report?.durationMs)
    || cleanupDryRun.report.durationMs < 0
  ) {
    throw new Error('Challenge cleanup dry-run aggregate was invalid.')
  }

  const cleanupApply = await runCleanup(['--apply'])
  const cleanupAfter = await runCleanup()
  if (
    cleanupApply.exitCode !== 0
    || cleanupApply.report?.ok !== true
    || cleanupApply.report?.mode !== 'apply'
    || !Number.isInteger(cleanupApply.report?.deleted)
    || cleanupApply.report.deleted < 1
    || cleanupApply.report?.remaining !== 0
    || cleanupAfter.exitCode !== 0
    || cleanupAfter.report?.eligible !== 0
    || cleanupAfter.report?.remaining !== 0
  ) {
    throw new Error('Challenge cleanup apply was not idempotent.')
  }

  const lockClient = await pool.connect()
  try {
    await lockClient.query(
      'SELECT pg_advisory_lock($1)',
      [cleanupLockKey],
    )
    const concurrentCleanup = await runCleanup()
    if (
      concurrentCleanup.exitCode === 0
      || concurrentCleanup.report?.ok !== false
      || concurrentCleanup.report?.reason !== 'lock_unavailable'
    ) {
      throw new Error('Concurrent challenge cleanup was not rejected.')
    }
  } finally {
    await lockClient.query(
      'SELECT pg_advisory_unlock($1)',
      [cleanupLockKey],
    )
    lockClient.release()
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'users_created_before_verification:0',
      'resend_invalidated_previous',
      'one_active_after_concurrent_resend',
      'existing_user_linked_privately',
      'rate_limit_denied',
      'challenge_cleanup_aggregate_complete',
      'challenge_cleanup_idempotent',
      'challenge_cleanup_concurrency_rejected',
    ],
  }))
} finally {
  await pool.end()
}

async function runCleanup(args = []) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [cleanupScript, ...args],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        maxBuffer: 1024 * 1024,
      },
    )
    return {
      exitCode: 0,
      report: JSON.parse(result.stdout.trim()),
    }
  } catch (error) {
    return {
      exitCode: Number(error?.code) || 1,
      report: JSON.parse(error?.stdout?.trim() || '{}'),
    }
  }
}

async function issue(poolInstance, input) {
  const result = await poolInstance.query(
    `SELECT
       issued,
       challenge_id::TEXT AS "challengeId"
     FROM issue_auth_login_challenge($1, $2, '/dashboard', $3, $4, $5, $6)`,
    [
      input.email,
      input.tokenHash,
      input.globalHash,
      input.emailHash,
      input.ipHash === undefined ? '2'.repeat(64) : input.ipHash,
      '9'.repeat(64),
    ],
  )
  return result.rows[0]
}

async function count(poolInstance, table) {
  if (table !== 'users') throw new Error('Unsupported table.')
  const result = await poolInstance.query(
    'SELECT COUNT(*)::INTEGER AS count FROM users',
  )
  return result.rows[0].count
}
