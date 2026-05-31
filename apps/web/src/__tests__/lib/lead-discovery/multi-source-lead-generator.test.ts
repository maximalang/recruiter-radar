import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'

// Mock getHhDigestItems before importing the generator
const mockGetHhDigestItems = jest.fn()
jest.mock('@/lib/hhDigest', () => ({
  getHhDigestItems: mockGetHhDigestItems,
}))

// Mock the crawler to avoid real HTTP requests
jest.mock('@/lib/sources/crawlers', () => ({
  createDefaultRouter: () => ({
    fetch: jest.fn().mockResolvedValue({
      status: 404,
      html: undefined,
      url: '',
      fetchedAt: new Date().toISOString(),
      warnings: [],
    }),
  }),
}))

import { MultiSourceLeadGenerator } from '@/lib/lead-discovery/multi-source-lead-generator'

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
    generator = new MultiSourceLeadGenerator()
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

  describe('getActiveSources', () => {
    it('should filter out non-eligible sources', () => {
      const activeSources = generator['activeSources']

      expect(activeSources).toContain('hh')
      expect(activeSources).toContain('career-pages')
      expect(activeSources).toContain('linkedin-company-pages') // P2 secondary source
      expect(activeSources).not.toContain('egrul-fns') // P3 enrichment-only is excluded
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

    it('should limit sources when specified', async () => {
      const leads = await generator.generateLeads({
        sources: ['hh', 'career-pages']
      })

      leads.forEach(lead => {
        const sourceIds = lead.sources.map(s => s.sourceId)
        expect(sourceIds).toEqual(expect.arrayContaining(['hh']))
      })
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
        avgConfidence: expect.any(Number),
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
})
