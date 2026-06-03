/**
 * Retry helper with exponential backoff for crawler fetches.
 *
 * Only retries on network-level errors (thrown exceptions), NOT on HTTP
 * error statuses — those are handled by the circuit breaker.
 */

export interface RetryConfig {
  /** Enable retry with exponential backoff. Default true. */
  enabled?: boolean
  /** Max retry attempts (default 3). */
  retries?: number
  /** Base delay in ms for exponential backoff (default 200). */
  baseMs?: number
}

/**
 * Retry an async function up to `retries` times with exponential backoff.
 * Only retries on network-level errors (thrown exceptions), NOT on HTTP
 * error statuses — those are handled by the circuit breaker.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseMs = 200,
): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === retries) throw err
      const delay = baseMs * 2 ** i
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}
