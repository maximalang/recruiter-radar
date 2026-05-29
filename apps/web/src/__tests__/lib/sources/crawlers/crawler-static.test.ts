import { createStaticEngine } from '@/lib/sources/crawlers/crawler-static'
import type { CrawlerResult } from '@/lib/sources/crawlers/crawler-contract'

describe('createStaticEngine', () => {
  describe('contract', () => {
    it('exposes id "static" and capability flags for raw HTML', () => {
      const engine = createStaticEngine()
      expect(engine.id).toBe('static')
      expect(engine.capabilities.rendersJs).toBe(false)
      expect(engine.capabilities.returnsMarkdown).toBe(false)
      expect(engine.capabilities.selfHosted).toBe(true)
    })

    it('returns a CrawlerResult with html, status, and engine id', async () => {
      const mockResponse = new Response('<html><body>ok</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
      const engine = createStaticEngine({ fetcher: async () => mockResponse })
      const result: CrawlerResult = await engine.fetch({ url: 'https://acme.example/careers' })
      expect(result.url).toBe('https://acme.example/careers')
      expect(result.status).toBe(200)
      expect(result.html).toContain('<body>ok</body>')
      expect(result.engine).toBe('static')
      expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('headers and options', () => {
    it('passes a default User-Agent identifying the radar', async () => {
      let observedHeaders: Record<string, string> | null = null

      const engine = createStaticEngine({
        fetcher: async (_url, init) => {
          observedHeaders = (init?.headers as Record<string, string>) ?? {}
          return new Response('<html></html>', { status: 200 })
        },
      })
      await engine.fetch({ url: 'https://acme.example' })

      expect(observedHeaders?.['user-agent']?.toLowerCase()).toContain('recruiter-radar')
    })

    it('lets caller override headers', async () => {
      let observedHeaders: Record<string, string> | null = null

      const engine = createStaticEngine({
        fetcher: async (_url, init) => {
          observedHeaders = (init?.headers as Record<string, string>) ?? {}
          return new Response('<html></html>', { status: 200 })
        },
      })
      await engine.fetch({
        url: 'https://acme.example',
        options: { headers: { 'user-agent': 'override-agent/1.0' } },
      })

      expect(observedHeaders?.['user-agent']).toBe('override-agent/1.0')
    })
  })

  describe('error handling', () => {
    it('returns the response with non-2xx status without throwing', async () => {
      const engine = createStaticEngine({
        fetcher: async () => new Response('not found', { status: 404 }),
      })
      const result = await engine.fetch({ url: 'https://acme.example/missing' })
      expect(result.status).toBe(404)
      expect(result.html).toBe('not found')
    })

    it('propagates network errors from the fetcher', async () => {
      const engine = createStaticEngine({
        fetcher: async () => { throw new Error('ECONNRESET') },
      })
      await expect(
        engine.fetch({ url: 'https://acme.example' }),
      ).rejects.toThrow('ECONNRESET')
    })
  })

  describe('headers in result', () => {
    it('exposes response headers in rawHeaders as a flat record', async () => {
      const engine = createStaticEngine({
        fetcher: async () => new Response('<html></html>', {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'x-custom-header': 'custom-value',
            'content-length': '123',
          },
        }),
      })
      const result = await engine.fetch({ url: 'https://acme.example' })

      expect(result.rawHeaders['content-type']).toContain('text/html')
      expect(result.rawHeaders['x-custom-header']).toBe('custom-value')
      expect(result.rawHeaders['content-length']).toBe('123')
    })
  })
})
