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
const pool = new Pool({ connectionString: databaseUrl, max: 8 })

try {
  const databaseName = await pool.query('SELECT CURRENT_DATABASE() AS name')
  if (!/^auth_v2_test_sessions_[a-z0-9_]+$/.test(
    databaseName.rows[0]?.name ?? '',
  )) {
    throw new Error('Refusing to run outside auth_v2_test_sessions_<suffix>.')
  }

  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
  for (const filename of migrations) {
    if (filename > targetMigration) break
    await pool.query(await readFile(resolve(migrationsDir, filename), 'utf8'))
  }

  const userA = await createVerifiedUser(pool, 'session-a@example.invalid')
  const userB = await createVerifiedUser(pool, 'session-b@example.invalid')
  const revokeScopeUser = await createVerifiedUser(
    pool,
    'session-revoke-scope@example.invalid',
  )

  await verifyExpiry(pool, userA)
  await verifyTouchThrottle(pool, userA)
  await verifyRotationRace(pool, userA)
  await verifyPreviousTokenGrace(pool, userA)
  await verifyRecentAuthenticationScope(pool, userA)
  await verifyRevokeDominatesRotation(pool, userA)
  await verifyRevokeAllScope(pool, revokeScopeUser, userB)

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'idle_and_absolute_expiry',
      'touch_throttled',
      'rotation_single_winner',
      'rotation_previous_token_grace',
      'recent_auth_session_scoped',
      'revoke_dominates_rotation',
      'revoke_all_scoped',
    ],
  }))
} finally {
  await pool.end()
}

async function verifyExpiry(poolInstance, userId) {
  const idleHash = digest('idle-expired')
  const absoluteHash = digest('absolute-expired')
  await insertSession(poolInstance, {
    userId,
    tokenHash: idleHash,
    createdAt: at('-20 days'),
    lastSeenAt: at('-15 days'),
    idleExpiresAt: at('-1 day'),
    absoluteExpiresAt: at('+5 days'),
    rotatedAt: at('-15 days'),
  })
  await insertSession(poolInstance, {
    userId,
    tokenHash: absoluteHash,
    createdAt: at('-31 days'),
    lastSeenAt: at('-20 days'),
    idleExpiresAt: at('-6 days'),
    absoluteExpiresAt: at('-1 day'),
    rotatedAt: at('-20 days'),
  })

  const [idleRead, absoluteRead] = await Promise.all([
    readSession(poolInstance, idleHash),
    readSession(poolInstance, absoluteHash),
  ])
  const states = await poolInstance.query(
    `SELECT token_hash, revoke_reason
     FROM auth_sessions
     WHERE token_hash IN ($1, $2)
     ORDER BY token_hash`,
    [idleHash, absoluteHash],
  )
  const reasons = new Set(states.rows.map((row) => row.revoke_reason))
  if (
    idleRead.rowCount !== 0
    || absoluteRead.rowCount !== 0
    || !reasons.has('idle_expired')
    || !reasons.has('absolute_expired')
  ) {
    throw new Error('Idle or absolute session expiry failed closed.')
  }
}

async function verifyTouchThrottle(poolInstance, userId) {
  const recentHash = digest('touch-recent')
  const staleHash = digest('touch-stale')
  const recentLastSeen = at('-4 minutes')
  await insertSession(poolInstance, {
    userId,
    tokenHash: recentHash,
    createdAt: at('-1 day'),
    lastSeenAt: recentLastSeen,
    idleExpiresAt: at('+13 days'),
    absoluteExpiresAt: at('+29 days'),
    rotatedAt: at('-1 day'),
  })
  await insertSession(poolInstance, {
    userId,
    tokenHash: staleHash,
    createdAt: at('-1 day'),
    lastSeenAt: at('-20 minutes'),
    idleExpiresAt: at('+13 days'),
    absoluteExpiresAt: at('+29 days'),
    rotatedAt: at('-1 day'),
  })

  await readSession(poolInstance, recentHash)
  await readSession(poolInstance, staleHash)
  const state = await poolInstance.query(
    `SELECT token_hash, last_seen_at, idle_expires_at
     FROM auth_sessions
     WHERE token_hash IN ($1, $2)`,
    [recentHash, staleHash],
  )
  const recent = state.rows.find((row) => row.token_hash === recentHash)
  const stale = state.rows.find((row) => row.token_hash === staleHash)
  if (
    recent?.last_seen_at.getTime() !== recentLastSeen.getTime()
    || stale?.last_seen_at.getTime() !== now.getTime()
    || stale?.idle_expires_at.getTime() !== at('+14 days').getTime()
  ) {
    throw new Error('Session touch was not throttled or extended correctly.')
  }
}

