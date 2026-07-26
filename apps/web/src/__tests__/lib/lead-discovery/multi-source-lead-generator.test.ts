// Mock getHhDigestItems before importing the generator
const mockGetHhDigestItems = jest.fn()
jest.mock('@/lib/hhDigest', () => ({
  getHhDigestItems: mockGetHhDigestItems,
}))

// Stub the crawler to avoid real HTTP requests. Shared fn so tests can assert
// which URLs the career-page enricher attempted to crawl.
//
// NOTE: `jest.mock('@/lib/sources/crawlers')` is a no-op under next/jest's SWC
// transform — the generator's static `@/`-aliased import of `createDefaultRouter`
// resolves past the mock registry, so the real network-backed router loads
// regardless of the factory. We therefore inject the stub through the
// constructor seam (`new MultiSourceLeadGenerator({ crawler })`) instead.
const mockCrawlerFetch = jest.fn<Promise<unknown>, [{ url: string }]>()

// Mock the DB pool so enrichWithCareerPages can resolve a corporate base URL.
// Use the established pattern (jest.fn() in the factory + jest.mocked handle):
// the global jest.setup.ts already mocks `lib/db`, so a literal-returning factory
// here is shadowed and getPool() comes back null. Recover the handle post-import.
const mockPoolQuery = jest.fn<Promise<{ rows: unknown[] }>, unknown[]>()
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}))

import {
  MultiSourceLeadGenerator,
  sourceIdToEvidenceType,
} from '@/lib/lead-discovery/multi-source-lead-generator'
import type { MultiSourceLead } from '@/lib/lead-discovery/multi-source-lead-generator'
import type { CrawlerRouter } from '@/lib/sources/crawlers'
import { getPool } from '@/lib/db'

// Inject the stub through the constructor seam. `fetch` is the only method the
// generator calls; cast covers the rest of the CrawlerRouter surface.
const crawlerStub = { fetch: mockCrawlerFetch } as unknown as CrawlerRouter

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>

const SAMPLE_DIGEST_ITEMS = [
  {
    rank: 1,
    org_id: 'org-1',
    hh_employer_id: 'emp-1',
    employer_name: 'TechCorp',
    vacancies_count: 5,
    distinct_vacancy_names_count: 3,
    latest_published_at: '2024-05-28T10:00:00Z',
    total_score: 350,
    reasons: ['high hiring activity', 'diverse roles'] as [string, string],
    opener: 'Компания активно нанимает',
    source_families: ['hh'],
    evidence_titles: ['Frontend Developer', 'Backend Developer', 'Product Manager'],
    candidate_source_keys: [],
    location_names: ['Москва'],
    confidence_gate: 'A' as const,
  },
  {
    rank: 2,
    org_id: 'org-2',
    hh_employer_id: 'emp-2',
    employer_name: 'DataFlow',
    vacancies_count: 2,
    distinct_vacancy_names_count: 2,
    latest_published_at: '2024-05-27T08:00:00Z',
    total_score: 200,
    reasons: ['moderate hiring', 'relevant roles'] as [string, string],
    opener: 'Стоит рассмотреть',
    source_families: ['hh'],
    evidence_titles: ['Data Engineer', 'ML Engineer'],
    candidate_source_keys: [],
    location_names: ['Санкт-Петербург'],
    confidence_gate: 'B' as const,
  },
]

