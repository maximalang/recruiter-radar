/**
 * Unified rate limiter — sliding-window per-key and per-host variants.
 *
 * Redis-backed when `ioredis` is installed and `REDIS_URL` is set;
 * in-memory fallback for single-instance / CLI usage.
 */

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_REQUESTS = 60

/* ------------------------------------------------------------------ */
/*  Redis bootstrap (optional — ioredis may not be installed)           */
/* ------------------------------------------------------------------ */

type RedisClient = { lrange: (k: string, s: number, e: number) => Promise<string[]>; del: (k: string) => Promise<number>; lpush: (k: string, ...v: string[]) => Promise<number>; expire: (k: string, s: number) => Promise<number> }

let _redis: RedisClient | null = null
let _redisInitAttempted = false

function getRedis(): RedisClient | null {
  if (_redisInitAttempted) return _redis
  _redisInitAttempted = true
  if (!process.env.REDIS_URL) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IORedis = require('ioredis') as new (url: string, opts: Record<string, unknown>) => RedisClient
    _redis = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 2_000,
    })
    return _redis
  } catch {
    return null
  }
}

async function redisGetTimestamps(
  redis: RedisClient,
  key: string,
  windowStart: number,
): Promise<number[]> {
  const all = await redis.lrange(key, 0, -1)
  return all.map(Number).filter((t: number) => !isNaN(t) && t > windowStart)
}

async function redisAddTimestamp(
  redis: RedisClient,
  key: string,
  now: number,
  windowStart: number,
  windowMs: number,
): Promise<void> {
  const all = await redis.lrange(key, 0, -1)
  const surviving = all.map(Number).filter((t: number) => !isNaN(t) && t > windowStart)
  if (all.length > 0) await redis.del(key)
  if (surviving.length > 0) await redis.lpush(key, ...surviving.map(String))
  await redis.lpush(key, String(now))
  await redis.expire(key, Math.ceil(windowMs / 1000) + 1)
}

/* ------------------------------------------------------------------ */
/*  SlidingWindowRateLimiter                                           */
/* ------------------------------------------------------------------ */

export interface SlidingWindowConfig {
  maxRequests: number
  windowMs?: number
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly buckets = new Map<string, number[]>()

  constructor(config: SlidingWindowConfig) {
    this.maxRequests = config.maxRequests
    this.windowMs = config.windowMs ?? DEFAULT_WINDOW_MS
  }

  async isAllowed(key: string): Promise<boolean> {
    const now = Date.now()
    const windowStart = now - this.windowMs
    const redis = getRedis()
    const redisKey = `rl:sw:${key}`

    let timestamps: number[]
    if (redis) {
      timestamps = await redisGetTimestamps(redis, redisKey, windowStart)
    } else {
      timestamps = (this.buckets.get(key) ?? []).filter((t) => t > windowStart)
    }

    if (timestamps.length >= this.maxRequests) {
      if (!redis) this.buckets.set(key, timestamps)
      return false
    }

    if (redis) {
      await redisAddTimestamp(redis, redisKey, now, windowStart, this.windowMs)
    } else {
      timestamps.push(now)
      this.buckets.set(key, timestamps)
    }

    return true
  }

  async reset(key?: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      if (key) await redis.del(`rl:sw:${key}`)
    } else {
      if (key) this.buckets.delete(key)
      else this.buckets.clear()
    }
  }
}

/* ------------------------------------------------------------------ */
/*  HostRateLimiter                                                    */
/* ------------------------------------------------------------------ */

export interface HostRateLimiterConfig {
  maxRequests: number
  windowMs?: number
}

export class HostRateLimiter {
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly buckets = new Map<string, number[]>()

  constructor(config?: Partial<HostRateLimiterConfig>) {
    this.maxRequests = config?.maxRequests ?? DEFAULT_MAX_REQUESTS
    this.windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS
  }

  async isAllowed(host: string): Promise<boolean> {
    const now = Date.now()
    const windowStart = now - this.windowMs
    const redis = getRedis()
    const redisKey = `rl:host:${host}`

    let timestamps: number[]
    if (redis) {
      timestamps = await redisGetTimestamps(redis, redisKey, windowStart)
    } else {
      timestamps = (this.buckets.get(host) ?? []).filter((t) => t > windowStart)
    }

    if (timestamps.length >= this.maxRequests) {
      if (!redis) this.buckets.set(host, timestamps)
      return false
    }

    if (redis) {
      await redisAddTimestamp(redis, redisKey, now, windowStart, this.windowMs)
    } else {
      timestamps.push(now)
      this.buckets.set(host, timestamps)
    }

    return true
  }

  async reset(host?: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      if (host) await redis.del(`rl:host:${host}`)
    } else {
      if (host) this.buckets.delete(host)
      else this.buckets.clear()
    }
  }
}
