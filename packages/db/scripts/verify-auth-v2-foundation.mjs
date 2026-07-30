import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const verificationCase = process.env.AUTH_V2_DB_CASE?.trim()
const migrationFile = '20260728120000_add_auth_platform_v2_foundation.sql'
const rollbackFile = '20260728120000_add_auth_platform_v2_foundation.down.sql'

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DB_TEST_ISOLATED !== 'true') {
  throw new Error('AUTH_V2_DB_TEST_ISOLATED=true is required.')
}
if (!['clean', 'upgrade', 'down'].includes(verificationCase)) {
  throw new Error('AUTH_V2_DB_CASE must be clean, upgrade, or down.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const database = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
})

await database.connect()
try {
  const databaseName = await database.query(
    'SELECT CURRENT_DATABASE() AS name',
  )
  if (!/^auth_v2_test_[a-z0-9_]+$/.test(databaseName.rows[0]?.name ?? '')) {
    throw new Error(
      'Refusing to run outside a database named auth_v2_test_<suffix>.',
    )
  }

  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()

  if (verificationCase === 'clean') {
    for (const filename of migrations) {
      if (filename > migrationFile) break
      await applySql(database, filename)
    }
    await assertFoundation(database, null)
  } else {
    for (const filename of migrations) {
      if (filename >= migrationFile) break
      await applySql(database, filename)
    }

    const fixture = await seedLegacyFixture(database)
    await applySql(database, migrationFile)
    await assertLegacyFixturePreserved(database, fixture)

    if (verificationCase === 'upgrade') {
      await assertFoundation(database, fixture.userId)
    } else {
      await assertFoundationTables(database, true)
      await assertRollbackGuard(database)
      await applySql(database, rollbackFile)
      await assertFoundationTables(database, false)
      await assertLegacyFixturePreserved(database, fixture)
      const normalizedColumn = await database.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'users'
           AND column_name = 'email_normalized'`,
      )
      if (normalizedColumn.rowCount !== 0) {
        throw new Error('Down migration retained users.email_normalized.')
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    case: verificationCase,
    checks: verificationCase === 'clean'
      ? [
          'clean_chain',
          'challenge_invariants',
          'session_invariants',
          'append_only_audit',
          'atomic_rate_limit',
        ]
      : verificationCase === 'down'
        ? ['legacy_preserved', 'guarded_down', 'v2_schema_removed']
        : [
          'legacy_preserved',
          'challenge_invariants',
          'session_invariants',
          'append_only_audit',
          'atomic_rate_limit',
        ],
  }))
} finally {
  await database.end()
}

async function applySql(client, filename) {
  const sql = await readFile(resolve(migrationsDir, filename), 'utf8')
  await client.query(sql)
}

async function seedLegacyFixture(client) {
  const suffix = `${process.pid}-${Date.now()}`
  const user = await client.query(
    `INSERT INTO users (email, full_name, email_verified_at)
     VALUES ($1, 'Auth v2 legacy fixture', NOW())
     RETURNING id::TEXT AS id`,
    [`auth-v2-legacy-${suffix}@example.invalid`],
  )
  const challenge = await client.query(
    `INSERT INTO account_login_challenges (
       user_id,
       token_hash,
       request_key_hash,
       return_to,
       send_status,
       expires_at
     )
     VALUES ($1, repeat('a', 64), repeat('b', 64), '/dashboard', 'sent', NOW() + INTERVAL '15 minutes')
     RETURNING id::TEXT AS id`,
    [user.rows[0].id],
  )
  return {
    userId: user.rows[0].id,
    challengeId: challenge.rows[0].id,
  }
}

async function assertLegacyFixturePreserved(client, fixture) {
  const result = await client.query(
    `SELECT
       users.id::TEXT AS "userId",
       challenge.id::TEXT AS "challengeId"
     FROM users
     JOIN account_login_challenges challenge
       ON challenge.user_id = users.id
     WHERE users.id = $1
       AND challenge.id = $2`,
    [fixture.userId, fixture.challengeId],
  )
  if (result.rowCount !== 1) {
    throw new Error('Legacy account login fixture was not preserved.')
  }
}

async function assertFoundation(client, existingUserId) {
  await assertFoundationTables(client, true)

  if (existingUserId) {
    const legacyIdentity = await client.query(
      'SELECT email_normalized FROM users WHERE id = $1',
      [existingUserId],
    )
    if (legacyIdentity.rows[0]?.email_normalized !== null) {
      throw new Error('Migration rewrote a legacy normalized identity.')
    }
  }

  const suffix = `${process.pid}-${Date.now()}`
  const email = `AuthV2-${suffix}@example.invalid`
  const user = await client.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at,
       last_authenticated_at
     )
     VALUES ($1, $1, NOW(), NOW())
     RETURNING id::TEXT AS id`,
    [email],
  )

  await client.query(
    `INSERT INTO auth_challenges (
       purpose,
       email_normalized,
       token_hash,
       return_to,
       send_status,
       expires_at
     )
     VALUES ('signup', $1, repeat('c', 64), '/dashboard', 'sent', NOW() + INTERVAL '15 minutes')`,
    [`Pending-${suffix}@example.invalid`],
  )

  let duplicateRejected = false
  try {
    await client.query(
      `INSERT INTO auth_challenges (
         purpose,
         email_normalized,
         token_hash,
         return_to,
         send_status,
         expires_at
       )
       VALUES ('signup', $1, repeat('d', 64), '/dashboard', 'sent', NOW() + INTERVAL '15 minutes')`,
      [`Pending-${suffix}@example.invalid`],
    )
  } catch (error) {
    duplicateRejected = error?.code === '23505'
  }
  if (!duplicateRejected) {
    throw new Error('Two active challenges were accepted for one identity.')
  }

  const session = await client.query(
    `INSERT INTO auth_sessions (
       user_id,
       token_hash,
       idle_expires_at,
       absolute_expires_at
     )
     VALUES (
       $1,
       repeat('e', 64),
       NOW() + INTERVAL '14 days',
       NOW() + INTERVAL '30 days'
     )
     RETURNING id::TEXT AS id`,
    [user.rows[0].id],
  )

  const event = await client.query(
    `INSERT INTO auth_security_events (
       event_type,
       user_id,
       session_id,
       subject_hash,
       metadata
     )
     VALUES (
         'session_created',
         $1,
         $2,
         repeat('f', 64),
         '{"source":"db_verifier"}'::JSONB
     )
     RETURNING id::TEXT AS id`,
    [user.rows[0].id, session.rows[0].id],
  )

  let mutationRejected = false
  try {
    await client.query(
      `UPDATE auth_security_events
       SET metadata = '{}'::JSONB
       WHERE id = $1`,
      [event.rows[0].id],
    )
  } catch (error) {
    mutationRejected = error?.message?.includes(
      'auth_security_events is append-only',
    )
  }
  if (!mutationRejected) {
    throw new Error('Security event mutation was not rejected.')
  }

  let sensitiveMetadataRejected = false
  try {
    await client.query(
      `INSERT INTO auth_security_events (
         event_type,
         user_id,
         metadata
       )
       VALUES (
         'login_failed',
         $1,
         '{"reason_code":"raw@example.invalid"}'::JSONB
       )`,
      [user.rows[0].id],
    )
  } catch (error) {
    sensitiveMetadataRejected = error?.code === '23514'
  }
  if (!sensitiveMetadataRejected) {
    throw new Error('Sensitive audit metadata was accepted.')
  }

  await client.query(
    `INSERT INTO auth_security_events (
       event_type,
       user_id,
       subject_hash
     )
     VALUES ('legacy_session_migrated', $1, repeat('8', 64))`,
    [user.rows[0].id],
  )
  let duplicateLegacyExchangeRejected = false
  try {
    await client.query(
      `INSERT INTO auth_security_events (
         event_type,
         user_id,
         subject_hash
       )
       VALUES ('legacy_session_migrated', $1, repeat('8', 64))`,
      [user.rows[0].id],
    )
  } catch (error) {
    duplicateLegacyExchangeRejected = error?.code === '23505'
  }
  if (!duplicateLegacyExchangeRejected) {
    throw new Error('Legacy exchange fingerprint was accepted twice.')
  }

  let nullLegacyExchangeRejected = false
  try {
    await client.query(
      `INSERT INTO auth_security_events (
         event_type,
         user_id
       )
       VALUES ('legacy_session_migrated', $1)`,
      [user.rows[0].id],
    )
  } catch (error) {
    nullLegacyExchangeRejected = error?.code === '23514'
  }
  if (!nullLegacyExchangeRejected) {
    throw new Error('Null legacy exchange fingerprint was accepted.')
  }

  let truncateRejected = false
  try {
    await client.query('TRUNCATE auth_security_events')
  } catch (error) {
    truncateRejected = error?.message?.includes(
      'auth_security_events is append-only',
    )
  }
  if (!truncateRejected) {
    throw new Error('Security event truncation was not rejected.')
  }

  const firstRateHit = await client.query(
    `SELECT consume_auth_rate_limit(
       'email_hash',
       repeat('7', 64),
       60,
       1,
       '2026-01-01T00:00:01Z'::TIMESTAMPTZ
     ) AS allowed`,
  )
  const secondRateHit = await client.query(
    `SELECT consume_auth_rate_limit(
       'email_hash',
       repeat('7', 64),
       60,
       1,
       '2026-01-01T00:00:59Z'::TIMESTAMPTZ
     ) AS allowed`,
  )
  const rateBucket = await client.query(
    `SELECT hit_count AS "hitCount"
     FROM auth_rate_limit_buckets
     WHERE bucket_scope = 'email_hash'
       AND key_hash = repeat('7', 64)`,
  )
  if (
    firstRateHit.rows[0]?.allowed !== true
    || secondRateHit.rows[0]?.allowed !== false
    || rateBucket.rowCount !== 1
    || rateBucket.rows[0]?.hitCount !== 2
  ) {
    throw new Error('Rate limit bucket was not atomically enforced.')
  }
}

async function assertFoundationTables(client, expected) {
  const tables = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::TEXT[])`,
    [[
      'auth_challenges',
      'auth_sessions',
      'auth_security_events',
      'auth_rate_limit_buckets',
    ]],
  )
  if ((tables.rowCount === 4) !== expected) {
    throw new Error(
      expected
        ? 'Auth v2 foundation tables are incomplete.'
        : 'Auth v2 foundation tables remain after down migration.',
    )
  }
}

async function assertRollbackGuard(client) {
  await client.query(
    `INSERT INTO auth_challenges (
       purpose,
       email_normalized,
       token_hash,
       return_to,
       expires_at
     )
     VALUES (
       'signup',
       'rollback-guard@example.invalid',
       repeat('9', 64),
       '/dashboard',
       NOW() + INTERVAL '15 minutes'
     )`,
  )

  let refused = false
  try {
    await applySql(client, rollbackFile)
  } catch (error) {
    refused = error?.message?.includes('auth v2 rollback refused')
    await client.query('ROLLBACK').catch(() => undefined)
  }
  if (!refused) {
    throw new Error('Down migration did not refuse to discard auth v2 data.')
  }

  await client.query(
    `DELETE FROM auth_challenges
     WHERE email_normalized = 'rollback-guard@example.invalid'`,
  )
}
