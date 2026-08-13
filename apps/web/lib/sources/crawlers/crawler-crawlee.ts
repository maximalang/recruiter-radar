/**
 * Browser-backed crawler engines.
 *
 * The historical export names are retained for API compatibility. Static
 * pages use the hardened HTTP engine; rendered pages use a bounded pool of
 * persistent Playwright browser workers. Every request still receives a new
 * isolated BrowserContext, while the expensive Chromium process is reused and
 * recycled after a bounded request count or lifetime.
 */

import type { Browser, BrowserContext } from 'playwright'
import type {
  CrawlerEngine,
  CrawlerFetchInput,
  CrawlerResult,
} from './crawler-contract'
import { createStaticEngine } from './crawler-static'

const DEFAULT_CONCURRENCY = 2
const DEFAULT_MAX_REQUESTS_PER_BROWSER = 100
const DEFAULT_MAX_BROWSER_AGE_MS = 15 * 60_000
const DEFAULT_IDLE_BROWSER_TIMEOUT_MS = 60_000

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
}

export interface ManagedCrawlerEngine extends CrawlerEngine {
  close(): Promise<void>
}

interface BrowserWorker {
  index: number
  browser: Browser | null
  launchedAt: number
  requests: number
  busy: boolean
}

interface WorkerWaiter {
  resolve: (worker: BrowserWorker) => void
  reject: (error: Error) => void
}

function resolveProxyUrls(explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) return explicit
  const envValue = process.env.CRAWLEE_PROXY_URLS?.trim()
  if (!envValue) return []
  return envValue.split(',').map((value) => value.trim()).filter(Boolean)
}

function readPositiveInteger(
  explicit: number | undefined,
  envName: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const envValue = process.env[envName]?.trim()
  const candidate = explicit ?? (envValue ? Number(envValue) : fallback)
  if (!Number.isFinite(candidate) || candidate < 1) return fallback
  return Math.min(Math.floor(candidate), maximum)
}

class PlaywrightBrowserPool {
  private readonly workers: BrowserWorker[]
  private readonly waiters: WorkerWaiter[] = []
  private readonly proxyUrls: string[]
  private readonly maxRequestsPerBrowser: number
  private readonly maxBrowserAgeMs: number
  private readonly idleBrowserTimeoutMs: number
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(private readonly options: CrawleeEngineOptions) {
    const concurrency = readPositiveInteger(
      options.concurrency,
      'PLAYWRIGHT_BROWSER_CONCURRENCY',
      DEFAULT_CONCURRENCY,
      8,
    )
    this.maxRequestsPerBrowser = readPositiveInteger(
      options.maxRequestsPerBrowser,
      'PLAYWRIGHT_BROWSER_MAX_REQUESTS',
      DEFAULT_MAX_REQUESTS_PER_BROWSER,
    )
    this.maxBrowserAgeMs = readPositiveInteger(
      options.maxBrowserAgeMs,
      'PLAYWRIGHT_BROWSER_MAX_AGE_MS',
      DEFAULT_MAX_BROWSER_AGE_MS,
    )
    this.idleBrowserTimeoutMs = readPositiveInteger(
      options.idleBrowserTimeoutMs,
      'PLAYWRIGHT_BROWSER_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_BROWSER_TIMEOUT_MS,
    )
    this.proxyUrls = resolveProxyUrls(options.proxyUrls)
    this.workers = Array.from({ length: concurrency }, (_, index) => ({
      index,
      browser: null,
      launchedAt: 0,
      requests: 0,
      busy: false,
    }))
  }

  async fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
    const worker = await this.acquire()
    let context: BrowserContext | null = null
    try {
      const browser = await this.getBrowser(worker)
      const timeout = input.options?.timeoutMs ?? this.options.navigationTimeoutMs ?? 30_000
      const headers = {
        'accept-language': 'ru,en;q=0.9',
        ...this.options.defaultHeaders,
        ...(input.options?.headers ?? {}),
      }
      context = await browser.newContext({ extraHTTPHeaders: headers })
      const page = await context.newPage()
      const response = await page.goto(input.url, {
        waitUntil: 'domcontentloaded',
        timeout,
      })

      return {
        url: input.url,
        status: response?.status() ?? 200,
        html: await page.content(),
        rawHeaders: response ? await response.allHeaders() : {},
        fetchedAt: new Date().toISOString(),
        engine: 'spa',
        warnings: response ? [] : ['Playwright navigation returned no HTTP response'],
      }
    } finally {
      worker.requests++
      if (context) await context.close().catch(() => undefined)
      this.release(worker)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.clearIdleTimer()
    const error = new Error('Playwright browser pool is closed')
    while (this.waiters.length > 0) this.waiters.shift()?.reject(error)
    await this.recycleAllBrowsers()
  }

  private async acquire(): Promise<BrowserWorker> {
    if (this.closed) throw new Error('Playwright browser pool is closed')
    this.clearIdleTimer()
    const available = this.workers.find((worker) => !worker.busy)
    if (available) {
      available.busy = true
      return available
    }
    return new Promise<BrowserWorker>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  private release(worker: BrowserWorker): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve(worker)
      return
    }
    worker.busy = false
    if (this.workers.every((candidate) => !candidate.busy)) this.scheduleIdleRecycle()
  }

  private async getBrowser(worker: BrowserWorker): Promise<Browser> {
    const expired = worker.browser && (
      worker.requests >= this.maxRequestsPerBrowser
      || Date.now() - worker.launchedAt >= this.maxBrowserAgeMs
    )
    if (expired) await this.recycleBrowser(worker)
    if (worker.browser) return worker.browser

    const { chromium } = await import('playwright')
    const proxyUrl = this.proxyUrls.length > 0
      ? this.proxyUrls[worker.index % this.proxyUrls.length]
      : undefined
    worker.browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
    })
    worker.launchedAt = Date.now()
    worker.requests = 0
    return worker.browser
  }

  private async recycleBrowser(worker: BrowserWorker): Promise<void> {
    const browser = worker.browser
    worker.browser = null
    worker.launchedAt = 0
    worker.requests = 0
    if (browser) await browser.close().catch(() => undefined)
  }

  private async recycleAllBrowsers(): Promise<void> {
    await Promise.all(this.workers.map((worker) => this.recycleBrowser(worker)))
  }

  private scheduleIdleRecycle(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      void this.recycleAllBrowsers()
    }, this.idleBrowserTimeoutMs)
    this.idleTimer.unref?.()
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}

/** @deprecated Name retained for compatibility; implemented with Playwright directly. */
export function createCrawleeSpaEngine(
  options: CrawleeEngineOptions = {},
): ManagedCrawlerEngine {
  const pool = new PlaywrightBrowserPool(options)
  return {
    id: 'spa',
    capabilities: {
      rendersJs: true,
      returnsMarkdown: false,
      supportsPdf: false,
      selfHosted: false,
    },
    fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      return pool.fetch(input)
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
