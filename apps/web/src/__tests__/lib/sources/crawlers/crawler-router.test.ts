import { chooseEngine, createCrawlerRouter } from '@/lib/sources/crawlers/crawler-router'
import type { CrawlerEngine, CrawlerEngineId, CrawlerResult } from '@/lib/sources/crawlers/crawler-contract'

function fakeEngine(id: CrawlerEngineId): CrawlerEngine {
  return {
    id,
    capabilities: {
      rendersJs: id === 'spa',
      bypassesCloudflare: false,
      returnsMarkdown: id === 'llm-markdown',
      supportsPdf: id === 'llm-markdown',
      selfHosted: true,
    },
    async fetch({ url }): Promise<CrawlerResult> {
      return {
        url,
        status: 200,
        html: `<from-${id}>`,
        rawHeaders: {},
        fetchedAt: '2026-05-26T12:00:00.000Z',
        engine: id,
        warnings: [],
      }
    },
  }
}

describe('chooseEngine', () => {
  describe('static is the safe default', () => {
    it('returns static for plain career-page hosts', () => {
      expect(chooseEngine('https://acme.ru/careers')).toBe('static')
      expect(chooseEngine('https://yandex.ru/jobs')).toBe('static')
    })

    it('returns static for unknown / new hosts', () => {
      expect(chooseEngine('https://unknown-host.example/careers')).toBe('static')
    })
  })

  describe('SPA allow-list', () => {
    it('returns spa for greenhouse, lever, ashby, workday, smartrecruiters', () => {
      expect(chooseEngine('https://boards.greenhouse.io/acme')).toBe('spa')
      expect(chooseEngine('https://jobs.lever.co/acme')).toBe('spa')
      expect(chooseEngine('https://jobs.ashbyhq.com/acme')).toBe('spa')
      expect(chooseEngine('https://acme.wd1.myworkdayjobs.com/External')).toBe('spa')
      expect(chooseEngine('https://jobs.smartrecruiters.com/Acme')).toBe('spa')
    })

    it('matches subdomains of SPA hosts', () => {
      expect(chooseEngine('https://acme.greenhouse.io/jobs')).toBe('spa')
    })
  })

  describe('hint takes precedence over host detection', () => {
    it('returns the hinted engine even for static hosts', () => {
      expect(chooseEngine('https://acme.ru/careers', 'spa')).toBe('spa')
      expect(chooseEngine('https://acme.ru/news', 'newsroom')).toBe('llm-markdown')
      expect(chooseEngine('https://acme.ru/whitepaper.pdf', 'pdf')).toBe('llm-markdown')
    })

    it('static hint downgrades a SPA host', () => {
      expect(chooseEngine('https://boards.greenhouse.io/acme', 'static')).toBe('static')
    })
  })

  describe('input safety', () => {
    it('returns static for malformed URLs without throwing', () => {
      expect(chooseEngine('not a url')).toBe('static')
      expect(chooseEngine('')).toBe('static')
    })
  })
})

describe('createCrawlerRouter', () => {
  it('dispatches to the engine selected by chooseEngine', async () => {
    const router = createCrawlerRouter({
      static: fakeEngine('static'),
      spa: fakeEngine('spa'),
      'llm-markdown': fakeEngine('llm-markdown'),
    })
    const r1 = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(r1.engine).toBe('static')

    const r2 = await router.fetch({ url: 'https://boards.greenhouse.io/acme' })
    expect(r2.engine).toBe('spa')
  })

  it('honours an explicit hint', async () => {
    const router = createCrawlerRouter({
      static: fakeEngine('static'),
      spa: fakeEngine('spa'),
      'llm-markdown': fakeEngine('llm-markdown'),
    })
    const r = await router.fetch({
      url: 'https://acme.ru/news',
      options: { hint: 'newsroom' },
    })
    expect(r.engine).toBe('llm-markdown')
  })

  it('falls back to static when the requested engine is not registered', async () => {
    const router = createCrawlerRouter({ static: fakeEngine('static') })
    const r = await router.fetch({ url: 'https://boards.greenhouse.io/acme' })
    expect(r.engine).toBe('static')
    expect(r.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/spa.*not registered/i)]),
    )
  })

  it('throws when no engine can serve the request (no static fallback)', async () => {
    const router = createCrawlerRouter({ spa: fakeEngine('spa') })
    await expect(
      router.fetch({ url: 'https://acme.ru/careers' }),
    ).rejects.toThrow(/no.*engine/i)
  })
})
