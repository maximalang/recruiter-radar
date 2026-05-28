import { createStaticEngine } from '@/lib/sources/crawlers/crawler-static'
import type { CrawlerResult } from '@/lib/sources/crawlers/crawler-contract'

// Mock fetchText
jest.mock('@/../../packages/db/scripts/adapters/source-http.mjs', () => ({
  fetchText: jest.fn()
}))

const mockFetchText = require('@/../../packages/db/scripts/adapters/source-http.mjs').fetchText

describe('createStaticEngine', () => {
  beforeEach(() => {
    mockFetchText.mockClear()
  })

  describe('contract', () => {
    it('exposes id "static" and capability flags for raw HTML', () => {
      const engine = createStaticEngine()
      expect(engine.id).toBe('static')
      expect(engine.capabilities.rendersJs).toBe(false)
      expect(engine.capabilities.returnsMarkdown).toBe(false)
      expect(engine.capabilities.selfHosted).toBe(true)
    })

    it('returns a CrawlerResult with html, status, and engine id', async () => {
      mockFetchText.mockResolvedValueOnce({
        response: {
          ok: true,
          status: 200,
          url: 'https://acme.example/careers',
          headers: new Map([['content-type', 'text/html']])
        } as any,
        body: '<html><body>ok</body></html>'
      })

      const engine = createStaticEngine()
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
      let observedHeaders: Map<string, string> | null = null

      mockFetchText.mockImplementationOnce((url, options) => {
        observedHeaders = new Map(Object.entries(options.headers || {}))
        return Promise.resolve({
          response: {
            ok: true,
            status: 200,
            url,
            headers: new Map()
          } as any,
          body: '<html></html>'
        })
      })

      const engine = createStaticEngine()
      await engine.fetch({ url: 'https://acme.example' })

      expect(observedHeaders?.get('user-agent')?.toLowerCase()).toContain('recruiter-radar')
    })

    it('lets caller override headers', async () => {
      let observedHeaders: Map<string, string> | null = null

      mockFetchText.mockImplementationOnce((url, options) => {
        observedHeaders = new Map(Object.entries(options.headers || {}))
        return Promise.resolve({
          response: {
            ok: true,
            status: 200,
            url,
            headers: new Map()
          } as any,
          body: '<html></html>'
        })
      })

      const engine = createStaticEngine()
      await engine.fetch({
        url: 'https://acme.example',
        options: { headers: { 'user-agent': 'override-agent/1.0' } }
      })

      expect(observedHeaders?.get('user-agent')).toBe('override-agent/1.0')
    })
  })

  describe('error handling', () => {
    it('returns the response with non-2xx status without throwing', async () => {
      mockFetchText.mockResolvedValueOnce({
        response: {
          ok: false,
          status: 404,
          url: 'https://acme.example/missing',
          headers: new Map()
        } as any,
        body: 'not found'
      })

      const engine = createStaticEngine()
      const result = await engine.fetch({ url: 'https://acme.example/missing' })
      expect(result.status).toBe(404)
      expect(result.html).toBe('not found')
    })

    it('propagates network errors from the fetcher', async () => {
      mockFetchText.mockRejectedValueOnce(new Error('ECONNRESET'))

      const engine = createStaticEngine()
      await expect(
        engine.fetch({ url: 'https://acme.example' })
      ).rejects.toThrow('ECONNRESET')
    })
  })

  describe('headers in result', () => {
    it('exposes response headers in rawHeaders as a flat record', async () => {
      mockFetchText.mockResolvedValueOnce({
        response: {
          ok: true,
          status: 200,
          url: 'https://acme.example',
          headers: new Map([
            ['content-type', 'text/html'],
            ['x-custom-header', 'custom-value'],
            ['content-length', '123']
          ])
        } as any,
        body: '<html></html>'
      })

      const engine = createStaticEngine()
      const result = await engine.fetch({ url: 'https://acme.example' })

      expect(result.rawHeaders['content-type']).toContain('text/html')
      expect(result.rawHeaders['x-custom-header']).toBe('custom-value')
      expect(result.rawHeaders['content-length']).toBe('123')
    })
  })
})