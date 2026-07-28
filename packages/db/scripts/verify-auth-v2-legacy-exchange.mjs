import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const targetMigration = '20260728122000_add_auth_challenge_consumption.sql'
const now = new Date('2026-07-28T12:00:00.000Z')

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DB_TEST_ISOLATED !== 'true') {
  throw new Error('AUTH_V2_DB_TEST_ISOLATED=true is required.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const pool = new Pool({ connectionString: databaseUrl, max: 6 })

try {
  const databaseName = await pool.query('SELECT CURRENT_DATABASE() AS name')
  if (!/^auth_v2_test_legacy_[a-z0-9_]+$/.test(
    databaseName.rows[0]?.name ?? '',
  )) {
    throw new Error('Refusing to run outside auth_v2_test_legacy_<suffix>.')
  }

  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
  for (const filename of migrations) {
    if (filename > targetMigration) break
    await pool.query(await readFile(resolve(migrationsDir, filename), 'utf8'))
  }

  const userId = await createVerifiedUser(pool, 'legacy@example.invalid')
  const firstFingerprint = digest('legacy-fingerprint-first')
  const first = await exchange(
    pool,
    userId,
    digest('legacy-session-first'),
    firstFingerprint,
  )
  const repeated = await exchange(
    pool,
    userId,
    digest('legacy-session-repeated'),
    firstFingerprint,
  )
  if (first.rowCount !== 1 || repeated.rowCount !== 0) {
    throw new Error('Repeated legacy exchange was not denied.')
  }
  const replayAuthorization = await pool.query(
    `SELECT account.id::TEXT AS id
     FROM users AS account
     WHERE account.id = $1
       AND account.status = 'active'
       AND account.email_verified_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM auth_security_events AS prior_exchange
         WHERE prior_exchange.event_type = 'legacy_session_migrated'
           AND prior_exchange.subject_hash = $2
       )
     LIMIT 1`,
    [userId, firstFingerprint],
  )
  if (replayAuthorization.rowCount !== 0) {
    throw new Error('Exchanged legacy fingerprint remained authorized.')
  }

  const concurrentFingerprint = digest('legacy-fingerprint-concurrent')
  const concurrent = await Promise.all([
    exchange(
      pool,
      userId,
      digest('legacy-session-concurrent-a'),
      concurrentFingerprint,
    ),
    exchange(
      pool,
      userId,
      digest('legacy-session-concurrent-b'),
      concurrentFingerprint,
    ),
  ])
  if (concurrent.filter((result) => result.rowCount === 1).length !== 1) {
    throw new Error('Concurrent legacy exchange produced multiple winners.')
  }

  const state = await pool.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER
        FROM auth_sessions
        WHERE user_id = $1
          AND legacy_fingerprint_hash IS NOT NULL) AS sessions,
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE user_id = $1
          AND event_type = 'legacy_session_migrated') AS migrations,
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE user_id = $1
          AND event_type = 'session_created'
          AND metadata->>'method' = 'legacy_exchange') AS session_events`,
    [userId],
  )
  if (
    state.rows[0]?.sessions !== 2
    || state.rows[0]?.migrations !== 2
    || state.rows[0]?.session_events !== 2
  ) {
    throw new Error('Legacy exchange ledger and sessions diverged.')
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'valid_exchange',
      'repeated_exchange_denied',
      'legacy_authorization_replay_denied',
      'concurrent_exchange_single_winner',
    ],
  }))
} finally {
  await pool.end()
}

async function exchange(poolInstance, userId, sessionHash, fingerprint) {
  return poolInstance.query(
    `WITH created AS (
       INSERT INTO auth_sessions (
         user_id,
         token_hash,
         auth_method,
         legacy_fingerprint_hash,
         created_at,
         last_seen_at,
         idle_expires_at,
         absolute_expires_at,
         rotated_at
       )
       SELECT
         account.id,
         $2,
         'legacy_exchange',
         $3,
         $4::TIMESTAMPTZ,
         $4::TIMESTAMPTZ,
         $4::TIMESTAMPTZ + INTERVAL '14 days',
         $4::TIMESTAMPTZ + INTERVAL '30 days',
         $4::TIMESTAMPTZ
       FROM users AS account
       WHERE account.id = $1
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM auth_security_events AS prior_exchange
           WHERE prior_exchange.event_type = 'legacy_session_migrated'
             AND prior_exchange.subject_hash = $3
         )
       ON CONFLICT (legacy_fingerprint_hash)
         WHERE legacy_fingerprint_hash IS NOT NULL
         DO NOTHING
       RETURNING *
     ),
     migration_recorded AS (
       INSERT INTO auth_security_events (
         event_type,
         user_id,
         session_id,
         subject_hash,
         metadata,
         created_at
       )
       SELECT
         'legacy_session_migrated',
         created.user_id,
         created.id,
         created.legacy_fingerprint_hash,
         JSONB_BUILD_OBJECT(
           'auth_version',
           'v2',
           'method',
           'legacy_exchange',
           'source',
           'legacy'
         ),
         $4::TIMESTAMPTZ
       FROM created
       ON CONFLICT (subject_hash)
         WHERE event_type = 'legacy_session_migrated'
           AND subject_hash IS NOT NULL
         DO NOTHING
       RETURNING id
     ),
     session_recorded AS (
       INSERT INTO auth_security_events (
         event_type,
         user_id,
         session_id,
         metadata,
         created_at
       )
       SELECT
         'session_created',
         created.user_id,
         created.id,
         JSONB_BUILD_OBJECT('method', 'legacy_exchange'),
         $4::TIMESTAMPTZ
       FROM created
       RETURNING id
     )
     SELECT
       created.id::TEXT AS id,
       (SELECT COUNT(*) FROM session_recorded) AS session_events
     FROM created
     WHERE EXISTS (SELECT 1 FROM migration_recorded)`,
    [userId, sessionHash, fingerprint, now],
  )
}

async function createVerifiedUser(poolInstance, email) {
  const result = await poolInstance.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at
     )
     VALUES ($1, $1, $2)
     RETURNING id::TEXT AS id`,
    [email, now],
  )
  return result.rows[0].id
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}
