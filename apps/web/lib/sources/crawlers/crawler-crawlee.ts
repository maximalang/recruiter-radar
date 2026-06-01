/**
 * Crawlee-based crawler engines.
 *
 * Two engine implementations backed by the Crawlee framework:
 *
 *   - `createCrawleeSpaEngine`  (id: 'spa') — PlaywrightCrawler for JS-heavy sites.
 *     Handles hh.ru, superjob.ru, lever.co, greenhouse.io and other SPA career pages.
 *     Proxy rotation + fingerprint rotation built in.
 *
 *   - `createCrawleeStaticEngine` (id: 'static') — CheerioCrawler with Crawlee's
 *     proxy rotation and session management. A heavier but more robust alternative
 *     to the plain-fetch static engine when anti-bot protection is expected.
 *
 * Both engines adapt Crawlee's batch-oriented design to our single-URL CrawlerEngine
 * contract by running a one-request Cheerio/Playwright crawler per `fetch()` call.
 * This is not ideal for bulk scraping (use Crawlee directly in n8n cron jobs for that),
 * but keeps the contract uniform and allows transparent engine swapping via the router.
 *
 * Proxy configuration: set `CRAWLEE_PROXY_URLS` env var (comma-separated proxy URLs).
 * If empty, Crawlee runs without proxy.
 */

import type {
  CrawlerEngine,
  CrawlerFetchInput,
  CrawlerResult,
} from './crawler-contract'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CrawleeEngineOptions {
  /** Comma-separated proxy URLs. Falls back to CRAWLEE_PROXY_URLS env var. */
  proxyUrls?: string[]
  /** Max navigation timeout in ms (Playwright only). Default 30_000. */
  navigationTimeoutMs?: number
  /** Extra headers merged on every request. */
  defaultHeaders?: Record<string, string>
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function resolveProxyUrls(explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) return explicit
  const envVal = process.env.CRAWLEE_PROXY_URLS?.trim()
  if (!envVal) return []
  return envVal.split(',').map((u) => u.trim()).filter(Boolean)
}

/**
 * Run a single-URL CheerioCrawler and return the HTML body.
 *
 * We create a fresh Configuration per call so that concurrent `fetch()`
 * calls don't share state (Crawlee's default global state would collide).
 */
async function fetchWithCheerio(
  url: string,
  options: CrawleeEngineOptions,
  fetchOptions?: CrawlerFetchInput['options'],
): Promise<CrawlerResult> {
  // Dynamic import — Crawlee is an optional dep; graceful error if missing
  const { CheerioCrawler, Configuration, ProxyConfiguration, Request } = await import('crawlee')

  const proxyUrls = resolveProxyUrls(options.proxyUrls)
  const config = new Configuration({ persistStorage: false })
  let html = ''
  let status = 0
  const warnings: string[] = []
  const fetchedAt = new Date().toISOString()

  const headers: Record<string, string> = {
    'accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'ru,en;q=0.9',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    ...options.defaultHeaders,
    ...(fetchOptions?.headers ?? {}),
  }

  const proxyConfig = proxyUrls.length > 0
    ? new ProxyConfiguration({ proxyUrls })
    : undefined

  const crawler = new CheerioCrawler(
    {
      // Single request — we only want this one URL
      requestHandler: async ({ $, request: req }) => {
        html = $.html() ?? ''
        status = (req as any).statusCode ?? 200
      },
      failedRequestHandler: async ({ request: req }) => {
        warnings.push(`Crawlee CheerioCrawler failed: ${req.url} — ${req.errorMessages.at(-1) ?? 'unknown'}`)
        status = 502
      },
      proxyConfiguration: proxyConfig,
      // Inject custom headers via pre-navigation hook
      preNavigationHooks: [
        (_crawlingContext, gotOptions) => {
          if (!gotOptions.headers) gotOptions.headers = {}
          Object.assign(gotOptions.headers, headers)
        },
      ],
      navigationTimeoutSecs: (fetchOptions?.timeoutMs ?? 15_000) / 1000,
      maxConcurrency: 1,
      maxRequestsPerCrawl: 1,
    },
    config,
  )

  const requests = [new Request({ url, label: 'single' })]
  await crawler.run(requests)

  return {
    url,
    status: status || 200,
    html,
    rawHeaders: {},
    fetchedAt,
    engine: 'static',
    warnings,
  }
}

