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
   *
   * When the circuit transitions to half-open, only ONE request (the probe)
   * is allowed through. While the probe is in-flight, subsequent concurrent
   * requests see the circuit as effectively open (returns 'open') and get 503.
   */
  check(host: string): CircuitState {
    const rec = this.hosts.get(host)
    if (!rec) return 'closed'

    // Transition from open → half-open if resetMs elapsed
    if (rec.state === 'open' && Date.now() - rec.openedAt >= this.config.resetMs) {
      rec.state = 'half-open'
    }

    // If a probe is already in-flight, block concurrent requests
    if (rec.state === 'half-open' && rec.probing) {
      return 'open'
    }

    // Mark that we are now probing (only reached for the first half-open request)
    if (rec.state === 'half-open') {
      rec.probing = true
    }

    return rec.state
  }

  /** Record a successful fetch — closes the circuit, clears the probing flag, and evicts stale entries. */
  onSuccess(host: string): void {
    const rec = this.hosts.get(host)
    if (!rec) return
    rec.state = 'closed'
    rec.consecutiveFailures = 0
    rec.probing = false

    // I9: Evict stale entries — circuit is closed and healthy, safe to remove
    // if it's been around for a while. Prevents unbounded Map growth.
    if (this.hosts.size > 1000) {
      this.evictStaleEntries()
    }
  }

  /** Record a failure — may open or re-open the circuit. Clears the probing flag. */
  onFailure(host: string): void {
    let rec = this.hosts.get(host)
    if (!rec) {
      rec = { state: 'closed', consecutiveFailures: 0, openedAt: 0, probing: false }
      this.hosts.set(host, rec)
    }

    rec.consecutiveFailures++
    rec.probing = false

    if (rec.state === 'half-open') {
      // Half-open probe failed → re-open
      rec.state = 'open'
      rec.openedAt = Date.now()
    } else if (rec.consecutiveFailures >= this.config.failureThreshold) {
      rec.state = 'open'
      rec.openedAt = Date.now()
    }
  }

  /** I15: Reset the probing flag when a request is rejected by rate limiter (not by circuit). */
  resetProbe(host: string): void {
    const rec = this.hosts.get(host)
    if (rec && rec.state === 'half-open') {
      rec.probing = false
    }
  }

  /** I9: Evict closed, healthy circuit records older than 5 minutes. */
  private evictStaleEntries(): void {
    const cutoff = Date.now() - 5 * 60_000
    for (const [host, rec] of this.hosts) {
      if (rec.state === 'closed' && rec.consecutiveFailures === 0 && rec.openedAt < cutoff) {
        this.hosts.delete(host)
      }
    }
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

    // Evict expired entries
    timestamps = timestamps.filter((t) => t > windowStart)

    if (timestamps.length >= this.maxRequests) {
      this.buckets.set(host, timestamps)
      return false
    }

    // Add current request timestamp
    timestamps.push(now)

    // I9: Remove empty buckets to prevent unbounded Map growth
    // (won't happen here since we just pushed, but defensive for future callers)
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

export interface RouterConfig {
  circuitBreaker?: Partial<CircuitBreakerConfig>
  rateLimiter?: Partial<RateLimiterConfig>
}

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

export type EngineRegistry = Partial<Record<CrawlerEngineId, CrawlerEngine>>

export interface CrawlerRouter {
  fetch(input: CrawlerFetchInput): Promise<CrawlerResult>
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
        // I15: Reset probing flag — this request was rejected by rate limiter,
        // not by circuit breaker. Without reset, the circuit would stay stuck
        // in half-open with probing=true indefinitely.
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

      // --- Execute fetch (half-open lets one probe through) ---
      try {
        const result = await engine.fetch(input)

        // I10: Distinguish client errors from server failures for circuit breaker.
        // 404/410 = page removed (not a server problem) → CB success, not failure.
        // 403 = blocked, 429 = upstream rate limit, 5xx = server error → CB failure.
        const isCbFailure = result.status === 403 || result.status === 429 || result.status >= 500
        if (isCbFailure) {
          circuitBreaker.onFailure(host)
        } else {
          circuitBreaker.onSuccess(host)
        }

        if (fallbackWarnings.length > 0) {
          return { ...result, warnings: [...result.warnings, ...fallbackWarnings] }
        }
        return result
      } catch (err) {
        circuitBreaker.onFailure(host)

        // In half-open state, the probe failed — re-throw so the caller
        // knows the engine itself errored (circuit will be re-opened by onFailure)
        throw err
      }
    },
  }
}
