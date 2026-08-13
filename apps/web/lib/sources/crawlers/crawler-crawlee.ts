/**
 * Browser-backed crawler engines.
 *
 * The historical export names are retained for API compatibility. The actual
 * bounded Playwright worker pool lives in the canonical packages/db source
 * runtime so CLI sources and the web runtime share one browser lifecycle.
 */

import { createPlaywrightBrowserPool } from '@/../../packages/db/scripts/adapters/playwright-browser-pool.mjs'
import type {
  CrawlerEngine,
  CrawlerFetchInput,
  CrawlerResult,
} from './crawler-contract'
import { createStaticEngine } from './crawler-static'

export interface CrawleeEngineOptions {
  /** Proxy URLs assigned deterministically across persistent browser workers. */
  proxyUrls?: string[]
  /** Max navigation timeout in ms. Default 30_000. */
  navigationTimeoutMs?: number
  /** Extra headers merged on every request. */
  defaultHeaders?: Record<string, string>
  /** Maximum number of concurrent rendered pages. Default 2; hard-capped at 8. */
  concurrency?: number
  /** Recycle each Chromium worker after this many page requests. Default 100. */
  maxRequestsPerBrowser?: number
  /** Recycle each Chromium worker after this lifetime. Default 15 minutes. */
  maxBrowserAgeMs?: number
  /** Close idle Chromium workers after this delay. Default 60 seconds. */
  idleBrowserTimeoutMs?: number
  /** Minimum delay between rendered requests to the same host. Default 250ms. */
  perHostMinIntervalMs?: number
  /** Consecutive host failures before opening the circuit. Default 3. */
  circuitFailureThreshold?: number
  /** Host circuit cool-down period. Default 60 seconds. */
  circuitResetMs?: number
}

export interface ManagedCrawlerEngine extends CrawlerEngine {
  close(): Promise<void>
}

interface SharedPlaywrightPool {
  fetchPage(input: {
    url: string
    timeoutMs?: number
    headers?: Record<string, string>
    previous?: { etag?: string; lastModified?: string }
    settleMs?: number
  }): Promise<{
    url: string
    status: number
    html: string | null
    rawHeaders: Record<string, string>
    fetchedAt: string
    warnings: string[]
  }>
  close(): Promise<void>
}

/** @deprecated Name retained for compatibility; implemented with Playwright directly. */
export function createCrawleeSpaEngine(
  options: CrawleeEngineOptions = {},
): ManagedCrawlerEngine {
  const pool = createPlaywrightBrowserPool(options) as SharedPlaywrightPool
  return {
    id: 'spa',
    capabilities: {
      rendersJs: true,
      returnsMarkdown: false,
      supportsPdf: false,
      selfHosted: false,
    },
    async fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      const result = await pool.fetchPage({
        url: input.url,
        timeoutMs: input.options?.timeoutMs ?? options.navigationTimeoutMs ?? 30_000,
        headers: input.options?.headers,
        previous: input.options?.previousValidators,
      })
      return { ...result, html: result.html ?? undefined, engine: 'spa' }
    },
    close(): Promise<void> {
      return pool.close()
    },
  }
}

/** @deprecated Name retained for compatibility; delegates to the static HTTP engine. */
export function createCrawleeStaticEngine(
  options: CrawleeEngineOptions = {},
): CrawlerEngine {
  const staticEngine = createStaticEngine()
  return {
    ...staticEngine,
    fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      return staticEngine.fetch({
        ...input,
        options: {
          ...input.options,
          headers: {
            ...options.defaultHeaders,
            ...(input.options?.headers ?? {}),
          },
        },
      })
    },
  }
}
