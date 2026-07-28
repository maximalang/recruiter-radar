import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const targetMigration = '20260728122000_add_auth_challenge_consumption.sql'

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DB_TEST_ISOLATED !== 'true') {
  throw new Error('AUTH_V2_DB_TEST_ISOLATED=true is required.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const pool = new Pool({ connectionString: databaseUrl, max: 8 })

try {
  const databaseName = await pool.query('SELECT CURRENT_DATABASE() AS name')
  if (!/^auth_v2_test_consumption_[a-z0-9_]+$/.test(
    databaseName.rows[0]?.name ?? '',
  )) {
    throw new Error(
      'Refusing to run outside auth_v2_test_consumption_<suffix>.',
    )
  }

  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
  for (const filename of migrations) {
    if (filename > targetMigration) break
    await pool.query(await readFile(resolve(migrationsDir, filename), 'utf8'))
  }

  await verifyOneConsumerOneSession(pool)
  await verifyOneSignupIdentity(pool)
  await verifyResendConsumeSerialization(pool)
  await verifyStaleBoundIdentityDenied(pool)
  await verifyMagicLoginRevokesLegacy(pool)

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'one_consumer_one_session',
      'one_signup_identity',
      'bounded_replay_audit',
      'resend_consume_serialized',
      'stale_bound_identity_denied',
      'magic_login_legacy_revoked',
    ],
  }))
} finally {
  await pool.end()
}

async function verifyMagicLoginRevokesLegacy(poolInstance) {
  const email = 'legacy-revoke@example.invalid'
  const challengeHash = digest('legacy-revoke-challenge')
  const legacyFingerprint = digest('legacy-revoke-fingerprint')
  const issued = await issue(poolInstance, email, challengeHash, 'legacy-revoke')
  if (!issued.issued) throw new Error('Legacy revoke challenge was not issued.')

  const consumed = await consume(
    poolInstance,
    challengeHash,
    digest('legacy-revoke-session'),
    digest('legacy-revoke-verifier'),
    legacyFingerprint,
  )
  const state = await poolInstance.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE event_type = 'legacy_session_migrated'
          AND subject_hash = $1) AS revocations,
       NOT EXISTS (
         SELECT 1
         FROM auth_security_events
         WHERE event_type = 'legacy_session_migrated'
           AND subject_hash = $1
       ) AS legacy_authorized`,
    [legacyFingerprint],
  )
  if (
    !consumed.consumed
    || state.rows[0]?.revocations !== 1
    || state.rows[0]?.legacy_authorized !== false
  ) {
    throw new Error('Magic login did not durably revoke the legacy cookie.')
  }
}

async function verifyStaleBoundIdentityDenied(poolInstance) {
  const originalEmail = 'stale-bound@example.invalid'
  const replacementEmail = 'stale-bound-replaced@example.invalid'
  const user = await poolInstance.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at,
       created_at,
       updated_at
     )
     VALUES ($1, $1, NOW(), NOW(), NOW())
     RETURNING id::TEXT AS id`,
    [originalEmail],
  )
  const challengeHash = digest('stale-bound-challenge')
  const issued = await issue(poolInstance, originalEmail, challengeHash, 'stale')
  if (!issued.issued) throw new Error('Bound identity challenge was not issued.')
  await poolInstance.query(
    `UPDATE users
     SET email = $2, email_normalized = $2, updated_at = NOW()
     WHERE id = $1`,
    [user.rows[0].id, replacementEmail],
  )

  const consumed = await consume(
    poolInstance,
    challengeHash,
    digest('stale-bound-session'),
    digest('stale-bound-verifier'),
  )
  const state = await poolInstance.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER
        FROM auth_sessions
        WHERE user_id = $1) AS sessions,
       (SELECT invalidated_at IS NOT NULL
        FROM auth_challenges
        WHERE token_hash = $2) AS invalidated,
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE event_type = 'login_failed'
          AND user_id = $1
          AND metadata @> '{"reason_code":"challenge_identity_changed"}') AS events`,
    [user.rows[0].id, challengeHash],
  )
  if (
    consumed.consumed
    || state.rows[0]?.sessions !== 0
    || state.rows[0]?.invalidated !== true
    || state.rows[0]?.events !== 1
  ) {
    throw new Error('Stale bound identity challenge authenticated an old account.')
  }
}

async function verifyOneConsumerOneSession(poolInstance) {
  const email = 'atomic-consume@example.invalid'
  const challengeHash = digest('atomic-consume-challenge')
  const issued = await issue(poolInstance, email, challengeHash, 'atomic')
  if (!issued.issued) throw new Error('Atomic consume challenge was not issued.')

  const results = await Promise.all([
    consume(
      poolInstance,
      challengeHash,
      digest('atomic-consume-session-a'),
      digest('atomic-consume-verifier-a'),
    ),
    consume(
      poolInstance,
      challengeHash,
      digest('atomic-consume-session-b'),
      digest('atomic-consume-verifier-b'),
    ),
  ])
  if (results.filter((result) => result.consumed).length !== 1) {
    throw new Error('Exactly one concurrent challenge consumer must succeed.')
  }

  const state = await poolInstance.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER
        FROM users
        WHERE email_normalized = $1) AS users,
       (SELECT COUNT(*)::INTEGER
        FROM auth_sessions AS session
        JOIN users AS account ON account.id = session.user_id
        WHERE account.email_normalized = $1) AS sessions,
       (SELECT COUNT(*)::INTEGER
        FROM auth_challenges
        WHERE token_hash = $2 AND consumed_at IS NOT NULL) AS consumed,
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE event_type = 'login_succeeded'
          AND user_id = (
            SELECT id FROM users WHERE email_normalized = $1
          )) AS login_events,
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE event_type = 'session_created'
          AND user_id = (
            SELECT id FROM users WHERE email_normalized = $1
          )) AS session_events`,
    [email, challengeHash],
  )
  const row = state.rows[0]
  if (
    row?.users !== 1
    || row.sessions !== 1
    || row.consumed !== 1
    || row.login_events !== 1
    || row.session_events !== 1
  ) {
    throw new Error('Atomic consume created duplicate identity or session data.')
  }

  await consume(
    poolInstance,
    challengeHash,
    digest('atomic-consume-session-replay-a'),
    digest('atomic-consume-verifier-replay'),
  )
  await consume(
    poolInstance,
    challengeHash,
    digest('atomic-consume-session-replay-b'),
    digest('atomic-consume-verifier-replay'),
  )
  const replay = await poolInstance.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM auth_security_events
     WHERE event_type = 'challenge_replayed'
       AND subject_hash = $1`,
    [challengeHash],
  )
  if (replay.rows[0]?.count !== 1) {
    throw new Error('Challenge replay audit must be bounded to one event.')
  }
}

async function verifyOneSignupIdentity(poolInstance) {
  const email = 'concurrent-signup@example.invalid'
  const challengeA = digest('concurrent-signup-challenge-a')
  const challengeB = digest('concurrent-signup-challenge-b')
  const issued = await Promise.all([
    issue(poolInstance, email, challengeA, 'signup'),
    issue(poolInstance, email, challengeB, 'signup'),
  ])
  if (issued.some((result) => !result.issued)) {
    throw new Error('Concurrent signup challenges were not issued.')
  }

  const consumed = await Promise.all([
    consume(
      poolInstance,
      challengeA,
      digest('concurrent-signup-session-a'),
      digest('concurrent-signup-verifier-a'),
    ),
    consume(
      poolInstance,
      challengeB,
      digest('concurrent-signup-session-b'),
      digest('concurrent-signup-verifier-b'),
    ),
  ])
  const state = await poolInstance.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER
        FROM users
        WHERE email_normalized = $1) AS users,
       (SELECT COUNT(*)::INTEGER
        FROM auth_sessions AS session
        JOIN users AS account ON account.id = session.user_id
        WHERE account.email_normalized = $1) AS sessions,
       (SELECT COUNT(*)::INTEGER
        FROM auth_challenges
        WHERE email_normalized = $1
          AND consumed_at IS NULL
          AND invalidated_at IS NULL) AS active`,
    [email],
  )
  if (
    consumed.filter((result) => result.consumed).length !== 1
    || state.rows[0]?.users !== 1
    || state.rows[0]?.sessions !== 1
    || state.rows[0]?.active !== 0
  ) {
    throw new Error('Concurrent signup created duplicate identity state.')
  }
}

