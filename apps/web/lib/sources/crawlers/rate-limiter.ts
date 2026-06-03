/**
 * Per-host sliding-window rate limiter for crawler fetches.
 *
 * Requests exceeding `maxRequestsPerHostPerMinute` are rejected immediately.
 * In-memory only — for multi-instance deployment, replace with Redis-backed
 * implementation.
 */

export interface RateLimiterConfig {
  /** Max requests per hostname per 60-second sliding window. Default 60. */
  maxRequestsPerHostPerMinute: number
}

const DEFAULT_RL: RateLimiterConfig = {
  maxRequestsPerHostPerMinute: 60,
}

export class HostRateLimiter {
  private readonly maxRequests: number
  private readonly windowMs = 60_000
  private readonly buckets = new Map<string, number[]>()

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.maxRequests = config.maxRequestsPerHostPerMinute ?? DEFAULT_RL.maxRequestsPerHostPerMinute
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  isAllowed(host: string): boolean {
    const now = Date.now()
    const windowStart = now - this.windowMs
    let timestamps = this.buckets.get(host) ?? []

    timestamps = timestamps.filter((t) => t > windowStart)

    if (timestamps.length >= this.maxRequests) {
      this.buckets.set(host, timestamps)
      return false
    }

    timestamps.push(now)

    if (timestamps.length === 0) {
      this.buckets.delete(host)
    } else {
      this.buckets.set(host, timestamps)
    }

    return true
  }
}
