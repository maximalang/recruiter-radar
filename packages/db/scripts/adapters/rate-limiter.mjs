/**
 * Sliding-window rate limiter for source adapters.
 *
 * Enforces max requests per host per 60-second window.
 * In-memory only — suitable for single-instance cron / CLI usage.
 */

const DEFAULT_WINDOW_MS = 60_000;

export class RateLimiter {
  /**
   * @param {number} maxRequestsPerMinute
   * @param {number} [windowMs=60000]
   */
  constructor(maxRequestsPerMinute, windowMs = DEFAULT_WINDOW_MS) {
    this.maxRequests = maxRequestsPerMinute;
    this.windowMs = windowMs;
    /** @type {Map<string, number[]>} */
    this.buckets = new Map();
  }

  /**
   * Record a request for `key` and return true if allowed,
   * false if the rate limit is exceeded.
   */
  allow(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    let timestamps = this.buckets.get(key) ?? [];

    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.buckets.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    this.buckets.set(key, timestamps);
    return true;
  }

  /** Smallest ms to wait before the next request for `key` will be allowed. */
  msUntilNextAllowed(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.buckets.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length < this.maxRequests) {
      return 0;
    }

    const oldestInWindow = timestamps[0];
    return Math.max(0, oldestInWindow + this.windowMs - now);
  }
}
