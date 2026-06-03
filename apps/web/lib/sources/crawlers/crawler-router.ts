/**
 * CrawlerEngine router with circuit breaker and rate limiter.
 *
 * Single configuration point that maps a target URL (and an optional caller
 * hint) to the right engine. Adapters call the router, never specific
 * engines, so swapping in a new SPA renderer or markdown sidecar is a
 * one-line change here.
 *
 * Default policy:
 *   - hint='static'   → static engine (overrides host detection)
 *   - hint='spa'      → SPA engine
 *   - hint='newsroom' → LLM-markdown engine (clean text from cluttered HTML)
 *   - hint='pdf'      → LLM-markdown engine (PDF-aware extraction)
 *   - host on the SPA allow-list → SPA engine
 *   - everything else → static engine
 *
 * Circuit breaker:
 *   Per-host failure tracking. After N consecutive failures the circuit
 *   opens and subsequent requests immediately return a 503 CrawlerResult
 *   without calling the engine. After `resetMs` the circuit enters
 *   half-open: one request is let through. If it succeeds the circuit
 *   closes; if it fails the circuit re-opens for another `resetMs`.
 *
 * Rate limiter:
 *   Per-host sliding-window rate limit. Requests exceeding
 *   `maxRequestsPerHostPerMinute` return a 429 CrawlerResult immediately.
 *
 * If the chosen engine is not registered (e.g. SPA picked but Playwright
 * is not installed), the router falls back to the static engine and adds
 * a warning to the result. If even static is missing, it throws — the
 * caller has misconfigured the router.
 */

import type {
  CrawlerEngine,
  CrawlerEngineId,
  CrawlerFetchInput,
  CrawlerOptions,
  CrawlerResult,
} from './crawler-contract'
import { validateCrawlerUrl } from './url-validator'

/* ------------------------------------------------------------------ */
/*  Retry helper (exponential backoff)                                */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Engine selection                                                   */
/* ------------------------------------------------------------------ */

const SPA_HOSTS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkdayjobs.com',
  'smartrecruiters.com',
  'jobvite.com',
  'workable.com',
] as const

function getHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

export function chooseEngine(
  url: string,
  hint?: CrawlerOptions['hint'],
): CrawlerEngineId {
  if (hint === 'static') return 'static'
  if (hint === 'spa') return 'spa'
  if (hint === 'newsroom' || hint === 'pdf') return 'llm-markdown'

  const host = getHostname(url)
  if (!host) return 'static'

  if (SPA_HOSTS.some((suffix) => hostMatches(host, suffix))) return 'spa'
  return 'static'
}

/* ------------------------------------------------------------------ */
/*  Circuit breaker                                                    */
/* ------------------------------------------------------------------ */

type CircuitState = 'closed' | 'open' | 'half-open'

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

class CircuitBreaker {
  private readonly config: CircuitBreakerConfig
  private readonly hosts = new Map<string, CircuitRecord>()

