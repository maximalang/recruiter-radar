/**
 * Sliding-window rate limiter for source adapters.
 *
 * Redis-backed when `ioredis` is installed and `REDIS_URL` is set;
 * in-memory fallback for single-instance cron / CLI usage.
 */

const DEFAULT_WINDOW_MS = 60_000;

let _redis = null;
let _redisInitAttempted = false;

function getRedis() {
  if (_redisInitAttempted) return _redis;
  _redisInitAttempted = true;
  if (!process.env.REDIS_URL) return null;
  try {
    const IORedis = require('ioredis');
    _redis = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 2_000,
    });
    return _redis;
  } catch {
    return null;
  }
}

async function redisGetTimestamps(redis, key, windowStart) {
  const all = await redis.lrange(key, 0, -1);
  return all.map(Number).filter((t) => !isNaN(t) && t > windowStart);
}

async function redisAddTimestamp(redis, key, now, windowStart, windowMs) {
  const all = await redis.lrange(key, 0, -1);
  const surviving = all.map(Number).filter((t) => !isNaN(t) && t > windowStart);
  if (all.length > 0) await redis.del(key);
  if (surviving.length > 0) await redis.lpush(key, ...surviving.map(String));
  await redis.lpush(key, String(now));
  await redis.expire(key, Math.ceil(windowMs / 1000) + 1);
}

export class RateLimiter {
  /**
   * @param {number} maxRequestsPerMinute
   * @param {number} [windowMs=60000]
   * @param {string} [keyPrefix='rl:']
   */
  constructor(maxRequestsPerMinute, windowMs = DEFAULT_WINDOW_MS, keyPrefix = 'rl:') {
    this.maxRequests = maxRequestsPerMinute;
    this.windowMs = windowMs;
    this.keyPrefix = keyPrefix;
    /** @type {Map<string, number[]>} */
    this.buckets = new Map();
  }

  /**
   * Record a request for `key` and return true if allowed,
   * false if the rate limit is exceeded.
   */
  async allow(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const redis = getRedis();
    const redisKey = `${this.keyPrefix}${key}`;

    let timestamps;
    if (redis) {
      timestamps = await redisGetTimestamps(redis, redisKey, windowStart);
    } else {
      timestamps = (this.buckets.get(key) ?? []).filter((t) => t > windowStart);
    }

    if (timestamps.length >= this.maxRequests) {
      if (!redis) this.buckets.set(key, timestamps);
      return false;
    }

    if (redis) {
      await redisAddTimestamp(redis, redisKey, now, windowStart, this.windowMs);
    } else {
      timestamps.push(now);
      this.buckets.set(key, timestamps);
    }

    return true;
  }

  /** Smallest ms to wait before the next request for `key` will be allowed. */
  async msUntilNextAllowed(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const redis = getRedis();
    const redisKey = `${this.keyPrefix}${key}`;

    let timestamps;
    if (redis) {
      timestamps = await redisGetTimestamps(redis, redisKey, windowStart);
    } else {
      timestamps = (this.buckets.get(key) ?? []).filter((t) => t > windowStart);
    }

    if (timestamps.length < this.maxRequests) {
      return 0;
    }

    timestamps.sort((a, b) => a - b);
    const oldestInWindow = timestamps[0];
    return Math.max(0, oldestInWindow + this.windowMs - now);
  }

  /** Clear rate limit state for a specific key or all keys. */
  async reset(key) {
    const redis = getRedis();
    if (redis) {
      if (key) {
        await redis.del(`${this.keyPrefix}${key}`);
      }
    } else {
      if (key) {
        this.buckets.delete(key);
      } else {
        this.buckets.clear();
      }
    }
  }
}
