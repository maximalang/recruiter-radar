import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const targetMigration = '20260730101000_add_legacy_session_revocation.sql'
const rollbackMigration =
  '20260730101000_add_legacy_session_revocation.down.sql'
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
  const migrationSql = await readFile(
    resolve(migrationsDir, targetMigration),
    'utf8',
  )
  const rollbackSql = await readFile(
    resolve(migrationsDir, rollbackMigration),
    'utf8',
  )
  await pool.query(rollbackSql)
  await assertRevocationSchema(false)
  await pool.query(migrationSql)
  await assertRevocationSchema(true)

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
         FROM auth_security_events AS prior_denial
         WHERE prior_denial.event_type IN (
           'legacy_session_migrated',
           'legacy_session_revoked'
         )
           AND prior_denial.subject_hash = $2
       )
     LIMIT 1`,
    [userId, firstFingerprint],
  )
  if (replayAuthorization.rowCount !== 0) {
    throw new Error('Exchanged legacy fingerprint remained authorized.')
  }
  const rollbackAuthorization = await pool.query(
    `SELECT NOT EXISTS (
       SELECT 1
       FROM auth_security_events AS prior_denial
       WHERE prior_denial.event_type IN (
         'legacy_session_migrated',
         'legacy_session_revoked'
       )
         AND prior_denial.subject_hash = $1
     ) AS authorized`,
    [firstFingerprint],
  )
  if (rollbackAuthorization.rows[0]?.authorized !== false) {
    throw new Error('Canary rollback revived an exchanged legacy fingerprint.')
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

  const logoutFingerprint = digest('legacy-fingerprint-logout')
  await pool.query(
    `INSERT INTO auth_security_events (
       event_type,
       user_id,
       subject_hash,
       metadata,
       created_at
     )
     VALUES (
       'legacy_session_revoked',
       $1,
       $2,
       '{"reason_code":"logout","source":"legacy"}'::JSONB,
       $3
     )`,
    [userId, logoutFingerprint, now],
  )
  const logoutReplay = await exchange(
    pool,
    userId,
    digest('legacy-session-after-logout'),
    logoutFingerprint,
  )
  const logoutAuthorization = await pool.query(
    `SELECT NOT EXISTS (
       SELECT 1
       FROM auth_security_events AS prior_denial
       WHERE prior_denial.event_type IN (
         'legacy_session_migrated',
         'legacy_session_revoked'
       )
         AND prior_denial.subject_hash = $1
     ) AS authorized`,
    [logoutFingerprint],
  )
  if (
    logoutReplay.rowCount !== 0
    || logoutAuthorization.rows[0]?.authorized !== false
  ) {
    throw new Error('Legacy logout tombstone did not deny replay.')
  }

  const preExchangedFingerprint = digest(
    'legacy-fingerprint-pre-exchanged-logout',
  )
  const preExchanged = await exchange(
    pool,
    userId,
    digest('legacy-session-pre-exchanged-logout'),
    preExchangedFingerprint,
  )
  const preExchangedLogout = await logout(
    pool,
    userId,
    preExchangedFingerprint,
  )
  const preExchangedState = await readLogoutState(
    pool,
    preExchangedFingerprint,
  )
  const preExchangedReplay = await exchange(
    pool,
    userId,
    digest('legacy-session-pre-exchanged-replay'),
    preExchangedFingerprint,
  )
  if (
    preExchanged.rowCount !== 1
    || preExchangedLogout.rows[0]?.revoked !== true
    || preExchangedState.activeSessions !== 0
    || preExchangedState.revokedSessions !== 1
    || preExchangedState.sessionRevocations !== 1
    || preExchangedState.logoutTombstones !== 1
    || preExchangedReplay.rowCount !== 0
  ) {
    throw new Error(
      'Logout did not revoke a previously exchanged legacy session.',
    )
  }

  const raceFingerprint = digest('legacy-fingerprint-exchange-logout-race')
  const [raceExchange, raceLogout] = await Promise.all([
    exchange(
      pool,
      userId,
      digest('legacy-session-exchange-logout-race'),
      raceFingerprint,
    ),
    logout(pool, userId, raceFingerprint),
  ])
  const raceState = await readLogoutState(pool, raceFingerprint)
  const raceReplay = await exchange(
    pool,
    userId,
    digest('legacy-session-exchange-logout-race-replay'),
    raceFingerprint,
  )
  if (
    ![0, 1].includes(raceExchange.rowCount)
    || raceLogout.rows[0]?.revoked !== true
    || raceState.activeSessions !== 0
    || raceState.revokedSessions !== raceExchange.rowCount
    || raceState.sessionRevocations !== raceExchange.rowCount
    || raceState.logoutTombstones !== 1
    || raceReplay.rowCount !== 0
  ) {
    throw new Error(
      'Concurrent legacy exchange and logout left an active session.',
    )
  }

  let duplicateLogoutRejected = false
  try {
    await pool.query(
      `INSERT INTO auth_security_events (
         event_type,
         user_id,
         subject_hash,
         metadata,
         created_at
       )
       VALUES (
         'legacy_session_revoked',
         $1,
         $2,
         '{"reason_code":"logout","source":"legacy"}'::JSONB,
         $3
       )`,
      [userId, logoutFingerprint, now],
    )
  } catch (error) {
    duplicateLogoutRejected = error?.code === '23505'
  }
  if (!duplicateLogoutRejected) {
    throw new Error('Duplicate legacy logout tombstone was accepted.')
  }

  let logoutRollbackRefused = false
  try {
    await pool.query(rollbackSql)
  } catch (error) {
    logoutRollbackRefused = error?.message?.includes(
      'legacy session revocation rollback refused',
    )
    await pool.query('ROLLBACK').catch(() => undefined)
  }
  if (!logoutRollbackRefused) {
    throw new Error('Legacy logout tombstone was removed by rollback.')
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
          AND metadata->>'method' = 'legacy_exchange') AS session_events,
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE user_id = $1
          AND event_type = 'legacy_session_revoked') AS logout_tombstones`,
    [userId],
  )
  if (
    ![3, 4].includes(state.rows[0]?.sessions)
    || state.rows[0]?.migrations !== state.rows[0]?.sessions
    || state.rows[0]?.session_events !== state.rows[0]?.sessions
    || state.rows[0]?.logout_tombstones !== 3
  ) {
    throw new Error('Legacy exchange ledger and sessions diverged.')
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'valid_exchange',
      'repeated_exchange_denied',
      'legacy_authorization_replay_denied',
      'rollback_authorization_replay_denied',
      'concurrent_exchange_single_winner',
      'legacy_logout_replay_denied',
      'pre_exchanged_logout_revokes_v2',
      'concurrent_exchange_logout_safe',
      'legacy_logout_rollback_denied',
      'legacy_revocation_clean_down_upgrade',
    ],
  }))
} finally {
  await pool.end()
}

