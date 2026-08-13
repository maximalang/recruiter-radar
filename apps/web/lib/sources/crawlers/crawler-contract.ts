/**
 * CrawlerEngine contract.
 *
 * Pluggable abstraction for "how to fetch a page". Engines vary in cost,
 * capabilities, and the kind of artifact they return (raw HTML, rendered
 * HTML after JS execution, LLM-friendly markdown). Source adapters call
 * the engine they need via the router and stay agnostic to the underlying
 * HTTP / browser / sidecar that actually delivers the bytes.
 *
 * Engine ids:
 *   - 'static'      — HTTP fetch, no JS render. Default for static career pages.
 *   - 'spa'         — Headless browser (Playwright). For JS-rendered pages.
 *   - 'llm-markdown'— Sidecar that returns clean markdown (Crawl4AI). For
 *                     newsroom / PDF / LLM evidence summary feed.
 *
 * Router policy lives in crawler-router.ts. Adapters import only the
 * router, never specific engines, so engine selection is a single
 * configuration point.
 */

export type CrawlerEngineId = 'static' | 'spa' | 'llm-markdown'

export interface CrawlerCapabilities {
  rendersJs: boolean
  returnsMarkdown: boolean
  supportsPdf: boolean
  selfHosted: boolean
}

export interface CrawlerOptions {
  /** Per-request timeout in ms. Engines may apply their own minimum. */
  timeoutMs?: number
  /** Total retry attempts across transient failures (default 3). */
  retries?: number
  /** Optional outbound request headers. Engine merges with safe defaults. */
  headers?: Record<string, string>
  /** Caller-controlled abort. */
  signal?: AbortSignal
  /** Hint for the router; engines themselves ignore this field. */
  hint?: 'static' | 'spa' | 'pdf' | 'newsroom'
  /** Identifier for logs / rate-limit buckets. */
  sourceName?: string
  /** Optional HTTP validators for a conditional render request. */
  previousValidators?: { etag?: string; lastModified?: string }
}

export interface CrawlerResult {
  url: string
  status: number
  /** Raw HTML body — always populated for 'static' and 'spa'. */
  html?: string
  /** LLM-friendly markdown — populated for 'llm-markdown'. */
  markdown?: string
  /** Plain text fallback when no HTML/markdown is available. */
  text?: string
  rawHeaders: Record<string, string>
  /** ISO timestamp when the engine completed the fetch. */
  fetchedAt: string
  engine: CrawlerEngineId
  warnings: string[]
  /** True when the upstream returned 304 and no new body was rendered. */
  notModified?: boolean
  /** Bounded upstream validators callers may persist for the next request. */
  validators?: { etag: string | null; lastModified: string | null }
}

export interface CrawlerFetchInput {
  url: string
  options?: CrawlerOptions
}

export interface CrawlerEngine {
  readonly id: CrawlerEngineId
  readonly capabilities: CrawlerCapabilities
  fetch(input: CrawlerFetchInput): Promise<CrawlerResult>
}