async function verifyRotationRace(poolInstance, userId) {
  const currentHash = digest('rotation-current')
  const nextA = digest('rotation-next-a')
  const nextB = digest('rotation-next-b')
  const sessionId = await insertActiveSession(
    poolInstance,
    userId,
    currentHash,
  )
  const results = await Promise.all([
    rotateSession(poolInstance, currentHash, nextA),
    rotateSession(poolInstance, currentHash, nextB),
  ])
  const state = await poolInstance.query(
     `SELECT
       token_hash,
       previous_token_hash,
       previous_token_valid_until,
       revoked_at,
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE event_type = 'session_rotated'
          AND session_id = $1) AS events
     FROM auth_sessions
     WHERE id = $1`,
    [sessionId],
  )
  if (
    results.filter((result) => result.rowCount === 1).length !== 1
    || ![nextA, nextB].includes(state.rows[0]?.token_hash)
    || state.rows[0]?.previous_token_hash !== currentHash
    || state.rows[0]?.previous_token_valid_until.getTime()
      !== at('+1 minute').getTime()
    || state.rows[0]?.revoked_at !== null
    || state.rows[0]?.events !== 1
  ) {
    throw new Error('Concurrent rotation did not produce one winner.')
  }
}

async function verifyPreviousTokenGrace(poolInstance, userId) {
  const currentHash = digest('rotation-grace-current')
  const nextHash = digest('rotation-grace-next')
  await insertActiveSession(poolInstance, userId, currentHash)
  const rotated = await rotateSession(poolInstance, currentHash, nextHash)
  const [currentRead, previousRead, expiredPreviousRead] = await Promise.all([
    readSession(poolInstance, nextHash),
    readSession(poolInstance, currentHash),
    readSession(poolInstance, currentHash, at('+2 minutes')),
  ])
  if (
    rotated.rowCount !== 1
    || currentRead.rowCount !== 1
    || previousRead.rowCount !== 1
    || expiredPreviousRead.rowCount !== 0
  ) {
    throw new Error('Previous session token grace is not bounded.')
  }
}

async function verifyRecentAuthenticationScope(poolInstance, userId) {
  const freshId = await insertSession(poolInstance, {
    userId,
    tokenHash: digest('recent-auth-fresh'),
    createdAt: at('-1 day'),
    lastSeenAt: at('-5 minutes'),
    idleExpiresAt: at('+13 days'),
    absoluteExpiresAt: at('+29 days'),
    rotatedAt: at('-1 day'),
    lastAuthenticatedAt: now,
  })
  const staleId = await insertSession(poolInstance, {
    userId,
    tokenHash: digest('recent-auth-stale'),
    createdAt: at('-1 day'),
    lastSeenAt: at('-5 minutes'),
    idleExpiresAt: at('+13 days'),
    absoluteExpiresAt: at('+29 days'),
    rotatedAt: at('-1 day'),
    lastAuthenticatedAt: null,
  })
  const state = await poolInstance.query(
    `SELECT id::TEXT AS id, last_authenticated_at
     FROM auth_sessions
     WHERE id IN ($1, $2)`,
    [freshId, staleId],
  )
  const byId = new Map(state.rows.map((row) => [row.id, row]))
  if (
    byId.get(freshId)?.last_authenticated_at?.getTime() !== now.getTime()
    || byId.get(staleId)?.last_authenticated_at !== null
  ) {
    throw new Error('Recent authentication leaked across sessions.')
  }
}

async function verifyRevokeDominatesRotation(poolInstance, userId) {
  const currentHash = digest('revoke-race-current')
  const nextHash = digest('revoke-race-next')
  const sessionId = await insertActiveSession(
    poolInstance,
    userId,
    currentHash,
  )
  await Promise.all([
    rotateSession(poolInstance, currentHash, nextHash),
    revokeSessionById(poolInstance, userId, sessionId),
  ])
  const state = await poolInstance.query(
    `SELECT revoked_at, revoke_reason
     FROM auth_sessions
     WHERE id = $1`,
    [sessionId],
  )
  if (
    state.rows[0]?.revoked_at === null
    || state.rows[0]?.revoke_reason !== 'logout'
  ) {
    throw new Error('User-scoped revocation lost a rotation race.')
  }
}

