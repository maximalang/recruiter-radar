/**
 * Crawler abstraction barrel + default router factory.
 *
 * Most callers should import `createDefaultRouter()` from here rather than
 * constructing engines directly. The default router registers only the
 * static engine — SPA and llm-markdown engines are added as their dep
 * approvals (Playwright, Crawl4AI) land. Until then, requesting an SPA
 * URL yields the static result with a "spa engine not registered"
 * warning, which is the correct degradation: the page may still parse.
 */

import { createStaticEngine, type CreateStaticEngineOptions } from './crawler-static'
import { createCrawlerRouter, type CrawlerRouter, type EngineRegistry } from './crawler-router'

export type { CrawlerRouter, EngineRegistry } from './crawler-router'
export { chooseEngine, createCrawlerRouter } from './crawler-router'
export { createStaticEngine } from './crawler-static'
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
  /** Override / extend the default engine registry. */
  extraEngines?: EngineRegistry
}

export function createDefaultRouter(
  options: DefaultRouterOptions = {},
): CrawlerRouter {
  const registry: EngineRegistry = {
    static: createStaticEngine(options.staticEngine),
    ...options.extraEngines,
  }
  return createCrawlerRouter(registry)
}
