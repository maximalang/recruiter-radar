import { describe, it, expect } from '@jest/globals'
import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'
import type { CrawlerRouter } from '@/lib/sources/crawlers'
import type { HhDigestItem } from '@/lib/hhDigest'
import type { ScoredLead } from '@/lib/lead-discovery/lead-scoring-service'

const noopCrawler = {
  async fetch() {
    return {
      url: 'about:blank',
      status: 204,
      rawHeaders: {},
      fetchedAt: new Date().toISOString(),
      engine: 'static' as const,
      warnings: [],
    }
  },
} as unknown as CrawlerRouter

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

describe('LeadScoringService', () => {
  it('produces a scored lead with explainable breakdown', async () => {
    const service = new LeadScoringService({ crawler: noopCrawler })
    const leads = await service.generateAndScoreLeads({
      digestItems: [fakeDigestItem()],
      agencyProfile: {
        industries: ['IT'],
        locations: ['Moscow'],
        excludedIndustries: [],
        excludedLocations: [],
      },
    })

    expect(leads.length).toBeGreaterThan(0)
    const lead = leads[0]
    expect(lead).toHaveProperty('id')
    expect(lead.companyName).toBe('AcmeCorp')
    expect(lead).toHaveProperty('finalScore')
    expect(lead).toHaveProperty('confidence')
    expect(lead).toHaveProperty('scoringBreakdown')
    expect(typeof lead.finalScore).toBe('number')
  })

  it('filters by minScore', async () => {
    const service = new LeadScoringService({ crawler: noopCrawler })
    const leads = await service.generateAndScoreLeads({
      digestItems: [fakeDigestItem()],
      agencyProfile: {
        industries: ['IT'],
        locations: ['Moscow'],
        excludedIndustries: [],
        excludedLocations: [],
      },
      minScore: 999,
    })
    expect(leads).toEqual([])
  })

  it('returns null insights for empty leads', () => {
    const service = new LeadScoringService({ crawler: noopCrawler })
    const insights = service.getScoringInsights([])
    expect(insights).toBeNull()
  })

  it('aggregates insights across scored leads', () => {
    const service = new LeadScoringService({ crawler: noopCrawler })
    const sample: Array<Pick<ScoredLead, 'finalScore' | 'confidence'> & {
      enrichment?: { industry?: string[] }
      sources?: Array<{ sourceId: string }>
    }> = [
      { finalScore: 3.5, confidence: 'A', enrichment: { industry: ['IT'] }, sources: [{ sourceId: 'hh' }] },
      { finalScore: 2.0, confidence: 'B', enrichment: { industry: ['IT'] }, sources: [{ sourceId: 'career-pages' }] },
      { finalScore: 1.5, confidence: 'C', enrichment: { industry: ['Finance'] }, sources: [{ sourceId: 'hh' }] },
    ]

    const insights = service.getScoringInsights(sample)
    expect(insights).not.toBeNull()
    expect(insights!.total).toBe(3)
    expect(insights!.avgScore).toBeCloseTo((3.5 + 2.0 + 1.5) / 3, 5)
    expect(insights!.confidenceBreakdown).toMatchObject({ A: 1, B: 1, C: 1 })
    expect(insights!.topIndustries[0][0]).toBe('IT')
    expect(insights!.averageBySource['hh']).toBeCloseTo((3.5 + 1.5) / 2, 5)
  })
})
