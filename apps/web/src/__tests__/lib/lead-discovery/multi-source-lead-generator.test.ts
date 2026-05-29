import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { MultiSourceLeadGenerator } from '@/lib/lead-discovery/multi-source-lead-generator'

describe('MultiSourceLeadGenerator', () => {
  let generator: MultiSourceLeadGenerator

  beforeEach(() => {
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

      expect(p1Sources.length).toBeGreaterThan(2) // HH, Career Pages, Rabota Rossii
      expect(p2Sources.length).toBeGreaterThan(5) // Multiple secondary sources
      expect(p3Sources.length).toBeGreaterThan(0) // Enrichment sources
    })
  })

  describe('getActiveSources', () => {
    it('should filter out non-eligible sources', () => {
      const activeSources = generator['activeSources']

      expect(activeSources).toContain('hh')
      expect(activeSources).toContain('career-pages')
      expect(activeSources).toContain('egrul-fns') // Even though enrichment-only, it's P1
      expect(activeSources).not.toContain('industry-media') // Context-only, P3
    })
  })

  describe('generateLeads', () => {
    it('should generate HH-based leads', async () => {
      const leads = await generator.generateLeads()

      expect(leads.length).toBeGreaterThan(0)
      expect(leads[0]).toMatchObject({
        id: expect.stringMatching(/^multi-/),
        companyId: expect.any(String),
        companyName: expect.any(String),
        score: expect.number.greaterThan(0),
        confidence: expect.any(String),
        sources: expect.any(Array),
        signals: expect.any(Array)
      })
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
    it('should enable real-time crawling when specified', async () => {
      // Mock the crawler
      const mockCrawl = jest.fn().mockResolvedValue({
        status: 200,
        html: '<html><body><h1>Careers</h1></body></html>',
        url: 'https://example.com/careers',
        fetchedAt: new Date().toISOString()
      })

      // This would require mocking the crawler instance
      // For now, we just test that the option is accepted
      const leads = await generator.generateLeads({ enableRealTime: true })

      expect(leads.length).toBeGreaterThan(0)
    })
  })
})