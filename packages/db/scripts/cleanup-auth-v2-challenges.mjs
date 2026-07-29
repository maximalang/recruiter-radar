import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const apply = process.argv.includes('--apply')
const retentionDays = parseBoundedInteger(
  process.env.AUTH_CHALLENGE_RETENTION_DAYS,
  14,
  1,
  90,
  'AUTH_CHALLENGE_RETENTION_DAYS',
)
const batchSize = parseBoundedInteger(
  process.env.AUTH_CHALLENGE_CLEANUP_BATCH_SIZE,
  500,
  1,
  10_000,
  'AUTH_CHALLENGE_CLEANUP_BATCH_SIZE',
)
const maxBatches = parseBoundedInteger(
  process.env.AUTH_CHALLENGE_CLEANUP_MAX_BATCHES,
  20,
  1,
  1_000,
  'AUTH_CHALLENGE_CLEANUP_MAX_BATCHES',
)

if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 10_000,
})

try {
  if (!apply) {
    const eligible = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM auth_challenges
       WHERE (
           consumed_at IS NOT NULL
           OR invalidated_at IS NOT NULL
           OR expires_at <= clock_timestamp()
         )
         AND COALESCE(consumed_at, invalidated_at, expires_at)
           < clock_timestamp() - MAKE_INTERVAL(days => $1)`,
      [retentionDays],
    )
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      retentionDays,
      eligible: eligible.rows[0]?.count ?? 0,
      deleted: 0,
      bounded: true,
    }))
  } else {
    let deleted = 0
    let batches = 0
    while (batches < maxBatches) {
      const result = await pool.query(
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
        [retentionDays, batchSize],
      )
      const count = result.rows[0]?.count ?? 0
      deleted += count
      batches += 1
      if (count < batchSize) break
    }
    console.log(JSON.stringify({
      ok: true,
      mode: 'apply',
      retentionDays,
      deleted,
      batches,
      bounded: batches <= maxBatches,
    }))
  }
} finally {
  await pool.end()
}

function parseBoundedInteger(raw, fallback, minimum, maximum, name) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}
