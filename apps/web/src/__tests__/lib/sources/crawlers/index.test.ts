import { createDefaultRouter } from '@/lib/sources/crawlers'

const browserResponse = {
  status: () => 200,
  allHeaders: async () => ({ 'content-type': 'text/html' }),
  url: () => 'https://boards.greenhouse.io/acme',
}
const browserGoto = jest.fn(async () => browserResponse)
const browserContent = jest.fn(async () => '<html><main>Rendered jobs</main></html>')
const browserContextClose = jest.fn(async () => undefined)
const browserNewContext = jest.fn(async () => ({
  route: async () => undefined,
  newPage: async () => ({
    goto: browserGoto,
    content: browserContent,
    waitForTimeout: async () => undefined,
  }),
  close: browserContextClose,
}))
const browserClose = jest.fn(async () => undefined)
const browserLaunch = jest.fn(async () => ({
  newContext: browserNewContext,
  close: browserClose,
}))

jest.mock('playwright', () => ({ chromium: { launch: browserLaunch } }))

jest.mock('@/../../packages/db/scripts/adapters/source-http.mjs', () => ({
  fetchText: jest.fn()
}))

const { fetchText: mockFetchText } = jest.requireMock(
  '@/../../packages/db/scripts/adapters/source-http.mjs'
) as { fetchText: jest.Mock }

describe('createDefaultRouter', () => {
  beforeEach(() => {
    mockFetchText.mockClear()
    browserGoto.mockClear()
    browserContent.mockClear()
    browserContextClose.mockClear()
    browserNewContext.mockClear()
    browserClose.mockClear()
    browserLaunch.mockClear()
  })

  it('returns a router that serves static URLs out of the box', async () => {
    mockFetchText.mockImplementation((url) => Promise.resolve({
      response: {
        ok: true,
        status: 200,
        url,
        headers: new Map()
      } as any,
      body: `<html><h1>${url}</h1></html>`
    }))

    const router = createDefaultRouter()
    const result = await router.fetch({ url: 'https://acme.example/careers' })
    expect(result.engine).toBe('static')
    expect(result.html).toContain('https://acme.example/careers')
  })

  it('routes a supported SPA host through the default rendered engine', async () => {
    const router = createDefaultRouter({
      staticEngine: {
        fetcher: async () => new Response('<html></html>', { status: 200 }),
      },
      crawlee: {
        dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
        perHostMinIntervalMs: 0,
      },
    })
    const result = await router.fetch({ url: 'https://boards.greenhouse.io/acme' })
    expect(result.engine).toBe('spa')
    expect(result.html).toContain('Rendered jobs')
    expect(browserLaunch).toHaveBeenCalledTimes(1)
    expect(browserContextClose).toHaveBeenCalledTimes(1)
    await router.close()
    expect(browserClose).toHaveBeenCalledTimes(1)
  })

  it('lets caller register extra engines via extraEngines', async () => {
    const router = createDefaultRouter({
      staticEngine: {
        fetcher: async () => new Response('<html></html>', { status: 200 }),
      },
      extraEngines: {
        spa: {
          id: 'spa',
          capabilities: {
            rendersJs: true,
            returnsMarkdown: false,
            supportsPdf: false,
            selfHosted: true,
          },
          async fetch({ url }) {
            return {
              url,
              status: 200,
              html: '<rendered/>',
              rawHeaders: {},
              fetchedAt: '2026-05-26T12:00:00.000Z',
              engine: 'spa',
              warnings: [],
            }
          },
        },
      },
    })
    const result = await router.fetch({ url: 'https://boards.greenhouse.io/acme' })
    expect(result.engine).toBe('spa')
    expect(result.html).toBe('<rendered/>')
  })
})
