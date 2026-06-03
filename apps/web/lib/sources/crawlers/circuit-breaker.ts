/**
 * Circuit breaker for crawler hosts.
 *
 * Per-host failure tracking. After N consecutive failures the circuit
 * opens and subsequent requests immediately return a 503 without
 * calling the engine. After `resetMs` the circuit enters half-open:
 * one request is let through. If it succeeds the circuit closes;
 * if it fails the circuit re-opens for another `resetMs`.
 */

export type CircuitState = 'closed' | 'open' | 'half-open'

interface CircuitRecord {
  state: CircuitState
  consecutiveFailures: number
  openedAt: number // Date.now() when the circuit last opened
  /** True while a half-open probe is in-flight; prevents concurrent probes. */
  probing: boolean
  /** Total successful requests for this host. */
  successCount: number
  /** Total failed requests for this host. */
  failureCount: number
  /** Sum of latencies (ms) for successful requests. */
  totalLatencyMs: number
  /** Count of errors by type: 'timeout' | '403' | '429' | '5xx' | 'dns' | 'other'. */
  errorTypes: Record<string, number>
}

export interface CircuitBreakerConfig {
  /** Consecutive failures required to open the circuit. Default 5. */
  failureThreshold: number
  /** Milliseconds before an open circuit transitions to half-open. Default 60_000. */
  resetMs: number
}

const DEFAULT_CB: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetMs: 60_000,
}

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig
  private readonly hosts = new Map<string, CircuitRecord>()

  constructor(config: CircuitBreakerConfig = DEFAULT_CB) {
    this.config = config
  }

  /**
   * Check whether a request to `host` is allowed.
   * Returns the current circuit state (may transition from open → half-open).
   */
  check(host: string): CircuitState {
    const rec = this.hosts.get(host)
    if (!rec) return 'closed'

    if (rec.state === 'open' && Date.now() - rec.openedAt >= this.config.resetMs) {
      rec.state = 'half-open'
    }

    if (rec.state === 'half-open' && rec.probing) {
      return 'open'
    }

    if (rec.state === 'half-open') {
      rec.probing = true
    }

    return rec.state
  }

  /** Record a successful fetch — closes the circuit and clears the probing flag. */
  onSuccess(host: string, latencyMs?: number): void {
    const rec = this.hosts.get(host)
    if (!rec) return
    rec.state = 'closed'
    rec.consecutiveFailures = 0
    rec.probing = false
    rec.successCount++

    if (latencyMs !== undefined) {
      rec.totalLatencyMs += latencyMs
    }

    if (this.hosts.size > 1000) {
      this.evictStaleEntries()
    }
  }

  /** Record a failure — may open or re-open the circuit. Clears the probing flag. */
  onFailure(host: string, errorType?: string): void {
    let rec = this.hosts.get(host)
    if (!rec) {
      rec = {
        state: 'closed', consecutiveFailures: 0, openedAt: 0, probing: false,
        successCount: 0, failureCount: 0, totalLatencyMs: 0, errorTypes: {},
      }
      this.hosts.set(host, rec)
    }

    rec.consecutiveFailures++
    rec.failureCount++
    rec.probing = false

    const type = errorType || 'other'
    rec.errorTypes[type] = (rec.errorTypes[type] || 0) + 1

    if (rec.state === 'half-open') {
      rec.state = 'open'
      rec.openedAt = Date.now()
    } else if (rec.consecutiveFailures >= this.config.failureThreshold) {
      rec.state = 'open'
      rec.openedAt = Date.now()
    }
  }

  /** Reset the probing flag when a request is rejected by rate limiter (not by circuit). */
  resetProbe(host: string): void {
    const rec = this.hosts.get(host)
    if (rec && rec.state === 'half-open') {
      rec.probing = false
    }
  }

  /** Evict closed, healthy circuit records older than 5 minutes. */
  private evictStaleEntries(): void {
    const cutoff = Date.now() - 5 * 60_000
    for (const [host, rec] of this.hosts) {
      if (rec.state === 'closed' && rec.consecutiveFailures === 0 && rec.openedAt < cutoff) {
        this.hosts.delete(host)
      }
    }
  }

  /**
   * Get per-host metrics for quality reporting.
   * Returns success rate, average latency, and error type breakdown.
   */
  getMetrics(): Record<string, {
    successRate: number
    avgLatencyMs: number
    totalRequests: number
    errorTypes: Record<string, number>
  }> {
    const result: Record<string, {
      successRate: number
      avgLatencyMs: number
      totalRequests: number
      errorTypes: Record<string, number>
    }> = {}

    for (const [host, rec] of this.hosts) {
      const total = rec.successCount + rec.failureCount
      result[host] = {
        successRate: total > 0 ? rec.successCount / total : 0,
        avgLatencyMs: rec.successCount > 0 ? rec.totalLatencyMs / rec.successCount : 0,
        totalRequests: total,
        errorTypes: { ...rec.errorTypes },
      }
    }

    return result
  }
}
