import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

import { executeMigrationSql } from './migration-execution.mjs'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const targetMigration = '20260730100000_harden_auth_email_identity.sql'
const rollbackMigration =
  '20260730100000_harden_auth_email_identity.down.sql'

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DB_TEST_ISOLATED !== 'true') {
  throw new Error('AUTH_V2_DB_TEST_ISOLATED=true is required.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const pool = new Pool({ connectionString: databaseUrl, max: 4 })

try {
  const databaseName = await pool.query('SELECT CURRENT_DATABASE() AS name')
  if (!/^auth_v2_test_identity_[a-z0-9_]+$/.test(
    databaseName.rows[0]?.name ?? '',
  )) {
    throw new Error(
      'Refusing to run outside auth_v2_test_identity_<suffix>.',
    )
  }

  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
  for (const filename of migrations) {
    if (filename > targetMigration) break
    await executeMigrationSql(
      pool,
      await readFile(resolve(migrationsDir, filename), 'utf8'),
    )
  }

  const hardeningSql = await readFile(
    resolve(migrationsDir, targetMigration),
    'utf8',
  )
  const rollbackSql = await readFile(
    resolve(migrationsDir, rollbackMigration),
    'utf8',
  )
  await pool.query(rollbackSql)
  await assertInstalledIdentityContract({
    legacyIndexPresent: true,
    canonicalIndexPresent: false,
    foldedIssuanceMatches: 1,
    foldedConsumptionMatches: 2,
  })
  await pool.query(hardeningSql)
  await assertInstalledIdentityContract({
    legacyIndexPresent: false,
    canonicalIndexPresent: true,
    foldedIssuanceMatches: 0,
    foldedConsumptionMatches: 0,
  })

  const suffix = `${process.pid}-${Date.now()}`
  const storedEmail = `Alice-${suffix}@EXAMPLE.INVALID`
  const exactIdentity = `Alice-${suffix}@example.invalid`
  const caseDistinctIdentity = `alice-${suffix}@example.invalid`
  const legacy = await pool.query(
    `INSERT INTO users (
       email,
       email_verified_at,
       created_at,
       updated_at
     )
     VALUES ($1, NOW(), NOW(), NOW())
     RETURNING id::TEXT AS id`,
    [storedEmail],
  )
  const legacyUserId = legacy.rows[0]?.id
  const canaryPreflight = await runPreflight({
    platformEnabled: false,
    trustedProxyHeader: 'x-real-ip',
    expectedExit: 0,
  })
  const globalPreflight = await runPreflight({
    platformEnabled: true,
    trustedProxyHeader: 'x-real-ip',
    expectedExit: 2,
  })
  const missingProxyCanaryPreflight = await runPreflight({
    platformEnabled: false,
    canaryIds: legacyUserId,
    trustedProxyHeader: '',
    expectedExit: 2,
  })
  const missingWindowPreflight = await runPreflight({
    platformEnabled: false,
    trustedProxyHeader: 'x-real-ip',
    legacyMigrationEnabled: true,
    rollbackCompatibilityEnabled: true,
    expectedExit: 2,
  })
  const futureDeadline = new Date(Date.now() + 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
  const validWindowPreflight = await runPreflight({
    platformEnabled: false,
    trustedProxyHeader: 'x-real-ip',
    legacyMigrationEnabled: true,
    legacyMigrationDeadline: futureDeadline,
    rollbackCompatibilityEnabled: true,
    rollbackCompatibilityDeadline: futureDeadline,
    expectedExit: 0,
  })
  if (
    canaryPreflight.blockingViolations
      ?.activeAccountsWithoutNormalizedIdentity !== 0
    || globalPreflight.blockingViolations
      ?.activeAccountsWithoutNormalizedIdentity !== 1
    || missingProxyCanaryPreflight.blockingViolations
      ?.trustedClientAddressNotReady !== 1
    || missingProxyCanaryPreflight.configuration
      ?.trustedClientAddressRequired !== true
    || missingWindowPreflight.blockingViolations
      ?.legacySessionMigrationWindowNotReady !== 1
    || missingWindowPreflight.blockingViolations
      ?.rollbackCompatibilityWindowNotReady !== 1
    || validWindowPreflight.blockingViolations
      ?.legacySessionMigrationWindowNotReady !== 0
    || validWindowPreflight.blockingViolations
      ?.rollbackCompatibilityWindowNotReady !== 0
  ) {
    throw new Error(
      'Preflight did not gate identity, proxy, or transitional readiness.',
    )
  }

  const distinctChallenge = await issue(
    caseDistinctIdentity,
    digest(`distinct-challenge-${suffix}`),
    `distinct-${suffix}`,
  )
  const distinctBinding = await readChallenge(distinctChallenge.challengeId)
  if (
    !distinctChallenge.issued
    || distinctBinding?.purpose !== 'signup'
    || distinctBinding?.userId !== null
  ) {
    throw new Error('Case-distinct local part was bound to a legacy account.')
  }
  const distinctConsumption = await consume(
    digest(`distinct-challenge-${suffix}`),
    digest(`distinct-session-${suffix}`),
    digest(`distinct-verify-${suffix}`),
  )
  if (!distinctConsumption.consumed) {
    throw new Error('Case-distinct mailbox could not create its own account.')
  }

  const exactChallenge = await issue(
    exactIdentity,
    digest(`exact-challenge-${suffix}`),
    `exact-${suffix}`,
  )
  const exactBinding = await readChallenge(exactChallenge.challengeId)
  if (
    !exactChallenge.issued
    || exactBinding?.purpose !== 'login'
    || exactBinding?.userId !== legacyUserId
    || exactBinding?.deliveryEmail !== storedEmail
  ) {
    throw new Error('Exact legacy identity was not bound to its stored mailbox.')
  }
  const exactConsumption = await consume(
    digest(`exact-challenge-${suffix}`),
    digest(`exact-session-${suffix}`),
    digest(`exact-verify-${suffix}`),
  )
  if (
    !exactConsumption.consumed
    || exactConsumption.userId !== legacyUserId
  ) {
    throw new Error('Exact legacy identity did not authenticate its account.')
  }

  const identities = await pool.query(
    `SELECT email_normalized AS identity
     FROM users
     WHERE email_normalized IN ($1, $2)
     ORDER BY email_normalized`,
    [exactIdentity, caseDistinctIdentity],
  )
  if (
    identities.rowCount !== 2
    || !identities.rows.some((row) => row.identity === exactIdentity)
    || !identities.rows.some((row) => row.identity === caseDistinctIdentity)
  ) {
    throw new Error('Case-distinct identities were merged after consumption.')
  }

  const indexes = await pool.query(
    `SELECT
       TO_REGCLASS('public.users_email_uidx') IS NULL AS "legacyRemoved",
       TO_REGCLASS(
         'public.users_auth_v2_identity_active_uidx'
       ) IS NOT NULL AS "canonicalPresent"`,
  )
  if (
    indexes.rows[0]?.legacyRemoved !== true
    || indexes.rows[0]?.canonicalPresent !== true
  ) {
    throw new Error('Canonical identity index did not replace LOWER(email).')
  }

  let duplicateRejected = false
  try {
    await pool.query(
      `INSERT INTO users (
         email,
         email_normalized,
         email_verified_at
       )
       VALUES ($1, $2, NOW())`,
      [`Alice-${suffix}@example.invalid`, exactIdentity],
    )
  } catch (error) {
    duplicateRejected = error?.code === '23505'
  }
  if (!duplicateRejected) {
    throw new Error('Exact canonical identity duplicate was accepted.')
  }

  let liveRollbackRefused = false
  try {
    await pool.query(
      rollbackSql,
    )
  } catch (error) {
    liveRollbackRefused = error?.message?.includes(
      'auth email identity hardening rollback refused',
    )
    await pool.query('ROLLBACK').catch(() => undefined)
  }
  if (!liveRollbackRefused) {
    throw new Error('Identity hardening rollback accepted live auth data.')
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'case_distinct_signup',
      'exact_legacy_login',
      'stored_delivery_mailbox',
      'global_preflight_legacy_identity_gate',
      'canary_preflight_trusted_proxy_gate',
      'transitional_deadline_preflight_gate',
      'clean_down_upgrade_chain',
      'installed_function_rewrite',
      'canonical_identity_uniqueness',
      'legacy_lower_index_removed',
      'live_rollback_refused',
    ],
  }))
} finally {
  await pool.end()
}

