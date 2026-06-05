/**
 * CrawlerEngine router — single configuration point that maps a target URL
 * (and an optional caller hint) to the right engine. Adapters call the
 * router, never specific engines, so swapping in a new SPA renderer or
 * markdown sidecar is a one-line change here.
 *
 * Default policy:
 *   - hint='static'   → static engine (overrides host detection)
 *   - hint='spa'      → SPA engine
 *   - hint='newsroom' → LLM-markdown engine (clean text from cluttered HTML)
 *   - hint='pdf'      → LLM-markdown engine (PDF-aware extraction)
 *   - host on the SPA allow-list → SPA engine
 *   - everything else → static engine
 *
 * Circuit breaker, rate limiter, and retry logic live in their own modules:
 *   - circuit-breaker.ts  — per-host failure tracking with half-open probes
 *   - rate-limiter.ts     — per-host sliding-window rate limit
 *   - retry.ts            — exponential backoff for network errors
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
import { CircuitBreaker, type CircuitBreakerConfig } from './circuit-breaker'
import { HostRateLimiter, type HostRateLimiterConfig as RateLimiterConfig } from '@/lib/rate-limiter'
import { withRetry, type RetryConfig } from './retry'

export { CircuitBreaker, type CircuitBreakerConfig, type CircuitState } from './circuit-breaker'
export { HostRateLimiter, type HostRateLimiterConfig as RateLimiterConfig } from '@/lib/rate-limiter'
export { withRetry, type RetryConfig } from './retry'

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
/*  Router config                                                      */
/* ------------------------------------------------------------------ */

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
    failureThreshold: config?.circuitBreaker?.failureThreshold ?? 5,
    resetMs: config?.circuitBreaker?.resetMs ?? 60_000,
  }
  const retryCfg = config?.retry
  const retryEnabled = retryCfg?.enabled ?? true
  const retryAttempts = retryCfg?.retries ?? 3
  const retryBaseMs = retryCfg?.baseMs ?? 200

  const circuitBreaker = new CircuitBreaker(cbConfig)
  const rateLimiter = new HostRateLimiter(config?.rateLimiter)

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
      if (!(await rateLimiter.isAllowed(host))) {
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
