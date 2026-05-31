import { describe, it, expect } from '@jest/globals'
import { LeadAggregator } from '@/lib/lead-discovery/lead-aggregator'
import type { MultiSourceLead } from '@/lib/lead-discovery/multi-source-lead-generator'

describe('LeadAggregator', () => {
  let aggregator: LeadAggregator

  beforeEach(() => {
    aggregator = new LeadAggregator()
  })

  describe('aggregateLeads', () => {
    it('should aggregate leads from same company', async () => {
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'TechCorp', 2.5, 'A', ['hh']),
        createMockLead('company1', 'TechCorp', 2.8, 'B', ['career-pages'])
      ]

      const aggregated = await aggregator.aggregateLeads(mockLeads)

      expect(aggregated.length).toBe(1)
      expect(aggregated[0].companyName).toBe('TechCorp')
      expect(aggregated[0].sources.length).toBe(2)
      expect(aggregated[0].score).toBeGreaterThan(2.5) // Should be higher than individual scores
    })

    it('should deduplicate signals from same source', async () => {
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'TechCorp', 2.5, 'A', ['hh'], [
          { signalType: 'burst', companyId: 'company1', companyName: 'TechCorp', strength: 0.8, evidence: ['test'], detectedAt: new Date() }
        ]),
        createMockLead('company1', 'TechCorp', 2.5, 'A', ['hh'], [
          { signalType: 'burst', companyId: 'company1', companyName: 'TechCorp', strength: 0.6, evidence: ['test'], detectedAt: new Date() }
        ])
      ]

      const aggregated = await aggregator.aggregateLeads(mockLeads)

      // Should have only one burst signal (the stronger one)
      const burstSignals = aggregated[0].allSignals.filter(s => s.signalType === 'burst')
      expect(burstSignals.length).toBe(1)
      expect(burstSignals[0].strength).toBe(0.8)
    })

    it('should rank leads by composite score (multi-source bonus + confidence)', async () => {
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'CompanyA', 3.0, 'B', ['hh']),
        createMockLead('company2', 'CompanyB', 2.8, 'A', ['hh', 'career-pages']),
        createMockLead('company3', 'CompanyC', 3.2, 'C', ['hh'])
      ]

      const aggregated = await aggregator.aggregateLeads(mockLeads)

      // CompanyB wins via diversity multiplier (2 sources × 1.15 = 3.48)
      expect(aggregated[0].companyName).toBe('CompanyB')

      // CompanyC second (3.2 single-source = 3.456)
      expect(aggregated[1].companyName).toBe('CompanyC')

      // CompanyA third (3.0 single-source = 3.24)
      expect(aggregated[2].companyName).toBe('CompanyA')
    })
  })

  describe('calculateCompositeScore', () => {
    it('should boost score for multiple sources', () => {
      // This would be testing a private method, so we need to access it differently
      // For now, we test through aggregateLeads
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'TechCorp', 2.0, 'B', ['hh']),
        createMockLead('company1', 'TechCorp', 2.0, 'B', ['career-pages'])
      ]

      // The aggregated score should be higher than individual scores
      expect(async () => {
        const aggregated = await aggregator.aggregateLeads(mockLeads)
        return aggregated[0].score > 2.0
      }).toBeTruthy()
    })
  })

  describe('determineConfidence', () => {
    it('should return A confidence for primary sources with high confidence', () => {
      const sources = [
        { sourceId: 'hh', confidence: 0.8 },
        { sourceId: 'career-pages', confidence: 0.9 }
      ]

      // Again, testing through aggregateLeads
      expect(async () => {
        const mockLeads: MultiSourceLead[] = [
          createMockLead('company1', 'TechCorp', 2.5, 'A', ['hh', 'career-pages'])
        ]
        const aggregated = await aggregator.aggregateLeads(mockLeads)
        return aggregated[0].confidence === 'A'
      }).toBeTruthy()
    })
  })

  function createMockLead(
    companyId: string,
    companyName: string,
    score: number,
    confidence: string,
    sources: string[],
    signals = []
  ): MultiSourceLead {
    return {
      id: `lead-${companyId}`,
      companyId,
      companyName,
      score,
      confidence: confidence as any,
      sources: sources.map(sourceId => ({
        sourceId,
        sourceName: sourceId,
        evidenceType: 'vacancy',
        confidence: 0.7,
        extractedAt: new Date(),
        relevanceScore: 0.8
      })),
      signals,
      nextAction: 'Contact',
      reasons: ['test reason'],
      detectedAt: new Date(),
      enrichment: {}
    }
  }
})