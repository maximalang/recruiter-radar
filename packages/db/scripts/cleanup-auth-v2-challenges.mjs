import pg from 'pg'

const { Pool } = pg
const ADVISORY_LOCK_KEY = 2_026_073_005
const startedAt = Date.now()
const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run'

let pool
let client
let lockAcquired = false
let report = failureReport('cleanup_failed')

try {
  const config = readConfiguration()
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 2,
    connectionTimeoutMillis: 10_000,
  })
  client = await pool.connect()

  const lock = await client.query(
    'SELECT pg_try_advisory_lock($1) AS acquired',
    [ADVISORY_LOCK_KEY],
  )
  lockAcquired = lock.rows[0]?.acquired === true
  if (!lockAcquired) {
    report = failureReport('lock_unavailable', config.retentionDays)
  } else {
    const before = await countChallenges(client, config.retentionDays)
    if (mode === 'dry-run') {
      report = {
        ok: true,
        mode,
        retentionDays: config.retentionDays,
        scanned: before.scanned,
        eligible: before.eligible,
        deleted: 0,
        remaining: before.eligible,
        batches: 0,
        bounded: true,
      }
    } else {
      const deletion = await deleteChallenges(client, config)
      const after = await countChallenges(client, config.retentionDays)
      report = {
        ok: true,
        mode,
        retentionDays: config.retentionDays,
        scanned: before.scanned,
        eligible: before.eligible,
        deleted: deletion.deleted,
        remaining: after.eligible,
        batches: deletion.batches,
        bounded: deletion.batches <= config.maxBatches,
      }
    }
  }
} catch {
  report = failureReport('cleanup_failed')
} finally {
  if (client) {
    if (lockAcquired) {
      try {
        const unlock = await client.query(
          'SELECT pg_advisory_unlock($1) AS released',
          [ADVISORY_LOCK_KEY],
        )
        if (unlock.rows[0]?.released !== true) {
          report = failureReport('lock_release_failed')
        }
      } catch {
        report = failureReport('lock_release_failed')
      }
    }
    client.release()
  }
  if (pool) {
    try {
      await pool.end()
    } catch {
      report = failureReport('cleanup_shutdown_failed')
    }
  }
}

report.durationMs = Date.now() - startedAt
console.log(JSON.stringify(report))
if (!report.ok) process.exitCode = 1

function readConfiguration() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is required.')

  return {
    databaseUrl,
    retentionDays: parseBoundedInteger(
      process.env.AUTH_CHALLENGE_RETENTION_DAYS,
      14,
      1,
      90,
      'AUTH_CHALLENGE_RETENTION_DAYS',
    ),
    batchSize: parseBoundedInteger(
      process.env.AUTH_CHALLENGE_CLEANUP_BATCH_SIZE,
      500,
      1,
      10_000,
      'AUTH_CHALLENGE_CLEANUP_BATCH_SIZE',
    ),
    maxBatches: parseBoundedInteger(
      process.env.AUTH_CHALLENGE_CLEANUP_MAX_BATCHES,
      20,
      1,
      1_000,
      'AUTH_CHALLENGE_CLEANUP_MAX_BATCHES',
    ),
  }
}

async function countChallenges(connection, retentionDays) {
  const result = await connection.query(
    `SELECT
       COUNT(*)::INTEGER AS scanned,
       COUNT(*) FILTER (
         WHERE (
             consumed_at IS NOT NULL
             OR invalidated_at IS NOT NULL
             OR expires_at <= clock_timestamp()
           )
           AND COALESCE(consumed_at, invalidated_at, expires_at)
             < clock_timestamp() - MAKE_INTERVAL(days => $1)
       )::INTEGER AS eligible
     FROM auth_challenges`,
    [retentionDays],
  )
  return {
    scanned: result.rows[0]?.scanned ?? 0,
    eligible: result.rows[0]?.eligible ?? 0,
  }
}

async function deleteChallenges(connection, config) {
  let deleted = 0
  let batches = 0
  while (batches < config.maxBatches) {
    const result = await connection.query(
      `WITH candidates AS (
         SELECT id
         FROM auth_challenges
         WHERE (
             consumed_at IS NOT NULL
             OR invalidated_at IS NOT NULL
             OR expires_at <= clock_timestamp()
           )
           AND COALESCE(consumed_at, invalidated_at, expires_at)
             < clock_timestamp() - MAKE_INTERVAL(days => $1)
         ORDER BY id
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       ),
       removed AS (
         DELETE FROM auth_challenges AS challenge
         USING candidates
         WHERE challenge.id = candidates.id
         RETURNING challenge.id
       )
       SELECT COUNT(*)::INTEGER AS count FROM removed`,
      [config.retentionDays, config.batchSize],
    )
    const count = result.rows[0]?.count ?? 0
    deleted += count
    batches += 1
    if (count < config.batchSize) break
  }
  return { deleted, batches }
}

function failureReport(reason, retentionDays = null) {
  return {
    ok: false,
    mode,
    reason,
    retentionDays,
    scanned: 0,
    eligible: 0,
    deleted: 0,
    remaining: 0,
    batches: 0,
    bounded: true,
  }
}

function parseBoundedInteger(raw, fallback, minimum, maximum, name) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}
