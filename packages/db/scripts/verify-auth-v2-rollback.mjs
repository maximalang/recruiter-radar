import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const verificationCase = process.env.AUTH_V2_ROLLBACK_CASE?.trim()
const targetMigration = '20260728122000_add_auth_challenge_consumption.sql'
const reverseMigrations = [
  '20260728122000_add_auth_challenge_consumption.down.sql',
  '20260728121000_add_auth_challenge_issuance.down.sql',
  '20260728120000_add_auth_platform_v2_foundation.down.sql',
]

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DB_TEST_ISOLATED !== 'true') {
  throw new Error('AUTH_V2_DB_TEST_ISOLATED=true is required.')
}
if (!['clean', 'guard'].includes(verificationCase)) {
  throw new Error('AUTH_V2_ROLLBACK_CASE must be clean or guard.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const database = new Client({ connectionString: databaseUrl })

await database.connect()
try {
  const databaseName = await database.query('SELECT CURRENT_DATABASE() AS name')
  if (!/^auth_v2_test_rollback_[a-z0-9_]+$/.test(
    databaseName.rows[0]?.name ?? '',
  )) {
    throw new Error(
      'Refusing to run outside auth_v2_test_rollback_<suffix>.',
    )
  }

  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
  for (const filename of migrations) {
    if (filename > targetMigration) break
    await applySql(filename)
  }

  if (verificationCase === 'guard') {
    const user = await database.query(
      `INSERT INTO users (email, email_normalized, email_verified_at)
       VALUES (
         'rollback-session@example.invalid',
         'rollback-session@example.invalid',
         NOW()
       )
       RETURNING id`,
    )
    await database.query(
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
       VALUES (
         $1,
         repeat('8', 64),
         'magic_link',
         NOW(),
         NOW(),
         NOW() + INTERVAL '14 days',
         NOW() + INTERVAL '30 days',
         NOW(),
         NOW()
       )`,
      [user.rows[0].id],
    )

    let refused = false
    try {
      await applySql(reverseMigrations[0])
    } catch (error) {
      refused = error?.message?.includes(
        'auth v2 challenge consumption rollback refused',
      )
      await database.query('ROLLBACK').catch(() => undefined)
    }
    const columns = await database.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'auth_sessions'
         AND column_name IN ('auth_method', 'device_label')`,
    )
    if (!refused || columns.rowCount !== 2) {
      throw new Error('Reverse-chain rollback discarded live session data.')
    }
  } else {
    for (const filename of reverseMigrations) await applySql(filename)
    const tables = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'auth_challenges',
           'auth_sessions',
           'auth_security_events',
           'auth_rate_limit_buckets'
         )`,
    )
    const functionResult = await database.query(
      `SELECT 1
       FROM pg_proc
       WHERE proname IN (
         'issue_auth_login_challenge',
         'consume_auth_login_challenge'
       )`,
    )
    if (tables.rowCount !== 0 || functionResult.rowCount !== 0) {
      throw new Error('Clean reverse chain retained auth v2 objects.')
    }
  }

  console.log(JSON.stringify({
    ok: true,
    case: verificationCase,
    checks: verificationCase === 'guard'
      ? ['live_session_rollback_refused', 'session_columns_preserved']
      : ['full_reverse_chain', 'v2_objects_removed'],
  }))
} finally {
  await database.end()
}

async function applySql(filename) {
  const sql = await readFile(resolve(migrationsDir, filename), 'utf8')
  await database.query(sql)
}
