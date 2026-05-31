import { describe, it, expect } from '@jest/globals'
import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'

describe('Lead Scoring Service Integration', () => {
  let scoringService: LeadScoringService

  beforeEach(() => {
    scoringService = new LeadScoringService()
  })

  it('should score leads with basic agency profile', async () => {
    const options = {
      agencyProfile: {
        industries: ['IT'],
        locations: ['Moscow'],
        excludedIndustries: [],
        excludedLocations: [],
      }
    }

    const leads = await scoringService.generateAndScoreLeads(options)

    expect(leads).toBeInstanceOf(Array)
    expect(leads.length).toBeGreaterThan(0)

    const lead = leads[0]
    expect(lead).toHaveProperty('id')
    expect(lead).toHaveProperty('companyName')
    expect(lead).toHaveProperty('finalScore')
    expect(lead).toHaveProperty('confidence')
    expect(lead).toHaveProperty('scoringBreakdown')
  })

  it('should filter by minimum score', async () => {
    const options = {
      agencyProfile: {
        industries: ['IT'],
        locations: ['Moscow'],
        excludedIndustries: [],
        excludedLocations: [],
      },
      minScore: 2.0
    }

    const leads = await scoringService.generateAndScoreLeads(options)

    leads.forEach(lead => {
      expect(lead.finalScore).toBeGreaterThanOrEqual(2.0)
    })
  })

  it('should get scoring insights', () => {
    const mockLeads = [
      {
        id: '1',
        companyName: 'Test Company 1',
        finalScore: 3.5,
        confidence: 'high' as const,
        sources: [],
      },
      {
        id: '2',
        companyName: 'Test Company 2',
        finalScore: 2.0,
        confidence: 'medium' as const,
        sources: [],
      },
      {
        id: '3',
        companyName: 'Test Company 3',
        finalScore: 1.5,
        confidence: 'low' as const,
        sources: [],
      }
    ]

    const insights = scoringService.getScoringInsights(mockLeads)

    expect(insights).toBeTruthy()
    expect(insights?.total).toBe(3)
    expect(insights?.avgScore).toBe(2.3333333333333335) // (3.5 + 2.0 + 1.5) / 3
    expect(insights?.confidenceBreakdown.high).toBe(1)
    expect(insights?.confidenceBreakdown.medium).toBe(1)
    expect(insights?.confidenceBreakdown.low).toBe(1)
  })

  it('should return null insights for empty leads', () => {
    const insights = scoringService.getScoringInsights([])
    expect(insights).toBeNull()
  })
})