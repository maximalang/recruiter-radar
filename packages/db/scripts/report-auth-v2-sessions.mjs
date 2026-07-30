import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 30_000,
})

try {
  await pool.query('BEGIN TRANSACTION READ ONLY')
  const result = await pool.query(`
    SELECT
      JSON_BUILD_OBJECT(
        'total', COUNT(*)::INTEGER,
        'active', COUNT(*) FILTER (
          WHERE revoked_at IS NULL
            AND idle_expires_at > NOW()
            AND absolute_expires_at > NOW()
        )::INTEGER,
        'revoked', COUNT(*) FILTER (
          WHERE revoked_at IS NOT NULL
        )::INTEGER,
        'expired', COUNT(*) FILTER (
          WHERE revoked_at IS NULL
            AND (
              idle_expires_at <= NOW()
              OR absolute_expires_at <= NOW()
            )
        )::INTEGER,
        'rotationDue', COUNT(*) FILTER (
          WHERE revoked_at IS NULL
            AND idle_expires_at > NOW()
            AND absolute_expires_at > NOW()
            AND rotated_at <= NOW() - INTERVAL '24 hours'
        )::INTEGER,
        'withoutWorkspace', COUNT(*) FILTER (
          WHERE workspace_id IS NULL
        )::INTEGER
      ) AS sessions,
      (
        SELECT COALESCE(
          JSON_OBJECT_AGG(event_group.key, event_group.count),
          '{}'::JSON
        )
        FROM (
          SELECT event_type || ':' || outcome AS key,
                 COUNT(*)::INTEGER AS count
          FROM auth_security_events
          WHERE created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY event_type, outcome
          ORDER BY event_type, outcome
        ) AS event_group
      ) AS "eventsLast24Hours",
      (
        SELECT COALESCE(
          JSON_OBJECT_AGG(bucket_scope, count),
          '{}'::JSON
        )
        FROM (
          SELECT bucket_scope, COUNT(*)::INTEGER AS count
          FROM auth_rate_limit_buckets
          WHERE expires_at > NOW()
          GROUP BY bucket_scope
          ORDER BY bucket_scope
        ) AS active_bucket
      ) AS "activeRateLimitBuckets",
      (
        SELECT COUNT(*)::INTEGER
        FROM auth_rate_limit_buckets
        WHERE expires_at > NOW()
          AND hit_count >= CASE bucket_scope
            WHEN 'global' THEN
              CASE
                WHEN expires_at - window_started_at <= INTERVAL '2 minutes'
                  THEN 100
                ELSE 1000
              END
            WHEN 'email_hash' THEN 3
            WHEN 'trusted_ip_hash' THEN 10
            WHEN 'resend' THEN 3
            WHEN 'challenge_verify' THEN 10
            WHEN 'passkey_verify' THEN 10
            WHEN 'workspace_invite' THEN 3
            ELSE 1
          END
      ) AS "saturatedRateLimitBuckets",
      (
        SELECT COUNT(*)::INTEGER
        FROM auth_challenges
        WHERE consumed_at IS NULL
          AND invalidated_at IS NULL
          AND expires_at <= NOW()
      ) AS "expiredOpenChallenges"
    FROM auth_sessions
  `)
  await pool.query('COMMIT')

  const row = result.rows[0]
  const alerts = {
    rotationBacklog: row.sessions.rotationDue > 0,
    workspaceBackfillIncomplete: row.sessions.withoutWorkspace > 0,
    saturatedRateLimits: row.saturatedRateLimitBuckets > 0,
    expiredChallengeCleanupDue: row.expiredOpenChallenges > 0,
  }
  const ok = !Object.values(alerts).some(Boolean)
  console.log(JSON.stringify({
    ok,
    generatedAt: new Date().toISOString(),
    sessions: row.sessions,
    eventsLast24Hours: row.eventsLast24Hours,
    rateLimits: {
      activeBuckets: row.activeRateLimitBuckets,
      saturatedBuckets: row.saturatedRateLimitBuckets,
    },
    challenges: {
      expiredOpen: row.expiredOpenChallenges,
    },
    alerts,
  }))
  if (!ok) process.exitCode = 1
} catch (error) {
  await pool.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  await pool.end()
}
