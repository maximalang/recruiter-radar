/**
 * Browser-backed crawler engines.
 *
 * The historical export names are retained for API compatibility, but the
 * implementation deliberately avoids the Crawlee fingerprint dependency
 * chain. Static pages use the existing hardened HTTP engine; SPA pages use
 * Playwright directly with one isolated browser context per request.
 */

import type {
  CrawlerEngine,
  CrawlerFetchInput,
  CrawlerResult,
} from './crawler-contract'
import { createStaticEngine } from './crawler-static'

export interface CrawleeEngineOptions {
  /** Proxy URLs; the first configured proxy is used for an isolated request. */
  proxyUrls?: string[]
  /** Max navigation timeout in ms. Default 30_000. */
  navigationTimeoutMs?: number
  /** Extra headers merged on every request. */
  defaultHeaders?: Record<string, string>
}

function resolveProxyUrls(explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) return explicit
  const envValue = process.env.CRAWLEE_PROXY_URLS?.trim()
  if (!envValue) return []
  return envValue.split(',').map((value) => value.trim()).filter(Boolean)
}

async function fetchWithPlaywright(
  url: string,
  options: CrawleeEngineOptions,
  fetchOptions?: CrawlerFetchInput['options'],
): Promise<CrawlerResult> {
  const { chromium } = await import('playwright')
  const proxyUrl = resolveProxyUrls(options.proxyUrls)[0]
  const timeout = fetchOptions?.timeoutMs ?? options.navigationTimeoutMs ?? 30_000
  const headers = {
    'accept-language': 'ru,en;q=0.9',
    ...options.defaultHeaders,
    ...(fetchOptions?.headers ?? {}),
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
  })

  try {
    const context = await browser.newContext({ extraHTTPHeaders: headers })
    const page = await context.newPage()
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    })

    return {
      url,
      status: response?.status() ?? 200,
      html: await page.content(),
      rawHeaders: response ? await response.allHeaders() : {},
      fetchedAt: new Date().toISOString(),
      engine: 'spa',
      warnings: response ? [] : ['Playwright navigation returned no HTTP response'],
    }
  } finally {
    await browser.close()
  }
}

/** @deprecated Name retained for compatibility; implemented with Playwright directly. */
export function createCrawleeSpaEngine(
  options: CrawleeEngineOptions = {},
): CrawlerEngine {
  return {
    id: 'spa',
    capabilities: {
      rendersJs: true,
      bypassesCloudflare: false,
      returnsMarkdown: false,
      supportsPdf: false,
      selfHosted: false,
    },
    fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      return fetchWithPlaywright(input.url, options, input.options)
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