  constructor(config: CircuitBreakerConfig) {
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

/* ------------------------------------------------------------------ */
/*  Rate limiter                                                       */
/* ------------------------------------------------------------------ */

export interface RateLimiterConfig {
  /** Max requests per hostname per 60-second sliding window. Default 60. */
  maxRequestsPerHostPerMinute: number
}

const DEFAULT_RL: RateLimiterConfig = {
  maxRequestsPerHostPerMinute: 60,
}

class HostRateLimiter {
  private readonly maxRequests: number
  private readonly windowMs = 60_000
  private readonly buckets = new Map<string, number[]>()

  constructor(maxRequests: number) {
    this.maxRequests = maxRequests
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

/* ------------------------------------------------------------------ */
/*  Router config                                                      */
/* ------------------------------------------------------------------ */

export interface RetryConfig {
  /** Enable retry with exponential backoff. Default true. */
  enabled?: boolean
  /** Max retry attempts (default 3). */
  retries?: number
  /** Base delay in ms for exponential backoff (default 200). */
  baseMs?: number
}

export interface RouterConfig {
  circuitBreaker?: Partial<CircuitBreakerConfig>
  rateLimiter?: Partial<RateLimiterConfig>
  retry?: RetryConfig
}

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

export type EngineRegistry = Partial<Record<CrawlerEngineId, CrawlerEngine>>

export interface CrawlerRouterMetrics {
  successRate: number
  avgLatencyMs: number
  totalRequests: number
  errorTypes: Record<string, number>
}

export interface CrawlerRouter {
  fetch(input: CrawlerFetchInput): Promise<CrawlerResult>
  getMetrics(): Record<string, CrawlerRouterMetrics>
}

export function createCrawlerRouter(
  engines: EngineRegistry,
  config?: RouterConfig,
): CrawlerRouter {
  const cbConfig: CircuitBreakerConfig = {
    failureThreshold: config?.circuitBreaker?.failureThreshold ?? DEFAULT_CB.failureThreshold,
    resetMs: config?.circuitBreaker?.resetMs ?? DEFAULT_CB.resetMs,
  }
  const rlMax = config?.rateLimiter?.maxRequestsPerHostPerMinute ?? DEFAULT_RL.maxRequestsPerHostPerMinute
  const retryCfg = config?.retry
  const retryEnabled = retryCfg?.enabled ?? true
  const retryAttempts = retryCfg?.retries ?? 3
  const retryBaseMs = retryCfg?.baseMs ?? 200

  const circuitBreaker = new CircuitBreaker(cbConfig)
  const rateLimiter = new HostRateLimiter(rlMax)

  return {
    async fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      const target = chooseEngine(input.url, input.options?.hint)
      const fallbackWarnings: string[] = []
      const host = getHostname(input.url) ?? input.url

      // --- URL validation gate (400) — SSRF protection ---
      const urlValidation = validateCrawlerUrl(input.url)
      if (!urlValidation.valid) {
        return {
          url: input.url,
          status: 400,
          rawHeaders: {},
          fetchedAt: new Date().toISOString(),
          engine: target,
          warnings: [`URL rejected: ${urlValidation.reason}`],
        }
      }

      // --- Rate limiter gate (429) ---
      if (!rateLimiter.isAllowed(host)) {
        circuitBreaker.resetProbe(host)
        return {
          url: input.url,
          status: 429,
          rawHeaders: {},
          fetchedAt: new Date().toISOString(),
          engine: target,
          warnings: [`rate limit exceeded for host ${host}`],
        }
      }

      // --- Circuit breaker gate (503) ---
      const circuitState = circuitBreaker.check(host)
      if (circuitState === 'open') {
        return {
          url: input.url,
          status: 503,
          rawHeaders: {},
          fetchedAt: new Date().toISOString(),
          engine: target,
          warnings: [`circuit open for host ${host} — too many recent failures`],
        }
      }

      // --- Engine resolution ---
      let engine = engines[target]
      if (!engine && target !== 'static') {
        fallbackWarnings.push(
          `engine "${target}" not registered — falling back to static`,
        )
        engine = engines.static
      }
      if (!engine) {
        throw new Error(
          `crawler-router: no engine registered to handle ${input.url} (wanted ${target})`,
        )
      }

      // --- Execute fetch with optional retry ---
      try {
        const fetchStart = Date.now()
        const result = retryEnabled
          ? await withRetry(() => engine.fetch(input), retryAttempts, retryBaseMs)
          : await engine.fetch(input)
        const latencyMs = Date.now() - fetchStart

        // I10: Distinguish client errors from server failures for circuit breaker.
        // 404/410 = page removed (not a server problem) → CB success, not failure.
        // 403 = blocked, 429 = upstream rate limit, 5xx = server error → CB failure.
        const isCbFailure = result.status === 403 || result.status === 429 || result.status >= 500
        if (isCbFailure) {
          const errorType = result.status === 403 ? '403'
            : result.status === 429 ? '429'
            : result.status >= 500 ? '5xx'
            : 'other'
          circuitBreaker.onFailure(host, errorType)
        } else {
          circuitBreaker.onSuccess(host, latencyMs)
        }

        if (fallbackWarnings.length > 0) {
          return { ...result, warnings: [...result.warnings, ...fallbackWarnings] }
        }
        return result
      } catch (err) {
        // Classify network-level errors
        let errorType = 'other'
        if (err instanceof Error) {
          const msg = err.message.toLowerCase()
          if (msg.includes('timeout') || msg.includes('etimedout')) errorType = 'timeout'
          else if (msg.includes('enotfound') || msg.includes('dns')) errorType = 'dns'
        }
        circuitBreaker.onFailure(host, errorType)

        // In half-open state, the probe failed — re-throw so the caller
        // knows the engine itself errored (circuit will be re-opened by onFailure)
        throw err
      }
    },

    getMetrics: () => circuitBreaker.getMetrics(),
  }
}