async function verifyResendConsumeSerialization(poolInstance) {
  const email = 'resend-consume@example.invalid'
  const firstHash = digest('resend-consume-first')
  const secondHash = digest('resend-consume-second')
  const first = await issue(poolInstance, email, firstHash, 'resend')
  if (!first.issued) throw new Error('Initial resend race challenge failed.')

  const [resend, consumed] = await Promise.all([
    issue(poolInstance, email, secondHash, 'resend'),
    consume(
      poolInstance,
      firstHash,
      digest('resend-consume-session'),
      digest('resend-consume-verifier'),
    ),
  ])
  const state = await poolInstance.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE token_hash = $2
           AND consumed_at IS NULL
           AND invalidated_at IS NULL
       )::INTEGER AS new_active,
       COUNT(*) FILTER (
         WHERE token_hash = $1
           AND (
             (consumed_at IS NOT NULL AND invalidated_at IS NULL)
             OR (consumed_at IS NULL AND invalidated_at IS NOT NULL)
           )
       )::INTEGER AS old_terminal,
       (SELECT COUNT(*)::INTEGER
        FROM auth_sessions AS session
        JOIN users AS account ON account.id = session.user_id
        WHERE account.email_normalized = $3) AS sessions
     FROM auth_challenges
     WHERE token_hash IN ($1, $2)`,
    [firstHash, secondHash, email],
  )
  if (
    !resend.issued
    || state.rows[0]?.new_active !== 1
    || state.rows[0]?.old_terminal !== 1
    || state.rows[0]?.sessions > 1
    || (consumed.consumed && state.rows[0]?.sessions !== 1)
  ) {
    throw new Error('Resend and consume were not serialized safely.')
  }
}

async function issue(poolInstance, email, tokenHash, key) {
  const result = await poolInstance.query(
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

async function consume(
  poolInstance,
  challengeTokenHash,
  sessionTokenHash,
  verificationKeyHash,
  legacyFingerprint = null,
) {
  const result = await poolInstance.query(
    `SELECT
       consumed,
       user_id::TEXT AS "userId",
       session_id::TEXT AS "sessionId"
     FROM consume_auth_login_challenge($1, $2, $3, $4, $5)`,
    [
      challengeTokenHash,
      sessionTokenHash,
      digest('global-consumption-verifier'),
      verificationKeyHash,
      legacyFingerprint,
    ],
  )
  return result.rows[0]
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}