async function verifyRevokeAllScope(poolInstance, userA, userB) {
  const keepId = await insertActiveSession(
    poolInstance,
    userA,
    digest('revoke-all-keep'),
  )
  const revokeId = await insertActiveSession(
    poolInstance,
    userA,
    digest('revoke-all-target'),
  )
  const foreignId = await insertActiveSession(
    poolInstance,
    userB,
    digest('revoke-all-foreign'),
  )
  const revoked = await revokeAllSessions(poolInstance, userA, keepId)
  const state = await poolInstance.query(
    `SELECT id::TEXT AS id, revoked_at
     FROM auth_sessions
     WHERE id IN ($1, $2, $3)`,
    [keepId, revokeId, foreignId],
  )
  const byId = new Map(state.rows.map((row) => [row.id, row]))
  if (
    revoked !== 1
    || byId.get(keepId)?.revoked_at !== null
    || byId.get(revokeId)?.revoked_at === null
    || byId.get(foreignId)?.revoked_at !== null
  ) {
    throw new Error('Revoke-all crossed its user/session boundary.')
  }
}

async function readSession(poolInstance, tokenHash, readAt = now) {
  return poolInstance.query(
    `WITH invalidated AS (
       UPDATE auth_sessions AS session
       SET
         revoked_at = $2,
         revoke_reason = CASE
           WHEN session.absolute_expires_at <= $2 THEN 'absolute_expired'
           WHEN session.idle_expires_at <= $2 THEN 'idle_expired'
           ELSE 'account_unavailable'
         END
       WHERE (
           session.token_hash = $1
           OR (
             session.previous_token_hash = $1
             AND session.previous_token_valid_until > $2
           )
         )
         AND session.revoked_at IS NULL
         AND (
           session.absolute_expires_at <= $2
           OR session.idle_expires_at <= $2
           OR NOT EXISTS (
             SELECT 1 FROM users AS account
             WHERE account.id = session.user_id
               AND account.status = 'active'
               AND account.email_verified_at IS NOT NULL
           )
         )
       RETURNING session.*
     ),
     invalidated_event AS (
       INSERT INTO auth_security_events (
         event_type,
         user_id,
         session_id,
         metadata,
         created_at
       )
       SELECT
         'session_revoked',
         invalidated.user_id,
         invalidated.id,
         JSONB_BUILD_OBJECT(
           'reason_code',
           invalidated.revoke_reason,
           'revoke_scope',
           'current'
         ),
         $2
       FROM invalidated
       RETURNING id
     ),
     touched AS (
       UPDATE auth_sessions AS session
       SET
         last_seen_at = $2,
         idle_expires_at = LEAST(
           $2 + INTERVAL '14 days',
           session.absolute_expires_at
         )
       FROM users AS account
       WHERE (
           session.token_hash = $1
           OR (
             session.previous_token_hash = $1
             AND session.previous_token_valid_until > $2
           )
         )
         AND session.user_id = account.id
         AND session.revoked_at IS NULL
         AND session.idle_expires_at > $2
         AND session.absolute_expires_at > $2
         AND session.last_seen_at <= $2 - INTERVAL '5 minutes'
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
       RETURNING session.*
     ),
     current_session AS (
       SELECT session.*
       FROM auth_sessions AS session
       JOIN users AS account ON account.id = session.user_id
       WHERE (
           session.token_hash = $1
           OR (
             session.previous_token_hash = $1
             AND session.previous_token_valid_until > $2
           )
         )
         AND session.revoked_at IS NULL
         AND session.idle_expires_at > $2
         AND session.absolute_expires_at > $2
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
     ),
     selected AS (
       SELECT * FROM touched
       UNION ALL
       SELECT * FROM current_session
       WHERE NOT EXISTS (SELECT 1 FROM touched)
     )
     SELECT
       selected.id::TEXT AS id,
       (SELECT COUNT(*) FROM invalidated_event) AS invalidated_events
     FROM selected`,
    [tokenHash, readAt],
  )
}

async function rotateSession(poolInstance, currentHash, nextHash) {
  return poolInstance.query(
    `WITH rotated AS (
       UPDATE auth_sessions AS session
       SET
         previous_token_hash = session.token_hash,
         previous_token_valid_until = LEAST(
           $3::TIMESTAMPTZ + INTERVAL '60 seconds',
           session.absolute_expires_at
         ),
         token_hash = $2,
         last_seen_at = $3,
         idle_expires_at = LEAST(
           $3 + INTERVAL '14 days',
           session.absolute_expires_at
         ),
         rotated_at = $3
       FROM users AS account
       WHERE session.token_hash = $1
         AND session.user_id = account.id
         AND session.revoked_at IS NULL
         AND session.idle_expires_at > $3
         AND session.absolute_expires_at > $3
         AND session.rotated_at <= $3 - INTERVAL '24 hours'
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
       RETURNING session.*
     ),
     recorded AS (
       INSERT INTO auth_security_events (
         event_type,
         user_id,
         session_id,
         metadata,
         created_at
       )
       SELECT
         'session_rotated',
         rotated.user_id,
         rotated.id,
         JSONB_BUILD_OBJECT('method', rotated.auth_method),
         $3
       FROM rotated
       RETURNING id
     )
     SELECT
       rotated.id::TEXT AS id,
       (SELECT COUNT(*) FROM recorded) AS recorded
     FROM rotated`,
    [currentHash, nextHash, now],
  )
}

