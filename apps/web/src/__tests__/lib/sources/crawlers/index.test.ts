import { createDefaultRouter } from '@/lib/sources/crawlers'

jest.mock('@/../../packages/db/scripts/adapters/source-http.mjs', () => ({
  fetchText: jest.fn()
}))

const { fetchText: mockFetchText } = jest.requireMock(
  '@/../../packages/db/scripts/adapters/source-http.mjs'
) as { fetchText: jest.Mock }

describe('createDefaultRouter', () => {
  beforeEach(() => {
    mockFetchText.mockClear()
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

  it('warns and falls back when SPA host is requested without spa engine', async () => {
    const router = createDefaultRouter({
      staticEngine: {
        fetcher: async () => new Response('<html></html>', { status: 200 }),
      },
    })
    const result = await router.fetch({ url: 'https://boards.greenhouse.io/acme' })
    expect(result.engine).toBe('static')
    expect(result.warnings.some((w) => /spa.*not registered/i.test(w))).toBe(true)
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
