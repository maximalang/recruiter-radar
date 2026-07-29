import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const targetMigration = '20260729120000_add_auth_workspaces.sql'
const rollbackFile = '20260729120000_add_auth_workspaces.down.sql'

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DB_TEST_ISOLATED !== 'true') {
  throw new Error('AUTH_V2_DB_TEST_ISOLATED=true is required.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const pool = new Pool({ connectionString: databaseUrl, max: 8 })

try {
  const databaseName = await pool.query('SELECT CURRENT_DATABASE() AS name')
  if (!/^auth_v2_test_workspaces_[a-z0-9_]+$/.test(
    databaseName.rows[0]?.name ?? '',
  )) {
    throw new Error('Refusing to run outside auth_v2_test_workspaces_<suffix>.')
  }

  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
  for (const filename of migrations) {
    if (filename > targetMigration) break
    await pool.query(await readFile(resolve(migrationsDir, filename), 'utf8'))
  }

  const bootstrapUser = await insertVerifiedUser(
    'workspace-bootstrap@example.invalid',
  )
  const concurrent = await Promise.all([
    ensureWorkspace(bootstrapUser),
    ensureWorkspace(bootstrapUser),
    ensureWorkspace(bootstrapUser),
  ])
  if (new Set(concurrent).size !== 1) {
    throw new Error('Concurrent workspace bootstrap created multiple workspaces.')
  }
  const bootstrapState = await pool.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER
        FROM workspaces
        WHERE bootstrap_user_id = $1) AS workspaces,
       (SELECT COUNT(*)::INTEGER
        FROM workspace_members
        WHERE user_id = $1
          AND role = 'owner'
          AND status = 'active') AS memberships,
       (SELECT COUNT(*)::INTEGER
        FROM auth_security_events
        WHERE user_id = $1
          AND event_type = 'workspace_created') AS events`,
    [bootstrapUser],
  )
  if (
    bootstrapState.rows[0]?.workspaces !== 1
    || bootstrapState.rows[0]?.memberships !== 1
    || bootstrapState.rows[0]?.events !== 1
  ) {
    throw new Error('Workspace bootstrap was not atomic and idempotent.')
  }

  const challengeHash = digest('workspace-consume-challenge')
  const issued = await issue(
    'workspace-consume@example.invalid',
    challengeHash,
  )
  if (!issued) throw new Error('Workspace consume challenge was not issued.')
  const consumed = await consume(
    challengeHash,
    digest('workspace-consume-session'),
  )
  const consumeState = await pool.query(
    `SELECT
       session.workspace_id::TEXT AS "workspaceId",
       membership.role,
       membership.status
     FROM auth_sessions AS session
     JOIN workspace_members AS membership
       ON membership.workspace_id = session.workspace_id
      AND membership.user_id = session.user_id
     WHERE session.id = $1`,
    [consumed.sessionId],
  )
  if (
    !consumed.consumed
    || !consumeState.rows[0]?.workspaceId
    || consumeState.rows[0]?.role !== 'owner'
    || consumeState.rows[0]?.status !== 'active'
  ) {
    throw new Error('Challenge consume did not create a scoped workspace.')
  }

  const foreignUser = await insertVerifiedUser(
    'workspace-foreign@example.invalid',
  )
  const foreignWorkspace = await ensureWorkspace(foreignUser)
  let membershipRejected = false
  try {
    await pool.query(
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
       )`,
      [bootstrapUser, foreignWorkspace, digest('foreign-workspace-session')],
    )
  } catch {
    membershipRejected = true
  }
  if (!membershipRejected) {
    throw new Error('A session accepted a foreign workspace.')
  }

  await pool.query(
    `INSERT INTO workspace_invites (
       workspace_id,
       email_normalized,
       role,
       token_hash,
       invited_by,
       expires_at
     )
     VALUES ($1, $2, 'viewer', $3, $4, NOW() + INTERVAL '1 day')`,
    [
      concurrent[0],
      'guard@example.invalid',
      digest('workspace-rollback-guard'),
      bootstrapUser,
    ],
  )
  const rollback = await readFile(resolve(migrationsDir, rollbackFile), 'utf8')
  let rollbackGuarded = false
  try {
    await pool.query(rollback)
  } catch (error) {
    rollbackGuarded = String(error).includes('workspace rollback refused')
    await pool.query('ROLLBACK').catch(() => {})
  }
  if (!rollbackGuarded) {
    throw new Error('Workspace reverse migration did not guard collaboration.')
  }

  await pool.query('DELETE FROM workspace_invites')
  await pool.query(rollback)
  const reverseState = await pool.query(
    `SELECT
       TO_REGCLASS('public.workspaces') IS NULL AS workspaces_removed,
       TO_REGCLASS('public.workspace_members') IS NULL AS members_removed,
       TO_REGCLASS('public.workspace_invites') IS NULL AS invites_removed,
       NOT EXISTS (
         SELECT 1
         FROM auth_sessions
         WHERE workspace_id IS NOT NULL
       ) AS sessions_cleared`,
  )
  if (
    reverseState.rows[0]?.workspaces_removed !== true
    || reverseState.rows[0]?.members_removed !== true
    || reverseState.rows[0]?.invites_removed !== true
    || reverseState.rows[0]?.sessions_cleared !== true
  ) {
    throw new Error('Clean workspace reverse migration was incomplete.')
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'workspace_schema',
      'concurrent_workspace_bootstrap',
      'challenge_consume_workspace',
      'session_membership_guard',
      'workspace_reverse_guard',
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
    `SELECT ensure_auth_user_workspace($1)::TEXT AS id`,
    [userId],
  )
  return result.rows[0].id
}

async function issue(email, challengeHash) {
  const result = await pool.query(
    `SELECT issued
     FROM issue_auth_login_challenge($1, $2, '/dashboard', $3, $4, $5, $6)`,
    [
      email,
      challengeHash,
      digest(`global:${email}`),
      digest(`email:${email}`),
      digest(`ip:${email}`),
      digest(`agent:${email}`),
    ],
  )
  return result.rows[0]?.issued === true
}

async function consume(challengeHash, sessionHash) {
  const result = await pool.query(
    `SELECT
       consumed,
       user_id::TEXT AS "userId",
       session_id::TEXT AS "sessionId"
     FROM consume_auth_login_challenge($1, $2, $3, $4, $5)`,
    [
      challengeHash,
      sessionHash,
      digest('workspace-consume-global'),
      digest('workspace-consume-verifier'),
      null,
    ],
  )
  return result.rows[0]
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}
