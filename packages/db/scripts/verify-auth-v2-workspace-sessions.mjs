import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

import { executeMigrationSql } from './migration-execution.mjs'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const targetMigration = '20260729122000_add_auth_workspace_session_switch.sql'
const rollbackFile =
  '20260729122000_add_auth_workspace_session_switch.down.sql'

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DB_TEST_ISOLATED !== 'true') {
  throw new Error('AUTH_V2_DB_TEST_ISOLATED=true is required.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const pool = new Pool({ connectionString: databaseUrl, max: 8 })

try {
  const databaseName = await pool.query('SELECT CURRENT_DATABASE() AS name')
  if (!/^auth_v2_test_workspace_sessions_[a-z0-9_]+$/.test(
    databaseName.rows[0]?.name ?? '',
  )) {
    throw new Error(
      'Refusing to run outside auth_v2_test_workspace_sessions_<suffix>.',
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

  const ownerId = await insertVerifiedUser(
    'workspace-session-owner@example.invalid',
  )
  const originalWorkspaceId = await ensureWorkspace(ownerId)
  const targetWorkspace = await pool.query(
    `INSERT INTO workspaces (name, slug)
     VALUES ('Target workspace', 'workspace-session-target')
     RETURNING id::TEXT AS id`,
  )
  const targetWorkspaceId = targetWorkspace.rows[0].id
  await pool.query(
    `INSERT INTO workspace_members (
       workspace_id,
       user_id,
       role,
       status,
       joined_at,
       updated_at
     )
     VALUES ($1, $2, 'admin', 'active', NOW(), NOW())`,
    [targetWorkspaceId, ownerId],
  )

  const currentTokenHash = digest('workspace-session-current')
  const session = await pool.query(
    `INSERT INTO auth_sessions (
       user_id,
       workspace_id,
       token_hash,
       auth_method,
       created_at,
       last_seen_at,
       idle_expires_at,
       absolute_expires_at,
       rotated_at,
       last_authenticated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       'magic_link',
       NOW(),
       NOW(),
       NOW() + INTERVAL '14 days',
       NOW() + INTERVAL '30 days',
       NOW(),
       NOW()
     )
     RETURNING id::TEXT AS id`,
    [ownerId, originalWorkspaceId, currentTokenHash],
  )

  const nextHashes = [
    digest('workspace-session-next-a'),
    digest('workspace-session-next-b'),
  ]
  const switches = await Promise.all(nextHashes.map((nextHash) => (
    pool.query(
      `SELECT
         switched.id::TEXT AS id,
         switched.workspace_id::TEXT AS "workspaceId",
         switched.token_hash AS "tokenHash",
         switched.previous_token_hash AS "previousTokenHash",
         switched.previous_token_authorizes AS "previousTokenAuthorizes"
       FROM change_auth_session_workspace($1, $2, $3, NOW()) AS switched`,
      [currentTokenHash, nextHash, targetWorkspaceId],
    )
  )))
  const winners = switches.filter((result) => result.rowCount === 1)
  if (winners.length !== 1) {
    throw new Error('Concurrent workspace switch did not have one winner.')
  }

  const winningHash = winners[0].rows[0].tokenHash
  const switchState = await pool.query(
    `SELECT
       session.workspace_id::TEXT AS "workspaceId",
       session.token_hash AS "tokenHash",
       session.previous_token_hash AS "previousTokenHash",
       session.previous_token_valid_until AS "previousTokenValidUntil",
       session.previous_token_authorizes AS "previousTokenAuthorizes",
       (
         SELECT COUNT(*)::INTEGER
         FROM auth_security_events AS event
         WHERE event.event_type = 'workspace_switched'
           AND event.session_id = session.id
       ) AS events
     FROM auth_sessions AS session
     WHERE session.id = $1`,
    [session.rows[0].id],
  )
  if (
    switchState.rows[0]?.workspaceId !== targetWorkspaceId
    || switchState.rows[0]?.tokenHash !== winningHash
    || switchState.rows[0]?.previousTokenHash !== currentTokenHash
    || switchState.rows[0]?.previousTokenValidUntil === null
    || switchState.rows[0]?.previousTokenAuthorizes !== false
    || switchState.rows[0]?.events !== 1
  ) {
    throw new Error('Workspace switch did not rotate and audit atomically.')
  }

  const replay = await pool.query(
    `SELECT id
     FROM change_auth_session_workspace($1, $2, $3, NOW())`,
    [
      currentTokenHash,
      digest('workspace-session-replay'),
      originalWorkspaceId,
    ],
  )
  if (replay.rowCount !== 0) {
    throw new Error('Old workspace session token won a replay.')
  }

  const foreignUserId = await insertVerifiedUser(
    'workspace-session-foreign@example.invalid',
  )
  const foreignWorkspaceId = await ensureWorkspace(foreignUserId)
  const foreign = await pool.query(
    `SELECT id
     FROM change_auth_session_workspace($1, $2, $3, NOW())`,
    [
      winningHash,
      digest('workspace-session-foreign-switch'),
      foreignWorkspaceId,
    ],
  )
  if (foreign.rowCount !== 0) {
    throw new Error('Session switched into a foreign workspace.')
  }

  const revokedAfterSwitch = await pool.query(
    `UPDATE auth_sessions AS session
     SET revoked_at = NOW(), revoke_reason = 'logout'
     WHERE (
         session.token_hash = $1
         OR session.previous_token_hash = $1
       )
       AND session.revoked_at IS NULL
     RETURNING
       session.token_hash AS "tokenHash",
       session.revoke_reason AS reason`,
    [currentTokenHash],
  )
  if (
    revokedAfterSwitch.rowCount !== 1
    || revokedAfterSwitch.rows[0]?.tokenHash !== winningHash
    || revokedAfterSwitch.rows[0]?.reason !== 'logout'
  ) {
    throw new Error('Logout did not dominate a completed workspace switch.')
  }

  const membershipSession = await pool.query(
    `INSERT INTO auth_sessions (
       user_id,
       workspace_id,
       token_hash,
       auth_method,
       created_at,
       last_seen_at,
       idle_expires_at,
       absolute_expires_at,
       rotated_at,
       last_authenticated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       'magic_link',
       NOW(),
       NOW(),
       NOW() + INTERVAL '14 days',
       NOW() + INTERVAL '30 days',
       NOW(),
       NOW()
     )
     RETURNING id::TEXT AS id`,
    [ownerId, targetWorkspaceId, digest('workspace-membership-session')],
  )

  await pool.query(
    `UPDATE workspace_members
     SET status = 'suspended', updated_at = NOW()
     WHERE workspace_id = $1 AND user_id = $2`,
    [targetWorkspaceId, ownerId],
  )
  const revoked = await pool.query(
    `UPDATE auth_sessions AS session
     SET revoked_at = NOW(), revoke_reason = 'workspace_access_lost'
     WHERE session.id = $1
       AND session.revoked_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM workspace_members AS membership
         JOIN workspaces AS workspace
           ON workspace.id = membership.workspace_id
         WHERE membership.workspace_id = session.workspace_id
           AND membership.user_id = session.user_id
           AND membership.status = 'active'
           AND workspace.status = 'active'
           AND workspace.deleted_at IS NULL
       )
     RETURNING revoke_reason AS reason`,
    [membershipSession.rows[0].id],
  )
  if (revoked.rows[0]?.reason !== 'workspace_access_lost') {
    throw new Error('Inactive membership did not revoke the session.')
  }

  const rollback = await readFile(resolve(migrationsDir, rollbackFile), 'utf8')
  await pool.query(rollback)
  const reverse = await pool.query(
    `SELECT
       TO_REGPROCEDURE(
         'change_auth_session_workspace(text,text,bigint,timestamp with time zone)'
       ) IS NULL AS removed,
       NOT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'auth_sessions'
           AND column_name = 'previous_token_authorizes'
       ) AS "columnRemoved"`,
  )
  if (
    reverse.rows[0]?.removed !== true
    || reverse.rows[0]?.columnRemoved !== true
  ) {
    throw new Error('Workspace session switch reverse path was incomplete.')
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'workspace_switch_single_winner',
      'workspace_switch_rotates_token',
      'workspace_switch_audited',
      'old_token_replay_rejected',
      'foreign_workspace_rejected',
      'revoke_dominates_workspace_switch',
      'inactive_membership_revokes_session',
      'clean_reverse',
    ],
  }))
} finally {
  await pool.end()
}

async function insertVerifiedUser(email) {
  const result = await pool.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at,
       created_at,
       updated_at
     )
     VALUES ($1, $1, NOW(), NOW(), NOW())
     RETURNING id::TEXT AS id`,
    [email],
  )
  return result.rows[0].id
}

async function ensureWorkspace(userId) {
  const result = await pool.query(
    'SELECT ensure_auth_user_workspace($1)::TEXT AS id',
    [userId],
  )
  return result.rows[0].id
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}
