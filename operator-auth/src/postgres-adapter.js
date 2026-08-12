import pg from 'pg'

const { Pool } = pg

const SCHEMA = 'operator_auth'

function assertDatabaseUrl(value) {
  if (!value) throw new Error('RR_MCP_AUTH_DATABASE_URL is required')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('RR_MCP_AUTH_DATABASE_URL must be PostgreSQL')
  }
  return value
}

export function createAuthPool(connectionString = process.env.RR_MCP_AUTH_DATABASE_URL) {
  return new Pool({
    connectionString: assertDatabaseUrl(connectionString),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'rr_operator_auth',
  })
}

function rowPayload(row) {
  if (!row) return undefined
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return undefined
  const payload = row.payload
  if (row.consumed_at) payload.consumed = Math.floor(new Date(row.consumed_at).getTime() / 1000)
  return payload
}

export function createPostgresAdapter(pool) {
  return class PostgresAdapter {
    constructor(name) {
      this.name = name
    }

    async upsert(id, payload, expiresIn) {
      const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000)
        : null
      await pool.query(
        `INSERT INTO ${SCHEMA}.oidc_store
          (model, id, payload, expires_at, consumed_at, grant_id, user_code, uid)
         VALUES ($1, $2, $3::jsonb, $4, NULL, $5, $6, $7)
         ON CONFLICT (model, id) DO UPDATE SET
           payload = EXCLUDED.payload,
           expires_at = EXCLUDED.expires_at,
           consumed_at = NULL,
           grant_id = EXCLUDED.grant_id,
           user_code = EXCLUDED.user_code,
           uid = EXCLUDED.uid`,
        [
          this.name,
          id,
          JSON.stringify(payload),
          expiresAt,
          payload.grantId ?? null,
          payload.userCode ?? null,
          payload.uid ?? null,
        ],
      )
    }

    async find(id) {
      const { rows } = await pool.query(
        `SELECT payload, expires_at, consumed_at
           FROM ${SCHEMA}.oidc_store
          WHERE model = $1 AND id = $2`,
        [this.name, id],
      )
      return rowPayload(rows[0])
    }

    async findByUserCode(userCode) {
      const { rows } = await pool.query(
        `SELECT payload, expires_at, consumed_at
           FROM ${SCHEMA}.oidc_store
          WHERE model = $1 AND user_code = $2
          ORDER BY expires_at DESC NULLS LAST
          LIMIT 1`,
        [this.name, userCode],
      )
      return rowPayload(rows[0])
    }

    async findByUid(uid) {
      const { rows } = await pool.query(
        `SELECT payload, expires_at, consumed_at
           FROM ${SCHEMA}.oidc_store
          WHERE model = $1 AND uid = $2
          ORDER BY expires_at DESC NULLS LAST
          LIMIT 1`,
        [this.name, uid],
      )
      return rowPayload(rows[0])
    }

    async consume(id) {
      await pool.query(
        `UPDATE ${SCHEMA}.oidc_store
            SET consumed_at = COALESCE(consumed_at, NOW())
          WHERE model = $1 AND id = $2`,
        [this.name, id],
      )
    }

    async destroy(id) {
      await pool.query(
        `DELETE FROM ${SCHEMA}.oidc_store WHERE model = $1 AND id = $2`,
        [this.name, id],
      )
    }

    async revokeByGrantId(grantId) {
      await pool.query(
        `DELETE FROM ${SCHEMA}.oidc_store WHERE model = $1 AND grant_id = $2`,
        [this.name, grantId],
      )
    }
  }
}

export async function assertAuthStorageReady(pool) {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('${SCHEMA}.oidc_store') IS NOT NULL AS oidc_store,
      to_regclass('${SCHEMA}.login_throttle') IS NOT NULL AS login_throttle
  `)
  if (!rows[0]?.oidc_store || !rows[0]?.login_throttle) {
    throw new Error('operator_auth storage is not bootstrapped')
  }
}

export async function cleanupExpiredAuthState(pool) {
  await pool.query(
    `DELETE FROM ${SCHEMA}.oidc_store
      WHERE expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL '5 minutes'`,
  )
  await pool.query(
    `DELETE FROM ${SCHEMA}.login_throttle
      WHERE updated_at < NOW() - INTERVAL '24 hours'`,
  )
}

export async function getLoginThrottle(pool, keys) {
  const { rows } = await pool.query(
    `SELECT throttle_key, failures, locked_until
       FROM ${SCHEMA}.login_throttle
      WHERE throttle_key = ANY($1::text[])`,
    [keys],
  )
  return rows
}

export async function recordLoginFailure(pool, keys) {
  await pool.query('BEGIN')
  try {
    for (const key of keys) {
      await pool.query(
        `INSERT INTO ${SCHEMA}.login_throttle
           (throttle_key, failures, locked_until, updated_at)
         VALUES ($1, 1, NULL, NOW())
         ON CONFLICT (throttle_key) DO UPDATE SET
           failures = ${SCHEMA}.login_throttle.failures + 1,
           locked_until = CASE
             WHEN ${SCHEMA}.login_throttle.failures + 1 >= 5
             THEN NOW() + make_interval(secs => LEAST(3600, 30 * power(2, LEAST(7, ${SCHEMA}.login_throttle.failures - 4)))::int)
             ELSE ${SCHEMA}.login_throttle.locked_until
           END,
           updated_at = NOW()`,
        [key],
      )
    }
    await pool.query('COMMIT')
  } catch (error) {
    await pool.query('ROLLBACK')
    throw error
  }
}

export async function clearLoginThrottle(pool, keys) {
  await pool.query(
    `DELETE FROM ${SCHEMA}.login_throttle WHERE throttle_key = ANY($1::text[])`,
    [keys],
  )
}