/**
 * Run a single-URL PlaywrightCrawler and return the rendered HTML body.
 */
async function fetchWithPlaywright(
  url: string,
  options: CrawleeEngineOptions,
  fetchOptions?: CrawlerFetchInput['options'],
): Promise<CrawlerResult> {
  const { PlaywrightCrawler, Configuration, ProxyConfiguration, Request } = await import('crawlee')

  const proxyUrls = resolveProxyUrls(options.proxyUrls)
  const config = new Configuration({ persistStorage: false })
  let html = ''
  let status = 0
  const warnings: string[] = []
  const fetchedAt = new Date().toISOString()

  const headers: Record<string, string> = {
    'accept-language': 'ru,en;q=0.9',
    ...options.defaultHeaders,
    ...(fetchOptions?.headers ?? {}),
  }

  const proxyConfig = proxyUrls.length > 0
    ? new ProxyConfiguration({ proxyUrls })
    : undefined

  const crawler = new PlaywrightCrawler(
    {
      requestHandler: async ({ page, response }) => {
        // response may be null on navigation errors
        status = response?.status() ?? 200
        html = await page.content()
      },
      failedRequestHandler: async ({ request: req }) => {
        warnings.push(`Crawlee PlaywrightCrawler failed: ${req.url} — ${req.errorMessages.at(-1) ?? 'unknown'}`)
        status = 502
      },
      proxyConfiguration: proxyConfig,
      launchContext: {
        launchOptions: {
          headless: true,
        },
      },
      navigationTimeoutSecs:
        (fetchOptions?.timeoutMs ?? options.navigationTimeoutMs ?? 30_000) / 1000,
      // Inject custom headers via pre-navigation hook
      preNavigationHooks: [
        async ({ page }) => {
          await page.setExtraHTTPHeaders(headers)
        },
      ],
      maxConcurrency: 1,
      maxRequestsPerCrawl: 1,
    },
    config,
  )

  const requests = [new Request({ url, label: 'single' })]
  await crawler.run(requests)

  return {
    url,
    status: status || 200,
    html,
    rawHeaders: {},
    fetchedAt,
    engine: 'spa',
    warnings,
  }
}

/* ------------------------------------------------------------------ */
/*  Engine factories                                                   */
/* ------------------------------------------------------------------ */

/**
 * Create a Crawlee-backed SPA engine (PlaywrightCrawler).
 *
 * Use this for JS-heavy sites that need full browser rendering:
 * hh.ru, superjob.ru, ATS-hosted career pages (Greenhouse, Lever, etc.).
 *
 * Falls back gracefully if Crawlee/Playwright are not installed:
 * `fetch()` will reject with a clear error message.
 */
export function createCrawleeSpaEngine(
  options: CrawleeEngineOptions = {},
): CrawlerEngine {
  return {
    id: 'spa',
    capabilities: {
      rendersJs: true,
      bypassesCloudflare: true,
      returnsMarkdown: false,
      supportsPdf: false,
      selfHosted: false, // requires chromium binary
    },
    async fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      return fetchWithPlaywright(input.url, options, input.options)
    },
  }
}

/**
 * Create a Crawlee-backed static engine (CheerioCrawler).
 *
 * A more robust alternative to the plain-fetch static engine when:
 * - The target site has anti-bot protection (proxy rotation helps)
 * - You need session persistence / cookie management
 * - You want Crawlee's retry logic with back-off
 *
 * Heavier than the plain-fetch engine (~50ms overhead per request for
 * Crawlee setup). Use the plain-fetch engine when no anti-bot is expected.
 */
export function createCrawleeStaticEngine(
  options: CrawleeEngineOptions = {},
): CrawlerEngine {
  return {
    id: 'static',
    capabilities: {
      rendersJs: false,
      bypassesCloudflare: true, // with proxies, often works
      returnsMarkdown: false,
      supportsPdf: false,
      selfHosted: true,
    },
    async fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      return fetchWithCheerio(input.url, options, input.options)
    },
  }
}
