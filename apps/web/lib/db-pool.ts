/**
 * Shared Postgres Pool singleton.
 *
 * Previously each module (db, payments, digest, digestFeedback, clientProfiles,
 * telegramConnect, clientProfileSignalOutcomes, scoring/client-overrides) created
 * its own Pool via `new Pool({ connectionString })`. With the default pool size of
 * 10, this meant 80+ connections per Next.js worker. This module provides a single
 * shared Pool to reduce connection count and avoid connection-exhaustion under load.
 *
 * Usage:
 *   import { getPool } from '@/lib/db-pool'
 *   const pool = getPool()
 *   if (!pool) throw new Error('DATABASE_URL is not set.')
 *   const result = await pool.query(...)
 */

import { Pool, type PoolClient } from 'pg'

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarSharedPool?: Pool
}

/**
 * Returns the shared Postgres Pool, or null if DATABASE_URL is not set.
 *
 * The Pool is cached on `globalThis` so it survives HMR during development.
 * In production each Next.js worker creates exactly one Pool.
 */
export function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return null

  if (!globalForPg.recruiterRadarSharedPool) {
    globalForPg.recruiterRadarSharedPool = new Pool({ connectionString })
  }
  return globalForPg.recruiterRadarSharedPool
}

/**
 * Acquire a client from the shared pool for transactional work.
 * Caller MUST call `client.release()` in a finally block.
 */
export async function getClient(): Promise<PoolClient | null> {
  const pool = getPool()
  if (!pool) return null
  return pool.connect()
}
