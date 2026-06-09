import { NextResponse } from 'next/server';

import { getPool } from '../../../lib/db-pool';

export const dynamic = 'force-dynamic';

export async function GET() {
  const timestamp = new Date().toISOString();

  let db: 'ok' | 'error' = 'ok';
  let redis: 'ok' | 'unavailable' | 'error' = 'ok';

  // DB check
  const pool = getPool();
  if (pool) {
    try {
      await pool.query('SELECT 1');
    } catch {
      db = 'error';
    }
  } else {
    db = 'error';
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

  const healthy = db === 'ok' && redis !== 'error';
  const status = healthy ? 'healthy' : 'unhealthy';

  return NextResponse.json(
    { status, db, redis, timestamp },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}