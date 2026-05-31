import { describe, it, expect, beforeEach, jest } from '@jest/globals'

// Mock getHhDigestItems before importing the service
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

import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'

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

describe('Lead Scoring Service Integration', () => {
  let scoringService: LeadScoringService

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetHhDigestItems.mockResolvedValue(SAMPLE_DIGEST_ITEMS)
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
        confidence: 'A' as const,
        sources: [],
      },
      {
        id: '2',
        companyName: 'Test Company 2',
        finalScore: 2.0,
        confidence: 'B' as const,
        sources: [],
      },
      {
        id: '3',
        companyName: 'Test Company 3',
        finalScore: 1.5,
        confidence: 'C' as const,
        sources: [],
      }
    ]

    const insights = scoringService.getScoringInsights(mockLeads)

    expect(insights).toBeTruthy()
    expect(insights?.total).toBe(3)
    expect(insights?.avgScore).toBe(2.3333333333333335) // (3.5 + 2.0 + 1.5) / 3
    expect(insights?.confidenceBreakdown.A).toBe(1)
    expect(insights?.confidenceBreakdown.B).toBe(1)
    expect(insights?.confidenceBreakdown.C).toBe(1)
  })

  it('should return null insights for empty leads', () => {
    const insights = scoringService.getScoringInsights([])
    expect(insights).toBeNull()
  })
})
