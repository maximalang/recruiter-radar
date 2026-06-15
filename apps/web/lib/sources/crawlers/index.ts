/**
 * Crawler abstraction barrel + default router factory.
 *
 * Most callers should import `createDefaultRouter()` from here rather than
 * constructing engines directly. The default router registers the static
 * engine plus any engines whose deps are available at startup:
 *
 *   - SPA (Crawlee + Playwright) — registered when `crawlee` is importable
 *   - LLM-markdown (Firecrawl) — registered when `FIRECRAWL_API_KEY` is set
 *
 * To force-register or override engines, pass `extraEngines` to
 * `createDefaultRouter()`.
 */

import { createStaticEngine, type CreateStaticEngineOptions } from './crawler-static'
import { createCrawlerRouter, type CrawlerRouter, type EngineRegistry } from './crawler-router'
import { createCrawleeSpaEngine, createCrawleeStaticEngine, type CrawleeEngineOptions } from './crawler-crawlee'
import { createFirecrawlEngine, type FirecrawlEngineOptions } from './crawler-firecrawl'

export type { CrawlerRouter, EngineRegistry } from './crawler-router'
export { chooseEngine, createCrawlerRouter } from './crawler-router'
export { CircuitBreaker, type CircuitBreakerConfig, type CircuitState } from './circuit-breaker'
export { HostRateLimiter, type HostRateLimiterConfig as RateLimiterConfig } from '@/lib/rate-limiter'
export { withRetry, type RetryConfig } from '@/lib/utils/retry'
export { validateCrawlerUrl } from './url-validator'
export { createStaticEngine } from './crawler-static'
export { createCrawleeSpaEngine, createCrawleeStaticEngine } from './crawler-crawlee'
export { createFirecrawlEngine } from './crawler-firecrawl'
export type { CrawleeEngineOptions } from './crawler-crawlee'
export type { FirecrawlEngineOptions } from './crawler-firecrawl'
export type {
  CrawlerEngine,
  CrawlerEngineId,
  CrawlerCapabilities,
  CrawlerOptions,
  CrawlerResult,
  CrawlerFetchInput,
} from './crawler-contract'

export interface DefaultRouterOptions {
  staticEngine?: CreateStaticEngineOptions
  /** Crawlee engine options (SPA + enhanced static). */
  crawlee?: CrawleeEngineOptions
  /** Firecrawl engine options (LLM-markdown). */
  firecrawl?: FirecrawlEngineOptions
  /**
   * Override / extend the default engine registry.
   * Keys take precedence over auto-detected engines.
   */
  extraEngines?: EngineRegistry
  /**
   * Force-register all engines even if deps are missing.
   * Engines will throw a clear error at `fetch()` time instead.
   * Useful for testing without installing Crawlee/Playwright.
   */
  forceRegisterAll?: boolean
}

/**
 * Detect whether Crawlee is importable (optional dep).
 */
async function isCrawleeAvailable(): Promise<boolean> {
  try {
    await import('crawlee')
    return true
  } catch {
    return false
  }
}

/**
 * Auto-detect which optional engines can be registered.
 */
async function detectOptionalEngines(
  options: DefaultRouterOptions,
): Promise<EngineRegistry> {
  const engines: EngineRegistry = {}

  // Crawlee SPA engine — requires `crawlee` + `playwright` packages
  const crawleeAvailable = options.forceRegisterAll || await isCrawleeAvailable()
  if (crawleeAvailable) {
    try {
      engines.spa = createCrawleeSpaEngine(options.crawlee)
    } catch {
      // Crawlee import succeeded but Playwright init failed — skip
    }
  }

  // Firecrawl LLM-markdown engine — always register; falls back to static
  // internally when FIRECRAWL_API_KEY is not set
  engines['llm-markdown'] = createFirecrawlEngine(options.firecrawl)

  return engines
}

export function createDefaultRouter(
  options: DefaultRouterOptions = {},
): CrawlerRouter {
  const registry: EngineRegistry = {
    static: createStaticEngine(options.staticEngine),
    ...options.extraEngines,
  }

  // NOTE: Optional engines (Crawlee, Firecrawl) are registered
  // synchronously here. Crawlee may fail at `fetch()` time if
  // its deps are missing, and Firecrawl gracefully falls back
  // to the static engine. For full async detection, use
  // `createDefaultRouterAsync()` below.
  //
  // We register Firecrawl eagerly (it has built-in fallback),
  // but skip Crawlee SPA unless explicitly requested via extraEngines
  // or forceRegisterAll, because its import is expensive.

  if (options.forceRegisterAll) {
    try {
      registry.spa = createCrawleeSpaEngine(options.crawlee)
    } catch { /* Crawlee not installed */ }
  }

  // Firecrawl is always safe to register — it degrades gracefully
  registry['llm-markdown'] = createFirecrawlEngine(options.firecrawl)

  return createCrawlerRouter(registry)
}

/**
 * Async version of `createDefaultRouter` that auto-detects optional deps.
 * Prefer this for production setups; use the sync version in tests.
 */
export async function createDefaultRouterAsync(
  options: DefaultRouterOptions = {},
): Promise<CrawlerRouter> {
  const optionalEngines = await detectOptionalEngines(options)

  const registry: EngineRegistry = {
    static: createStaticEngine(options.staticEngine),
    ...optionalEngines,
    ...options.extraEngines, // explicit overrides win
  }

  return createCrawlerRouter(registry)
}
