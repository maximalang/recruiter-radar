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

type RedisClient = {
  del: (k: string) => Promise<number>;
  eval: (script: string, numKeys: number, ...args: (string | number)[]) => Promise<unknown>;
}

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

/*
 * Atomic sliding-window check-and-add, executed entirely server-side via a
 * single EVAL so there is no read-modify-write race between instances (I15).
 *
 * KEYS[1] = bucket key
 * ARGV[1] = now (ms)
 * ARGV[2] = windowStart (ms) — entries at or before this are expired
 * ARGV[3] = maxRequests
 * ARGV[4] = ttlSeconds
 *
 * Returns 1 if the request is allowed (and `now` was recorded), 0 if denied.
 */
const SLIDING_WINDOW_LUA = `
local entries = redis.call('LRANGE', KEYS[1], 0, -1)
local windowStart = tonumber(ARGV[2])
local surviving = {}
for i = 1, #entries do
  local t = tonumber(entries[i])
  if t ~= nil and t > windowStart then
    surviving[#surviving + 1] = entries[i]
  end
end
if #surviving >= tonumber(ARGV[3]) then
  -- Rewrite the cleaned list so expired entries do not accumulate.
  redis.call('DEL', KEYS[1])
  if #surviving > 0 then
    redis.call('RPUSH', KEYS[1], unpack(surviving))
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
  end
  return 0
end
surviving[#surviving + 1] = ARGV[1]
redis.call('DEL', KEYS[1])
redis.call('RPUSH', KEYS[1], unpack(surviving))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return 1
`

async function redisCheckAndAdd(
  redis: RedisClient,
  key: string,
  now: number,
  windowStart: number,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> {
  const ttlSeconds = Math.ceil(windowMs / 1000) + 1
  const result = await redis.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    String(now),
    String(windowStart),
    String(maxRequests),
    String(ttlSeconds),
  )
  return result === 1
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
  private lastSweepAt = 0

  constructor(config: SlidingWindowConfig) {
    this.maxRequests = config.maxRequests
    this.windowMs = config.windowMs ?? DEFAULT_WINDOW_MS
  }

  async isAllowed(key: string): Promise<boolean> {
    const now = Date.now()
    const windowStart = now - this.windowMs
    const redis = getRedis()

    if (redis) {
      return redisCheckAndAdd(redis, `rl:sw:${key}`, now, windowStart, this.maxRequests, this.windowMs)
    }

    if (now - this.lastSweepAt >= this.windowMs) {
      for (const [bucketKey, bucketTimestamps] of this.buckets) {
        const activeTimestamps = bucketTimestamps.filter((timestamp) => timestamp > windowStart)
        if (activeTimestamps.length === 0) this.buckets.delete(bucketKey)
        else this.buckets.set(bucketKey, activeTimestamps)
      }
      this.lastSweepAt = now
    }

    const timestamps = (this.buckets.get(key) ?? []).filter((t) => t > windowStart)
    if (timestamps.length >= this.maxRequests) {
      this.buckets.set(key, timestamps)
      return false
    }
    timestamps.push(now)
    this.buckets.set(key, timestamps)
    return true
  }

  async reset(key?: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      if (key) await redis.del(`rl:sw:${key}`)
    } else {
      if (key) this.buckets.delete(key)
      else {
        this.buckets.clear()
        this.lastSweepAt = 0
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  HostRateLimiter                                                    */
/* ------------------------------------------------------------------ */

export interface HostRateLimiterConfig {
  maxRequestsPerHostPerMinute: number
  windowMs?: number
}

export class HostRateLimiter {
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly buckets = new Map<string, number[]>()

  constructor(config?: Partial<HostRateLimiterConfig>) {
    this.maxRequests = config?.maxRequestsPerHostPerMinute ?? DEFAULT_MAX_REQUESTS
    this.windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS
  }

  async isAllowed(host: string): Promise<boolean> {
    const now = Date.now()
    const windowStart = now - this.windowMs
    const redis = getRedis()

    if (redis) {
      return redisCheckAndAdd(redis, `rl:host:${host}`, now, windowStart, this.maxRequests, this.windowMs)
    }

    const timestamps = (this.buckets.get(host) ?? []).filter((t) => t > windowStart)
    if (timestamps.length >= this.maxRequests) {
      this.buckets.set(host, timestamps)
      return false
    }
    timestamps.push(now)
    this.buckets.set(host, timestamps)
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