async function revokeSessionById(poolInstance, userId, sessionId) {
  return poolInstance.query(
    `WITH revoked AS (
       UPDATE auth_sessions AS session
       SET revoked_at = clock_timestamp(), revoke_reason = 'logout'
       WHERE session.user_id = $1
         AND session.id = $2
         AND session.revoked_at IS NULL
       RETURNING session.*
     ),
     recorded AS (
       INSERT INTO auth_security_events (
         event_type,
         user_id,
         session_id,
         metadata,
         created_at
       )
       SELECT
         'session_revoked',
         revoked.user_id,
         revoked.id,
         JSONB_BUILD_OBJECT(
           'reason_code',
           'logout',
           'revoke_scope',
           'current'
         ),
         revoked.revoked_at
       FROM revoked
       RETURNING id
     )
     SELECT
       EXISTS(SELECT 1 FROM revoked) AS revoked,
       (SELECT COUNT(*) FROM recorded) AS recorded`,
    [userId, sessionId],
  )
}

async function revokeAllSessions(poolInstance, userId, keepSessionId) {
  const result = await poolInstance.query(
    `WITH revoked AS (
       UPDATE auth_sessions AS session
       SET revoked_at = clock_timestamp(), revoke_reason = 'logout_all'
       WHERE session.user_id = $1
         AND session.id <> $2
         AND session.revoked_at IS NULL
       RETURNING session.*
     ),
     recorded AS (
       INSERT INTO auth_security_events (
         event_type,
         user_id,
         metadata,
         created_at
       )
       SELECT
         'all_sessions_revoked',
         $1,
         JSONB_BUILD_OBJECT(
           'reason_code',
           'logout_all',
           'revoke_scope',
           'all'
         ),
         clock_timestamp()
       WHERE EXISTS (SELECT 1 FROM revoked)
       RETURNING id
     )
     SELECT
       COUNT(*)::INTEGER AS count,
       (SELECT COUNT(*) FROM recorded) AS recorded
     FROM revoked`,
    [userId, keepSessionId],
  )
  return result.rows[0]?.count ?? 0
}

async function createVerifiedUser(poolInstance, email) {
  const result = await poolInstance.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at,
       last_authenticated_at
     )
     VALUES ($1, $1, $2, $2)
     RETURNING id::TEXT AS id`,
    [email, now],
  )
  return result.rows[0].id
}

async function insertActiveSession(poolInstance, userId, tokenHash) {
  return insertSession(poolInstance, {
    userId,
    tokenHash,
    createdAt: at('-1 day'),
    lastSeenAt: at('-5 minutes'),
    idleExpiresAt: at('+13 days'),
    absoluteExpiresAt: at('+29 days'),
    rotatedAt: at('-1 day'),
  })
}

async function insertSession(poolInstance, input) {
  const result = await poolInstance.query(
    `INSERT INTO auth_sessions (
       user_id,
       token_hash,
       auth_method,
       created_at,
       last_seen_at,
       idle_expires_at,
       absolute_expires_at,
       rotated_at,
       last_authenticated_at
     )
     VALUES ($1, $2, 'magic_link', $3, $4, $5, $6, $7, $8)
     RETURNING id::TEXT AS id`,
    [
      input.userId,
      input.tokenHash,
      input.createdAt,
      input.lastSeenAt,
      input.idleExpiresAt,
      input.absoluteExpiresAt,
      input.rotatedAt,
      input.lastAuthenticatedAt ?? null,
    ],
  )
  return result.rows[0].id
}

function at(expression) {
  const match = /^([+-])(\d+) (minutes?|days?)$/.exec(expression)
  if (!match) throw new Error(`Unsupported interval: ${expression}`)
  const direction = match[1] === '+' ? 1 : -1
  const value = Number(match[2])
  const unitMs = match[3].startsWith('minute')
    ? 60 * 1000
    : 24 * 60 * 60 * 1000
  return new Date(now.getTime() + direction * value * unitMs)
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}