async function exchange(poolInstance, userId, sessionHash, fingerprint) {
  const client = await poolInstance.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [fingerprint],
    )
    const result = await client.query(
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
           FROM auth_security_events AS prior_denial
           WHERE prior_denial.event_type IN (
             'legacy_session_migrated',
             'legacy_session_revoked'
           )
             AND prior_denial.subject_hash = $3
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
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function logout(poolInstance, userId, fingerprint) {
  const client = await poolInstance.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [fingerprint],
    )
    const result = await client.query(
      `WITH revoked_sessions AS (
         UPDATE auth_sessions AS session
         SET
           revoked_at = GREATEST(
             session.created_at,
             $3::TIMESTAMPTZ
           ),
           revoke_reason = 'logout'
         WHERE session.user_id = $1
           AND session.legacy_fingerprint_hash = $2
           AND session.revoked_at IS NULL
         RETURNING session.*
       ),
       session_recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           workspace_id,
           session_id,
           request_ip_hash,
           user_agent_hash,
           metadata,
           created_at
         )
         SELECT
           'session_revoked',
           revoked_session.user_id,
           revoked_session.workspace_id,
           revoked_session.id,
           revoked_session.request_ip_hash,
           revoked_session.user_agent_hash,
           JSONB_BUILD_OBJECT(
             'reason_code',
             'logout',
             'revoke_scope',
             'current'
           ),
           revoked_session.revoked_at
         FROM revoked_sessions AS revoked_session
         RETURNING id
       ),
       tombstone_recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           subject_hash,
           metadata,
           created_at
         )
         VALUES (
           'legacy_session_revoked',
           $1,
           $2,
           '{"reason_code":"logout","source":"legacy"}'::JSONB,
           $3::TIMESTAMPTZ
         )
         ON CONFLICT (subject_hash)
           WHERE event_type = 'legacy_session_revoked'
             AND subject_hash IS NOT NULL
           DO NOTHING
         RETURNING id
       )
       SELECT
         (
           EXISTS (SELECT 1 FROM revoked_sessions)
           OR EXISTS (SELECT 1 FROM tombstone_recorded)
         ) AS revoked,
         (SELECT COUNT(*) FROM session_recorded) AS session_events`,
      [userId, fingerprint, now],
    )
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function readLogoutState(poolInstance, fingerprint) {
  const result = await poolInstance.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER
        FROM auth_sessions
        WHERE legacy_fingerprint_hash = $1
          AND revoked_at IS NULL) AS "activeSessions",
       (SELECT COUNT(*)::INTEGER
        FROM auth_sessions
        WHERE legacy_fingerprint_hash = $1
          AND revoked_at IS NOT NULL) AS "revokedSessions",
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE event_type = 'session_revoked'
          AND session_id IN (
            SELECT id
            FROM auth_sessions
            WHERE legacy_fingerprint_hash = $1
          )) AS "sessionRevocations",
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE event_type = 'legacy_session_revoked'
          AND subject_hash = $1) AS "logoutTombstones"`,
    [fingerprint],
  )
  return result.rows[0]
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

async function assertRevocationSchema(enabled) {
  const state = await pool.query(
    `SELECT
       TO_REGCLASS(
         'public.auth_security_events_legacy_revocation_uidx'
       ) IS NOT NULL AS "indexPresent",
       POSITION(
         'legacy_session_revoked'
         IN pg_get_constraintdef(
           (
             SELECT oid
             FROM pg_constraint
             WHERE conrelid = 'auth_security_events'::REGCLASS
               AND conname = 'auth_security_events_type_check'
           )
         )
       ) > 0 AS "eventAllowed"`,
  )
  if (
    state.rows[0]?.indexPresent !== enabled
    || state.rows[0]?.eventAllowed !== enabled
  ) {
    throw new Error('Legacy revocation schema state did not match.')
  }
}
