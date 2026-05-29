/**
 * Playwright crawler engine.
 *
 * Renders JS-driven SPAs (Greenhouse, Lever, Ashby, Workday, SmartRecruiters,
 * etc.) before returning HTML, so adapters that expect a DOM with content
 * can parse the result the same way they parse a static page.
 *
 * Playwright is loaded lazily via the `launcher` option to keep the engine
 * trivially testable and to keep the +300MB chromium binary an opt-in
 * dependency. Tests inject a fake launcher that returns a stub browser;
 * production wires `createDefaultPlaywrightLauncher()` (see bottom of file)
 * which dynamically imports `playwright`.
 *
 * Errors: navigation failures and timeouts propagate. Non-2xx responses are
 * returned as CrawlerResult so adapters can decide whether to retry or
 * escalate. Resources (page/context/browser) are always closed in `finally`.
 */

import type {
  CrawlerEngine,
  CrawlerFetchInput,
  CrawlerResult,
} from './crawler-contract'

const DEFAULT_USER_AGENT = 'recruiter-radar/1.0 (+https://recruiter-radar.local)'
const DEFAULT_TIMEOUT_MS = 30_000

export interface PlaywrightGotoOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
  timeout?: number
}

export interface PlaywrightResponseLike {
  status(): number
}

export interface PlaywrightPageLike {
  goto(url: string, options?: PlaywrightGotoOptions): Promise<PlaywrightResponseLike | null>
  content(): Promise<string>
  close(): Promise<void>
}

export interface PlaywrightContextOptions {
  userAgent?: string
}

export interface PlaywrightContextLike {
  newPage(): Promise<PlaywrightPageLike>
  close(): Promise<void>
}

export interface PlaywrightBrowserLike {
  newContext(options?: PlaywrightContextOptions): Promise<PlaywrightContextLike>
  close(): Promise<void>
}

export type PlaywrightLauncher = () => Promise<PlaywrightBrowserLike>

export interface CreatePlaywrightEngineOptions {
  /** Factory that returns a browser. Required — production wires the real chromium launcher. */
  launcher: PlaywrightLauncher
  /** UA passed to `browser.newContext({ userAgent })`. Per-request headers override below. */
  defaultUserAgent?: string
}

async function safeClose(closer: { close(): Promise<void> } | null | undefined): Promise<void> {
  if (!closer) return
  try {
    await closer.close()
  } catch {
    // closing best-effort; do not mask the original error
  }
}

export function createPlaywrightEngine(
  options: CreatePlaywrightEngineOptions,
): CrawlerEngine {
  const { launcher } = options
  const defaultUa = options.defaultUserAgent ?? DEFAULT_USER_AGENT

  return {
    id: 'spa',
    capabilities: {
      rendersJs: true,
      bypassesCloudflare: false,
      returnsMarkdown: false,
      supportsPdf: false,
      selfHosted: true,
    },
    async fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      const { url, options: opts = {} } = input
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const userAgent = opts.headers?.['user-agent'] ?? opts.headers?.['User-Agent'] ?? defaultUa

      let browser: PlaywrightBrowserLike | null = null
      let context: PlaywrightContextLike | null = null
      let page: PlaywrightPageLike | null = null

      try {
        browser = await launcher()
        context = await browser.newContext({ userAgent })
        page = await context.newPage()

        const response = await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: timeoutMs,
        })
        const status = response?.status() ?? 0
        const html = await page.content()

        return {
          url,
          status,
          html,
          rawHeaders: {},
          fetchedAt: new Date().toISOString(),
          engine: 'spa',
          warnings: [],
        }
      } finally {
        await safeClose(page)
        await safeClose(context)
        await safeClose(browser)
      }
    },
  }
}

/**
 * Production launcher that lazy-imports `playwright`. Throws a clear error
 * if the dependency is missing so the router can report it instead of
 * crashing with a generic module-not-found.
 *
 * Wire this from the call site only when `process.env.CRAWLER_PLAYWRIGHT=1`
 * (or a similar opt-in) so static-only environments don't pay the
 * +300MB chromium cost.
 */
export interface DefaultPlaywrightLauncherOptions {
  /** Override chromium launch args (sandbox, proxy, etc.). */
  launchArgs?: string[]
  /** Persistent profile path for cookies / login state. */
  storageStatePath?: string
  /** Headless mode. Defaults to true. */
  headless?: boolean
}

export function createDefaultPlaywrightLauncher(
  options: DefaultPlaywrightLauncherOptions = {},
): PlaywrightLauncher {
  return async () => {
    let playwrightModule: { chromium: { launch(opts: unknown): Promise<PlaywrightBrowserLike> } }
    try {
      // playwright is an optional opt-in dep (see CRAWLER_PLAYWRIGHT env). The
      // dynamic import string keeps tsc from resolving it when the package is
      // not installed in static-only environments.
      const moduleName = 'playwright'
      playwrightModule = (await import(/* webpackIgnore: true */ moduleName)) as never
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `crawler-playwright: failed to load "playwright" module — install with ` +
          `\`npm i -D playwright\` and run \`npx playwright install chromium\`. Original error: ${reason}`,
      )
    }
    return playwrightModule.chromium.launch({
      headless: options.headless ?? true,
      args: options.launchArgs,
    })
  }
}
