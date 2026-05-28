import { createPlaywrightEngine } from '@/lib/sources/crawlers/crawler-playwright'
import type {
  PlaywrightLauncher,
  PlaywrightBrowserLike,
  PlaywrightContextLike,
  PlaywrightPageLike,
} from '@/lib/sources/crawlers/crawler-playwright'

interface FakePageOptions {
  rendered?: string
  status?: number
  gotoError?: Error
}

function createFakeStack(opts: FakePageOptions = {}) {
  const closed = { page: false, context: false, browser: false }
  const navigations: Array<{ url: string; waitUntil?: string; timeout?: number }> = []

  const page: PlaywrightPageLike = {
    async goto(url, gotoOpts) {
      navigations.push({ url, waitUntil: gotoOpts?.waitUntil, timeout: gotoOpts?.timeout })
      if (opts.gotoError) throw opts.gotoError
      return { status: () => opts.status ?? 200 }
    },
    async content() {
      return opts.rendered ?? '<html><body>spa-rendered</body></html>'
    },
    async close() {
      closed.page = true
    },
  }

  const context: PlaywrightContextLike = {
    async newPage() {
      return page
    },
    async close() {
      closed.context = true
    },
  }

  const browser: PlaywrightBrowserLike = {
    async newContext() {
      return context
    },
    async close() {
      closed.browser = true
    },
  }

  const launcher: PlaywrightLauncher = async () => browser

  return { launcher, closed, navigations }
}

describe('createPlaywrightEngine', () => {
  describe('contract', () => {
    it('exposes id "spa" and JS-rendering capabilities', () => {
      const { launcher } = createFakeStack()
      const engine = createPlaywrightEngine({ launcher })
      expect(engine.id).toBe('spa')
      expect(engine.capabilities.rendersJs).toBe(true)
      expect(engine.capabilities.returnsMarkdown).toBe(false)
      expect(engine.capabilities.selfHosted).toBe(true)
    })

    it('returns a CrawlerResult with rendered HTML, status, and engine="spa"', async () => {
      const { launcher } = createFakeStack({ rendered: '<html><body>hydrated</body></html>' })
      const engine = createPlaywrightEngine({ launcher })
      const result = await engine.fetch({ url: 'https://boards.greenhouse.io/acme' })
      expect(result.url).toBe('https://boards.greenhouse.io/acme')
      expect(result.status).toBe(200)
      expect(result.html).toContain('hydrated')
      expect(result.engine).toBe('spa')
      expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('navigation', () => {
    it('navigates to the requested URL with networkidle wait', async () => {
      const { launcher, navigations } = createFakeStack()
      const engine = createPlaywrightEngine({ launcher })
      await engine.fetch({ url: 'https://jobs.lever.co/acme/role-id' })
      expect(navigations).toHaveLength(1)
      expect(navigations[0]?.url).toBe('https://jobs.lever.co/acme/role-id')
      expect(navigations[0]?.waitUntil).toBe('networkidle')
    })

    it('honours per-request timeout', async () => {
      const { launcher, navigations } = createFakeStack()
      const engine = createPlaywrightEngine({ launcher })
      await engine.fetch({
        url: 'https://jobs.lever.co/acme',
        options: { timeoutMs: 5000 },
      })
      expect(navigations[0]?.timeout).toBe(5000)
    })
  })

  describe('resource lifecycle', () => {
    it('closes page, context, and browser even on success', async () => {
      const { launcher, closed } = createFakeStack()
      const engine = createPlaywrightEngine({ launcher })
      await engine.fetch({ url: 'https://boards.greenhouse.io/acme' })
      expect(closed.page).toBe(true)
      expect(closed.context).toBe(true)
      expect(closed.browser).toBe(true)
    })

    it('closes resources when navigation throws', async () => {
      const { launcher, closed } = createFakeStack({
        gotoError: new Error('Timeout 30000ms exceeded.'),
      })
      const engine = createPlaywrightEngine({ launcher })
      await expect(
        engine.fetch({ url: 'https://boards.greenhouse.io/acme' }),
      ).rejects.toThrow(/Timeout/)
      expect(closed.context).toBe(true)
      expect(closed.browser).toBe(true)
    })
  })

  describe('non-2xx response', () => {
    it('returns CrawlerResult with the response status without throwing', async () => {
      const { launcher } = createFakeStack({ status: 404, rendered: '<html>not found</html>' })
      const engine = createPlaywrightEngine({ launcher })
      const result = await engine.fetch({ url: 'https://boards.greenhouse.io/missing' })
      expect(result.status).toBe(404)
      expect(result.html).toContain('not found')
    })
  })

  describe('user-agent', () => {
    it('passes the configured user-agent on context creation', async () => {
      let observedUserAgent: string | undefined
      const browser: PlaywrightBrowserLike = {
        async newContext(opts) {
          observedUserAgent = opts?.userAgent
          return {
            async newPage() {
              return {
                async goto() {
                  return { status: () => 200 }
                },
                async content() {
                  return '<html></html>'
                },
                async close() {},
              }
            },
            async close() {},
          }
        },
        async close() {},
      }
      const launcher: PlaywrightLauncher = async () => browser
      const engine = createPlaywrightEngine({
        launcher,
        defaultUserAgent: 'recruiter-radar-spa/1.0',
      })
      await engine.fetch({ url: 'https://boards.greenhouse.io/acme' })
      expect(observedUserAgent).toBe('recruiter-radar-spa/1.0')
    })
  })
})
