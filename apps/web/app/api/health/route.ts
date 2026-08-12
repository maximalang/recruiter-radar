import { NextResponse } from 'next/server';

import { getPool } from '../../../lib/db-pool';
import {
  configurationReadiness,
  EXPECTED_LATEST_MIGRATION,
  readDeploySha,
} from '../../../lib/health-readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
  const timestamp = new Date().toISOString();

  let database: 'ok' | 'error' = 'ok';
  let migrations: 'current' | 'pending' | 'unknown' = 'unknown';
  let redis: 'ok' | 'unavailable' | 'error' = 'ok';

  // DB check
  const pool = getPool();
  if (pool) {
    try {
      await pool.query('SELECT 1');
      const migration = await pool.query<{ current: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM schema_migrations
           WHERE version = $1
         ) AS current`,
        [EXPECTED_LATEST_MIGRATION],
      );
      migrations = migration.rows[0]?.current === true ? 'current' : 'pending';
    } catch {
      database = 'error';
    }
  } else {
    database = 'error';
  }

  // Redis check (optional — REDIS_URL may not be set)
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    redis = 'unavailable';
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require('ioredis') as new (url: string, opts: Record<string, unknown>) => { ping: () => Promise<string>; quit: () => Promise<void> };
      const client = new IORedis(redisUrl, {
        connectTimeout: 2_000,
        maxRetriesPerRequest: 1,
        lazyConnect: false,
      });
      await client.ping();
      await client.quit();
    } catch {
      redis = 'error';
    }
  }

  const healthy = database === 'ok' && migrations === 'current' && redis !== 'error';
  const status = healthy ? 'healthy' : 'unhealthy';

  return NextResponse.json(
    {
      status,
      db: database,
      redis,
      version: { deploySha: readDeploySha() },
      checks: {
        database,
        migrations,
        configuration: configurationReadiness(),
        redis,
      },
      timestamp,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