async function issue(email, tokenHash, key) {
  const result = await pool.query(
    `SELECT
       issued,
       challenge_id::TEXT AS "challengeId"
     FROM issue_auth_login_challenge($1, $2, '/dashboard', $3, $4, $5, $6)`,
    [
      email,
      tokenHash,
      digest(`global-${key}`),
      digest(`email-${key}`),
      digest(`ip-${key}`),
      digest(`agent-${key}`),
    ],
  )
  return result.rows[0]
}

async function readChallenge(challengeId) {
  const result = await pool.query(
    `SELECT
       challenge.purpose,
       challenge.user_id::TEXT AS "userId",
       COALESCE(account.email, challenge.email_normalized) AS "deliveryEmail"
     FROM auth_challenges AS challenge
     LEFT JOIN users AS account ON account.id = challenge.user_id
     WHERE challenge.id = $1`,
    [challengeId],
  )
  return result.rows[0]
}

async function consume(challengeTokenHash, sessionTokenHash, verifyHash) {
  const result = await pool.query(
    `SELECT
       consumed,
       user_id::TEXT AS "userId"
     FROM consume_auth_login_challenge($1, $2, $3, $4, NULL)`,
    [
      challengeTokenHash,
      sessionTokenHash,
      digest('global-identity-consumption'),
      verifyHash,
    ],
  )
  return result.rows[0]
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function assertInstalledIdentityContract(expected) {
  const state = await pool.query(
    `SELECT
       TO_REGCLASS('public.users_email_uidx') IS NOT NULL
         AS "legacyIndexPresent",
       TO_REGCLASS('public.users_auth_v2_identity_active_uidx') IS NOT NULL
         AS "canonicalIndexPresent",
       (
         SELECT COUNT(*)::INTEGER
         FROM regexp_matches(
           pg_get_functiondef(
             'issue_auth_login_challenge(text,text,text,text,text,text,text,timestamptz)'
               ::REGPROCEDURE
           ),
           'LOWER\\(email\\)\\s*=\\s*LOWER\\(input_email_normalized\\)',
           'gi'
         )
       ) AS "foldedIssuanceMatches",
       (
         SELECT COUNT(*)::INTEGER
         FROM regexp_matches(
           pg_get_functiondef(
             'consume_auth_login_challenge(text,text,text,text,text,timestamptz)'
               ::REGPROCEDURE
           ),
           'LOWER\\(account\\.email\\)\\s*=\\s*LOWER\\(locked_challenge\\.email_normalized\\)',
           'gi'
         )
       ) AS "foldedConsumptionMatches"`,
  )
  if (
    state.rows[0]?.legacyIndexPresent !== expected.legacyIndexPresent
    || state.rows[0]?.canonicalIndexPresent
      !== expected.canonicalIndexPresent
    || state.rows[0]?.foldedIssuanceMatches
      !== expected.foldedIssuanceMatches
    || state.rows[0]?.foldedConsumptionMatches
      !== expected.foldedConsumptionMatches
  ) {
    throw new Error('Installed email identity contract did not match.')
  }
}

async function runPreflight({
  platformEnabled,
  canaryIds = '',
  trustedProxyHeader,
  legacyMigrationEnabled = false,
  legacyMigrationDeadline = '',
  rollbackCompatibilityEnabled = false,
  rollbackCompatibilityDeadline = '',
  expectedExit,
}) {
  const scriptPath = resolve(
    root,
    'packages',
    'db',
    'scripts',
    'preflight-auth-v2.mjs',
  )
  const child = spawn(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AUTH_PLATFORM_V2_ENABLED: platformEnabled ? 'true' : 'false',
      AUTH_WORKSPACES_V2_ENABLED: 'false',
      AUTH_ONBOARDING_V2_ENABLED: 'false',
      AUTH_PASSKEYS_ENABLED: 'false',
      AUTH_LEGACY_SESSION_MIGRATION_ENABLED:
        legacyMigrationEnabled ? 'true' : 'false',
      AUTH_LEGACY_SESSION_MIGRATION_DEADLINE: legacyMigrationDeadline,
      AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED:
        rollbackCompatibilityEnabled ? 'true' : 'false',
      AUTH_V2_SESSION_ROLLBACK_COMPAT_DEADLINE:
        rollbackCompatibilityDeadline,
      AUTH_V2_CANARY_USER_IDS: canaryIds,
      AUTH_TRUSTED_PROXY_HEADER: trustedProxyHeader,
      AUTH_TRUSTED_PROXY_HOPS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', resolveExit)
  })
  if (exitCode !== expectedExit) {
    throw new Error(
      `Unexpected preflight exit ${exitCode}: ${stderr || stdout}`,
    )
  }
  return JSON.parse(stdout.trim())
}
