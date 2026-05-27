import { createDefaultRouter } from '@/lib/sources/crawlers'

describe('createDefaultRouter', () => {
  it('returns a router that serves static URLs out of the box', async () => {
    const router = createDefaultRouter({
      staticEngine: {
        fetcher: async (url) => new Response(`<html><h1>${url}</h1></html>`, { status: 200 }),
      },
    })
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
            bypassesCloudflare: false,
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
