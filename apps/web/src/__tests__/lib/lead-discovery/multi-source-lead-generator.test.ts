import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import {
  MultiSourceLeadGenerator,
  type MultiSourceLeadGeneratorDeps,
  type CareerPageFetchResult,
  type BusinessSignalEvidence,
  type RegistryEvidence,
  type MultiSourceLead,
} from '@/lib/lead-discovery/multi-source-lead-generator'
import type { CrawlerRouter, CrawlerResult } from '@/lib/sources/crawlers'
import type { HhDigestItem } from '@/lib/hhDigest'

function fakeDigestItem(overrides: Partial<HhDigestItem> = {}): HhDigestItem {
  return {
    rank: 1,
    org_id: 'org-1',
    hh_employer_id: 'emp-1',
    employer_name: 'AcmeCorp',
    vacancies_count: 5,
    distinct_vacancy_names_count: 3,
    latest_published_at: '2026-05-25T10:00:00Z',
    total_score: 350,
    reasons: ['high hiring activity', 'diverse roles'],
    opener: 'Компания активно нанимает',
    source_families: ['hh'],
    evidence_titles: ['Frontend Developer', 'Backend Developer', 'Product Manager'],
    candidate_source_keys: [],
    location_names: ['Москва'],
    ...overrides,
  }
}

function stubCrawler(result?: Partial<CrawlerResult>): CrawlerRouter {
  return {
    async fetch() {
      return {
        url: result?.url ?? 'https://example.com',
        status: result?.status ?? 200,
        html: result?.html ?? '<html></html>',
        rawHeaders: result?.rawHeaders ?? {},
        fetchedAt: result?.fetchedAt ?? new Date().toISOString(),
        engine: result?.engine ?? 'static',
        warnings: result?.warnings ?? [],
      }
    },
  } as unknown as CrawlerRouter
}

describe('MultiSourceLeadGenerator', () => {
  let generator: MultiSourceLeadGenerator

  beforeEach(() => {
    generator = new MultiSourceLeadGenerator({ crawler: stubCrawler() })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns an empty array when no digest items are provided', async () => {
    const leads = await generator.generateLeads({ digestItems: [] })
    expect(leads).toEqual([])
  })

  it('converts digest items into multi-source leads with HH evidence', async () => {
    const leads = await generator.generateLeads({
      digestItems: [fakeDigestItem()],
    })

    expect(leads.length).toBeGreaterThan(0)
    const lead = leads[0]
    expect(lead.id).toMatch(/^multi-/)
    expect(lead.companyId).toBe('org-1')
    expect(lead.companyName).toBe('AcmeCorp')
    expect(lead.sources.map(s => s.sourceId)).toContain('hh')
  })

  it('filters leads by minimum score', async () => {
    const leads = await generator.generateLeads({
      digestItems: [fakeDigestItem()],
      minScore: 999,
    })
    expect(leads).toEqual([])
  })

  it('uses the injected career-page fetcher in parallel and adds evidence', async () => {
    const fetchCareerPage = jest.fn(
      async (lead: MultiSourceLead): Promise<CareerPageFetchResult> => ({
        url: `https://${lead.companyName}.com/careers`,
        fetchedAt: new Date('2026-05-26T10:00:00Z'),
        rawData: { vacancies: 3 },
      }),
    )
    const resolveCareerPageUrl = (lead: MultiSourceLead) => `https://${lead.companyName}.com/careers`

    const deps: MultiSourceLeadGeneratorDeps = {
      crawler: stubCrawler(),
      resolveCareerPageUrl,
      fetchCareerPage,
    }
    const gen = new MultiSourceLeadGenerator(deps)
    const leads = await gen.generateLeads({
      digestItems: [
        fakeDigestItem({ org_id: 'org-1' }),
        fakeDigestItem({ org_id: 'org-2', employer_name: 'Beta Inc' }),
      ],
      sources: ['hh', 'career-pages'],
    })

    expect(fetchCareerPage).toHaveBeenCalledTimes(2)
    leads.forEach(lead => {
      expect(lead.sources.map(s => s.sourceId)).toEqual(expect.arrayContaining(['hh', 'career-pages']))
    })
  })

  it('skips registry adapter when source is not requested', async () => {
    const fetchRegistryData = jest.fn<
      (lead: MultiSourceLead) => Promise<RegistryEvidence>
    >(async () => ({ rawData: { inn: 'X' }, enrichment: { companySize: 'medium' } }))

    const gen = new MultiSourceLeadGenerator({ crawler: stubCrawler(), fetchRegistryData })
    await gen.generateLeads({
      digestItems: [fakeDigestItem()],
      sources: ['hh'],
    })

    expect(fetchRegistryData).not.toHaveBeenCalled()
  })

  it('logs and continues when an enrichment adapter throws', async () => {
    const warn = jest.fn()
    const fetchBusinessSignals = jest.fn<
      (lead: MultiSourceLead) => Promise<BusinessSignalEvidence>
    >(async () => {
      throw new Error('upstream timeout')
    })
    const gen = new MultiSourceLeadGenerator({
      crawler: stubCrawler(),
      fetchBusinessSignals,
      logger: { warn },
    })
    const leads = await gen.generateLeads({
      digestItems: [fakeDigestItem()],
      sources: ['hh', 'funding-business-signals'],
    })

    expect(leads.length).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalledWith(
      'business-signal enrichment failed',
      expect.objectContaining({ companyId: 'org-1' }),
    )
  })

  it('produces source analytics with safe averages on empty input', () => {
    const analytics = generator.getSourceAnalytics([])
    expect(analytics).toEqual({
      totalLeads: 0,
      sources: [],
      coverage: {
        totalCompanies: 0,
        avgSourcesPerLead: 0,
        highConfidenceLeads: 0,
        enrichedLeads: 0,
      },
    })
  })

  it('reports per-source averages across leads', async () => {
    const leads = await generator.generateLeads({
      digestItems: [
        fakeDigestItem({ org_id: 'org-1' }),
        fakeDigestItem({ org_id: 'org-2', employer_name: 'Beta Inc' }),
      ],
    })
    const analytics = generator.getSourceAnalytics(leads)
    expect(analytics.totalLeads).toBe(leads.length)
    const hhStats = analytics.sources.find(s => s.id === 'hh')
    expect(hhStats?.count).toBe(leads.length)
    expect(hhStats?.avgConfidence).toBeGreaterThan(0)
  })
})
