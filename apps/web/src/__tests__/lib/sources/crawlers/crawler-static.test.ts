import { createStaticEngine } from '@/lib/sources/crawlers/crawler-static'
import type { CrawlerResult } from '@/lib/sources/crawlers/crawler-contract'

function fakeResponse(opts: {
  status?: number
  body?: string
  headers?: Record<string, string>
} = {}): Response {
  const { status = 200, body = '<html></html>', headers = {} } = opts
  return new Response(body, { status, headers })
}

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
      const engine = createStaticEngine({
        fetcher: async () => fakeResponse({ body: '<html><body>ok</body></html>' }),
      })
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
      let observed: Headers | undefined
      const engine = createStaticEngine({
        fetcher: async (_url, init) => {
          observed = new Headers(init?.headers)
          return fakeResponse()
        },
      })
      await engine.fetch({ url: 'https://acme.example' })
      expect(observed?.get('user-agent')?.toLowerCase()).toContain('recruiter-radar')
    })

    it('lets caller override headers', async () => {
      let observed: Headers | undefined
      const engine = createStaticEngine({
        fetcher: async (_url, init) => {
          observed = new Headers(init?.headers)
          return fakeResponse()
        },
      })
      await engine.fetch({
        url: 'https://acme.example',
        options: { headers: { 'user-agent': 'override-agent/1.0' } },
      })
      expect(observed?.get('user-agent')).toBe('override-agent/1.0')
    })
  })

  describe('error handling', () => {
    it('returns the response with non-2xx status without throwing', async () => {
      const engine = createStaticEngine({
        fetcher: async () => fakeResponse({ status: 404, body: 'not found' }),
      })
      const result = await engine.fetch({ url: 'https://acme.example/missing' })
      expect(result.status).toBe(404)
      expect(result.html).toBe('not found')
    })

    it('propagates network errors from the fetcher', async () => {
      const engine = createStaticEngine({
        fetcher: async () => {
          throw new Error('econnreset')
        },
      })
      await expect(
        engine.fetch({ url: 'https://acme.example' }),
      ).rejects.toThrow(/econnreset/)
    })
  })

  describe('headers in result', () => {
    it('exposes response headers in rawHeaders as a flat record', async () => {
      const engine = createStaticEngine({
        fetcher: async () =>
          fakeResponse({
            body: '<html></html>',
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
      })
      const result = await engine.fetch({ url: 'https://acme.example' })
      expect(result.rawHeaders['content-type']).toContain('text/html')
    })
  })
})