describe('MultiSourceLeadGenerator', () => {
  let generator: MultiSourceLeadGenerator

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetHhDigestItems.mockResolvedValue(SAMPLE_DIGEST_ITEMS)
    // Default: crawler 404s (no career page found) and DB returns no orgs.
    mockCrawlerFetch.mockResolvedValue({
      status: 404,
      html: undefined,
      url: '',
      fetchedAt: new Date().toISOString(),
      warnings: [],
    })
    mockPoolQuery.mockResolvedValue({ rows: [] })
    mockGetPool.mockReturnValue({ query: mockPoolQuery } as never)
    generator = new MultiSourceLeadGenerator({ crawler: crawlerStub })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('initializeSources', () => {
    it('should initialize all available sources', () => {
      const sources = generator['sources']

      expect(sources.length).toBeGreaterThan(10)
      expect(sources.some(s => s.id === 'hh')).toBe(true)
      expect(sources.some(s => s.id === 'career-pages')).toBe(true)
      expect(sources.some(s => s.id === 'egrul-fns')).toBe(true)
    })

    it('should categorize sources by priority', () => {
      const sources = generator['sources']

      const p1Sources = sources.filter(s => s.priority === 'P1')
      const p2Sources = sources.filter(s => s.priority === 'P2')
      const p3Sources = sources.filter(s => s.priority === 'P3')

      expect(p1Sources.length).toBeGreaterThanOrEqual(3) // HH, Career Pages, Rabota Rossii
      expect(p2Sources.length).toBeGreaterThanOrEqual(4) // Multiple secondary sources
      expect(p3Sources.length).toBeGreaterThan(0) // Enrichment sources
    })
  })

  describe('source evidence policy', () => {
    it('keeps supporting and unknown sources out of corroboration-based promotion', () => {
      expect(sourceIdToEvidenceType('company-site')).toBe('news')
      expect(sourceIdToEvidenceType('unregistered-source')).toBe('news')
      expect(sourceIdToEvidenceType('fedresurs')).toBe('registry')
    })
  })

  describe('deduplication', () => {
    it('merges different org fragments when they carry the same valid INN', async () => {
      const fromHh = {
        id: 'lead-hh',
        companyId: 'org-hh-fragment',
        companyName: 'ООО ТехКорп',
        inn: '7701234567',
        score: 2.3,
        confidence: 'B',
        sources: [{
          sourceId: 'hh', sourceName: 'HeadHunter', evidenceType: 'vacancy',
          confidence: 0.74, extractedAt: new Date(), relevanceScore: 0.8,
        }],
        signals: [], nextAction: 'Review hiring', reasons: [], detectedAt: new Date(), enrichment: {},
      } as MultiSourceLead
      const fromRegistry = {
        id: 'lead-registry',
        companyId: 'org-registry-fragment',
        companyName: 'ТехКорп',
        inn: '7701234567',
        score: 2.1,
        confidence: 'C',
        sources: [{
          sourceId: 'egrul-fns', sourceName: 'EGRUL/FNS', evidenceType: 'registry',
          confidence: 0.9, extractedAt: new Date(), relevanceScore: 0.8,
        }],
        signals: [], nextAction: 'Review entity', reasons: [], detectedAt: new Date(), enrichment: {},
      } as MultiSourceLead

      const leads = await generator['deduplicateLeads']([fromHh, fromRegistry])

      expect(leads).toHaveLength(1)
      expect(leads[0].sources.map((source) => source.sourceId)).toEqual(
        expect.arrayContaining(['hh', 'egrul-fns']),
      )
    })
  })

  describe('getActiveSources', () => {
    it('should filter out non-eligible sources', () => {
      const activeSources = generator['activeSources']

      expect(activeSources).toContain('hh')
      expect(activeSources).toContain('career-pages')
      expect(activeSources).toContain('linkedin-company-pages') // P2 secondary source
      expect(activeSources).toContain('egrul-fns') // enrichment runs by default for lead quality
      expect(activeSources).not.toContain('company-site') // no generator step owns generic company-site crawling
    })
  })

  describe('generateLeads', () => {
    it('should generate HH-based leads from real DB data', async () => {
      const leads = await generator.generateLeads()

      expect(mockGetHhDigestItems).toHaveBeenCalledWith({ clientProfileId: null })
      expect(leads.length).toBeGreaterThan(0)
      expect(leads[0]).toMatchObject({
        id: expect.stringMatching(/^multi-/),
        companyId: expect.any(String),
        companyName: expect.any(String),
        score: expect.any(Number),
        confidence: expect.any(String),
        sources: expect.any(Array),
        signals: expect.any(Array)
      })
    })

    it('should pass clientProfileId to getHhDigestItems', async () => {
      await generator.generateLeads({ clientProfileId: 'profile-123' })

      expect(mockGetHhDigestItems).toHaveBeenCalledWith({ clientProfileId: 'profile-123' })
    })

    it('should filter leads by minimum score', async () => {
      const leads = await generator.generateLeads({ minScore: 2.0 })

      leads.forEach(lead => {
        expect(lead.score).toBeGreaterThanOrEqual(2.0)
      })
    })

    it('filters out leads outside the requested Russian regions', async () => {
      const leads = await generator.generateLeads({ regions: ['Екатеринбург'] })

      expect(leads).toEqual([])
    })

    it('should limit sources when specified', async () => {
      const leads = await generator.generateLeads({
        sources: ['hh', 'career-pages']
      })

      leads.forEach(lead => {
        const sourceIds = lead.sources.map(s => s.sourceId)
        expect(sourceIds).toEqual(expect.arrayContaining(['hh']))
      })
    })

    it('does not return job-board candidates when no job-board source was selected', async () => {
      const leads = await generator.generateLeads({
        sources: ['career-pages'],
      })

      expect(leads).toEqual([])
    })

    it('keeps supporting evidence when a selected job-board source originated the candidate', async () => {
      mockGetHhDigestItems.mockResolvedValue([{
        ...SAMPLE_DIGEST_ITEMS[0],
        source_families: ['hh', 'fedresurs'],
      }])

      const leads = await generator.generateLeads({ sources: ['hh'] })

      expect(leads).toHaveLength(1)
      expect(leads[0].sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: 'hh' }),
        expect.objectContaining({ sourceId: 'fedresurs', confidence: 0.62 }),
      ]))
    })

    it('should return empty array when no digest items found', async () => {
      mockGetHhDigestItems.mockResolvedValue([])

      const leads = await generator.generateLeads()

      expect(leads).toEqual([])
    })

    it('should not recalculate score in filterAndRankLeads', async () => {
      // Score should come from DB/detector, not from a multiplier formula
      const leads = await generator.generateLeads()

      // The score from digestToLeadCandidates is total_score/100
      // For sample items: 350/100 = 3.5, 200/100 = 2.0
      const scores = leads.map(l => l.score)
      expect(scores).toContain(3.5)
      expect(scores).toContain(2.0)
    })
  })

  describe('getSourceAnalytics', () => {
    it('should calculate source statistics', async () => {
      const leads = await generator.generateLeads()
      const analytics = generator.getSourceAnalytics(leads)

      expect(analytics).toMatchObject({
        totalLeads: expect.any(Number),
        sources: expect.any(Array),
        coverage: expect.any(Object)
      })

      expect(analytics.sources[0]).toMatchObject({
        id: expect.any(String),
        count: expect.any(Number),
        totalRelevance: expect.any(Number)
      })
    })
  })

  describe('real-time crawling', () => {
    it('should accept enableRealTime option', async () => {
      const leads = await generator.generateLeads({ enableRealTime: true })

      expect(leads.length).toBeGreaterThan(0)
    })
  })

  describe('enrichWithCareerPages domain fallback', () => {
    // Regression: HH-sourced orgs have website_url but never domain; egrul/
    // company-site/rf orgs have domain but not always website_url. Selecting on
    // website_url alone silently skipped the career-page crawl for domain-only
    // orgs, zeroing their FIUR reachability. The enricher must derive an https
    // base from `domain` when `website_url` is null.
    function resolveOrgBase(query: string): boolean {
      return /SELECT id, website_url, domain FROM orgs/i.test(query)
    }

    it('crawls https://{domain}/careers when website_url is null', async () => {
      mockPoolQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && resolveOrgBase(sql)) {
          return {
            rows: [
              { id: 'org-1', website_url: null, domain: 'techcorp.ru' },
              { id: 'org-2', website_url: 'https://dataflow.io', domain: null },
            ],
          }
        }
        return { rows: [] }
      })

      await generator.generateLeads({ enableRealTime: true })

      const crawledUrls = mockCrawlerFetch.mock.calls.map(([input]) => (input as { url: string }).url)
      // Domain-only org: derived from `domain`.
      expect(crawledUrls).toContain('https://techcorp.ru/careers')
      // Website org: still uses website_url (regression guard).
      expect(crawledUrls).toContain('https://dataflow.io/careers')
    })

    it('strips a scheme accidentally stored in domain before deriving the base', async () => {
      mockPoolQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && resolveOrgBase(sql)) {
          return { rows: [{ id: 'org-1', website_url: null, domain: 'https://techcorp.ru/' }] }
        }
        return { rows: [] }
      })

      await generator.generateLeads({ enableRealTime: true })

      const crawledUrls = mockCrawlerFetch.mock.calls.map(([input]) => (input as { url: string }).url)
      expect(crawledUrls).toContain('https://techcorp.ru/careers')
      // Must not double the scheme.
      expect(crawledUrls.some(u => /https:\/\/https/.test(u))).toBe(false)
    })

    it('skips orgs with neither website_url nor domain', async () => {
      mockPoolQuery.mockImplementation(async (sql: unknown) => {
        // The query now filters these out at the SQL level, but assert the
        // enricher attempts no crawl when the row set is empty.
        if (typeof sql === 'string' && resolveOrgBase(sql)) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      await generator.generateLeads({ enableRealTime: true })

      const careerCrawls = mockCrawlerFetch.mock.calls
        .map(([input]) => (input as { url: string }).url)
        .filter(u => u.includes('/careers'))
      expect(careerCrawls).toHaveLength(0)
    })
  })

  describe('enrichWithCareerPages multi-path probe (universality)', () => {
    // Regression guard for the 2026-07-06 universality fix: non-IT companies
    // publish vacancies under /vacancies, /jobs, /career, /about/vacancies,
    // etc. — NOT only /careers. The probe must try the RU-native path set
    // (mirroring the career-pages source script) and accept the first 200+HTML
    // response, so a non-IT company still gets direct career-page evidence
    // (the only route to gate A/B) instead of being silently stuck at gate C.
    function resolveOrgBase(query: string): boolean {
      return /SELECT id, website_url, domain FROM orgs/i.test(query)
    }

    it('resolves /vacancies when /careers 404s — non-IT URL convention', async () => {
      mockPoolQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && resolveOrgBase(sql)) {
          return {
            rows: [{ id: 'org-1', website_url: 'https://zavod-ural.ru', domain: null }],
          }
        }
        return { rows: [] }
      })

      // Homepage + /careers 404; /vacancies returns 200+HTML.
      mockCrawlerFetch.mockImplementation(async (input: { url: string }) => {
        if (input.url === 'https://zavod-ural.ru/vacancies') {
          return {
            status: 200,
            html: '<html><body>Вакансии завода</body></html>',
            url: input.url,
            fetchedAt: new Date().toISOString(),
            warnings: [],
          }
        }
        return {
          status: 404,
          html: undefined,
          url: input.url,
          fetchedAt: new Date().toISOString(),
          warnings: [],
        }
      })

      const leads = await generator.generateLeads({ enableRealTime: true })

      const lead = leads.find(l => l.companyId === 'org-1')
      expect(lead).toBeDefined()
      // Direct career-page evidence attached with the resolved /vacancies URL.
      expect(lead!.sources.some(s => s.sourceId === 'career-pages')).toBe(true)
      expect(lead!.enrichment.hasCareerPage).toBe(true)
      expect(lead!.enrichment.careerPageUrl).toBe('https://zavod-ural.ru/vacancies')
    })

    it('resolves /jobs when /careers and /vacancies both 404', async () => {
      mockPoolQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && resolveOrgBase(sql)) {
          return {
            rows: [{ id: 'org-1', website_url: 'https://logistic-pro.ru', domain: null }],
          }
        }
        return { rows: [] }
      })

      mockCrawlerFetch.mockImplementation(async (input: { url: string }) => {
        if (input.url === 'https://logistic-pro.ru/jobs') {
          return {
            status: 200,
            html: '<html><body>Jobs</body></html>',
            url: input.url,
            fetchedAt: new Date().toISOString(),
            warnings: [],
          }
        }
        return {
          status: 404,
          html: undefined,
          url: input.url,
          fetchedAt: new Date().toISOString(),
          warnings: [],
        }
      })

      const leads = await generator.generateLeads({ enableRealTime: true })

      const lead = leads.find(l => l.companyId === 'org-1')
      expect(lead).toBeDefined()
      expect(lead!.enrichment.hasCareerPage).toBe(true)
      expect(lead!.enrichment.careerPageUrl).toBe('https://logistic-pro.ru/jobs')
    })

    it('falls back to a same-domain careers link mined from the homepage HTML', async () => {
      mockPoolQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && resolveOrgBase(sql)) {
          return {
            rows: [{ id: 'org-1', website_url: 'https://retail-south.ru', domain: null }],
          }
        }
        return { rows: [] }
      })

      // Homepage returns HTML with a same-domain /company/vacancies link;
      // every path variant 404s; the mined link itself returns 200+HTML.
      mockCrawlerFetch.mockImplementation(async (input: { url: string }) => {
        // The probe normalizes the base by stripping trailing slashes, so the
        // homepage candidate is `https://retail-south.ru` (no slash). Accept
        // both forms — the real crawler normalizes the same way.
        if (input.url === 'https://retail-south.ru' || input.url === 'https://retail-south.ru/') {
          return {
            status: 200,
            html: '<html><a href="/company/vacancies">Вакансии</a></html>',
            url: input.url,
            fetchedAt: new Date().toISOString(),
            warnings: [],
          }
        }
        if (input.url === 'https://retail-south.ru/company/vacancies') {
          return {
            status: 200,
            html: '<html><body>Открытые вакансии</body></html>',
            url: input.url,
            fetchedAt: new Date().toISOString(),
            warnings: [],
          }
        }
        return {
          status: 404,
          html: undefined,
          url: input.url,
          fetchedAt: new Date().toISOString(),
          warnings: [],
        }
      })

      const leads = await generator.generateLeads({ enableRealTime: true })

      const lead = leads.find(l => l.companyId === 'org-1')
      expect(lead).toBeDefined()
      expect(lead!.enrichment.hasCareerPage).toBe(true)
      expect(lead!.enrichment.careerPageUrl).toBe('https://retail-south.ru/company/vacancies')
    })

    it('records hasCareerPage=false and no evidence when no path hits', async () => {
      mockPoolQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && resolveOrgBase(sql)) {
          return {
            rows: [{ id: 'org-1', website_url: 'https://no-careers.example', domain: null }],
          }
        }
        return { rows: [] }
      })

      // Everything 404s — no career page, no inflation.
      mockCrawlerFetch.mockResolvedValue({
        status: 404,
        html: undefined,
        url: '',
        fetchedAt: new Date().toISOString(),
        warnings: [],
      })

      const leads = await generator.generateLeads({ enableRealTime: true })

      const lead = leads.find(l => l.companyId === 'org-1')
      expect(lead).toBeDefined()
      expect(lead!.enrichment.hasCareerPage).toBe(false)
      expect(lead!.sources.some(s => s.sourceId === 'career-pages')).toBe(false)
    })

    it('extractSameDomainCareerLinkFromHtml only matches same-host links', () => {
      const { extractSameDomainCareerLinkFromHtml } = jest.requireActual<
        typeof import('@/lib/lead-discovery/multi-source-lead-generator')
      >('@/lib/lead-discovery/multi-source-lead-generator')

      const html = `
        <a href="https://boards.greenhouse.io/acme">External ATS</a>
        <a href="https://example.ru/about">About</a>
        <a href="https://example.ru/careers">Careers</a>
      `
      expect(extractSameDomainCareerLinkFromHtml(html, 'https://example.ru')).toBe(
        'https://example.ru/careers',
      )
      // No same-domain career link → null (external ATS intentionally ignored).
      const externalOnly = '<a href="https://boards.greenhouse.io/acme">ATS</a>'
      expect(extractSameDomainCareerLinkFromHtml(externalOnly, 'https://example.ru')).toBeNull()
    })
  })
})
