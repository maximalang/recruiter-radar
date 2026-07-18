/**
 * Crawler abstraction barrel + default router factory.
 *
 * Most callers should import `createDefaultRouter()` from here rather than
 * constructing engines directly. The default router registers the static
 * engine plus any engines whose deps are available at startup:
 *
 *   - SPA (Playwright) — registered when `playwright` is importable
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
  /** Browser engine options (legacy property name retained for compatibility). */
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
   * Useful for testing without installing Playwright.
   */
  forceRegisterAll?: boolean
}

/**
 * Detect whether Playwright is importable.
 */
async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await import('playwright')
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

  const playwrightAvailable = options.forceRegisterAll || await isPlaywrightAvailable()
  if (playwrightAvailable) {
    try {
      engines.spa = createCrawleeSpaEngine(options.crawlee)
    } catch {
      // Playwright import succeeded but engine initialization failed — skip
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

  // NOTE: Optional engines (Playwright, Firecrawl) are registered
  // synchronously here. Playwright may fail at `fetch()` time if
  // its deps are missing, and Firecrawl gracefully falls back
  // to the static engine. For full async detection, use
  // `createDefaultRouterAsync()` below.
  //
  // We register Firecrawl eagerly (it has built-in fallback),
  // but skip Playwright SPA unless explicitly requested via extraEngines
  // or forceRegisterAll, because its import is expensive.

  if (options.forceRegisterAll) {
    try {
      registry.spa = createCrawleeSpaEngine(options.crawlee)
    } catch { /* Playwright not installed */ }
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
