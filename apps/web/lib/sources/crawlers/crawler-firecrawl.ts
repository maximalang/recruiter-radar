/**
 * Firecrawl-based crawler engine.
 *
 * Engine id: `'llm-markdown'` — matches the existing `CrawlerEngineId` type.
 *
 * Uses the Firecrawl service (SaaS or self-hosted) to convert web pages into
 * clean Markdown or structured JSON via schema-based extraction. Perfect for:
 *
 *   - Career pages with unknown HTML structure (Greenhouse, Lever, Workday, custom)
 *   - Newsroom / press release pages with cluttered HTML
 *   - PDF pages (job descriptions embedded in PDF)
 *
 * When Firecrawl is not configured (missing `FIRECRAWL_API_KEY` env var),
 * `createFirecrawlEngine` returns an engine that falls back to the static
 * engine with a warning, so the router never breaks.
 *
 * Configuration:
 *   - `FIRECRAWL_API_KEY` — required. SaaS key or self-hosted key.
 *   - `FIRECRAWL_API_URL` — optional. Defaults to `https://api.firecrawl.dev/v1`.
 *     Set to your self-hosted instance URL (e.g. `http://localhost:3002/v1`).
 */

import type {
  CrawlerEngine,
  CrawlerFetchInput,
  CrawlerResult,
} from './crawler-contract'
import { createStaticEngine } from './crawler-static'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FirecrawlEngineOptions {
  /** Firecrawl API key. Falls back to FIRECRAWL_API_KEY env var. */
  apiKey?: string
  /** Firecrawl API base URL. Falls back to FIRECRAWL_API_URL env var. */
  apiUrl?: string
  /**
   * Inject an existing static engine as the fallback path.
   * If omitted, a default static engine is created internally.
   * Pass the primary router's static engine to avoid creating a duplicate.
   */
  fallbackEngine?: CrawlerEngine
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resolveApiKey(explicit?: string): string | undefined {
  return explicit?.trim() || process.env.FIRECRAWL_API_KEY?.trim() || undefined
}

function resolveApiUrl(explicit?: string): string {
  return explicit?.trim() || process.env.FIRECRAWL_API_URL?.trim() || 'https://api.firecrawl.dev/v1'
}

/* ------------------------------------------------------------------ */
/*  Engine factory                                                     */
/* ------------------------------------------------------------------ */

/**
 * Create a Firecrawl-backed LLM-markdown engine.
 *
 * Behaviour:
 *   1. If `FIRECRAWL_API_KEY` is set → use Firecrawl to scrape the page and
 *      return clean Markdown + extracted metadata.
 *   2. If not set → fall back to the static engine with a warning, so callers
 *      always get a result (just without the LLM-quality extraction).
 *
 * The engine returns `CrawlerResult.markdown` (populated by Firecrawl) and
 * `CrawlerResult.html` (empty — Firecrawl's value is clean text, not raw HTML).
 */
export function createFirecrawlEngine(
  options: FirecrawlEngineOptions = {},
): CrawlerEngine {
  const apiKey = resolveApiKey(options.apiKey)
  const apiUrl = resolveApiUrl(options.apiUrl)
  const fallback = options.fallbackEngine ?? createStaticEngine()

  return {
    id: 'llm-markdown',
    capabilities: {
      rendersJs: true, // Firecrawl renders JS server-side
      returnsMarkdown: true,
      supportsPdf: true,
      selfHosted: apiUrl !== 'https://api.firecrawl.dev/v1',
    },
    async fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      if (!apiKey) {
        // Fallback to static engine with a warning
        const result = await fallback.fetch(input)
        return {
          ...result,
          engine: 'llm-markdown',
          warnings: [
            'Firecrawl API key not configured — falling back to static engine',
            ...result.warnings,
          ],
        }
      }

      try {
        return await fetchWithFirecrawl(input, apiKey, apiUrl)
      } catch (error) {
        // Firecrawl error → fallback to static with warning
        const result = await fallback.fetch(input)
        const errMsg =
          error instanceof Error ? error.message : String(error)
        return {
          ...result,
          engine: 'llm-markdown',
          warnings: [
            `Firecrawl error: ${errMsg} — falling back to static engine`,
            ...result.warnings,
          ],
        }
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/*  Firecrawl API call                                                 */
/* ------------------------------------------------------------------ */

async function fetchWithFirecrawl(
  input: CrawlerFetchInput,
  apiKey: string,
  apiUrl: string,
): Promise<CrawlerResult> {
  // Dynamic import — Firecrawl SDK is an optional dep
  const FirecrawlApp = (await import('@mendable/firecrawl-js')).default

  const app = new FirecrawlApp({ apiKey, apiUrl })

  // scrapeUrl returns Document on success, throws SdkError on failure
  const doc = await app.scrapeUrl(input.url, {
    formats: ['markdown'],
    timeout: input.options?.timeoutMs ?? 30_000,
  })

  const markdown: string = doc.markdown ?? ''
  const metadata = doc.metadata ?? {}

  return {
    url: input.url,
    status: (metadata as Record<string, unknown>).statusCode as number ?? 200,
    html: undefined, // Firecrawl's value is clean markdown, not raw HTML
    markdown,
    text: markdown, // text as alias for markdown
    rawHeaders: {},
    fetchedAt: new Date().toISOString(),
    engine: 'llm-markdown',
    warnings: [],
  }
}
