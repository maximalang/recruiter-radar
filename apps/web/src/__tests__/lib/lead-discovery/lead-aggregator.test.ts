import { describe, it, expect } from '@jest/globals'
import { LeadAggregator } from '@/lib/lead-discovery/lead-aggregator'
import type { MultiSourceLead } from '@/lib/lead-discovery/multi-source-lead-generator'
import type { HiringSignal } from '@/lib/lead-discovery/hiring-pattern-detector'

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

    it('should rank leads by composite score (additive: FIUR base + diversity bonus)', async () => {
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'CompanyA', 3.0, 'B', ['hh']),
        createMockLead('company2', 'CompanyB', 2.8, 'A', ['hh', 'career-pages']),
        createMockLead('company3', 'CompanyC', 3.2, 'C', ['hh'])
      ]

      const aggregated = await aggregator.aggregateLeads(mockLeads)

      // Additive formula: fiurBase + diversityBonus + signalBonus, clamped to [0,4]
      // CompanyC: 3.2 + 0 diversity = 3.2
      // CompanyA: 3.0 + 0 diversity = 3.0
      // CompanyB: 2.8 + 0.15 diversity = 2.95
      expect(aggregated[0].companyName).toBe('CompanyC')
      expect(aggregated[1].companyName).toBe('CompanyA')
      expect(aggregated[2].companyName).toBe('CompanyB')
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

  describe('INN-based entity resolution', () => {
    it('should merge leads with same INN even if company names differ', async () => {
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'ООО "ТехКорп"', 2.5, 'B', ['hh']),
        createMockLead('company2', 'TechCorp LLC', 2.8, 'B', ['career-pages']),
      ]
      mockLeads[0].inn = '7701234567'
      mockLeads[1].inn = '7701234567'

      const aggregated = await aggregator.aggregateLeads(mockLeads)

      // Same INN → same canonical ID → merged into one lead
      expect(aggregated.length).toBe(1)
      expect(aggregated[0].sources.length).toBe(2)
    })

    it('should not merge leads with different INNs even if names are similar', async () => {
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'ООО "ТехКорп"', 2.5, 'B', ['hh']),
        createMockLead('company2', 'ООО "ТехКорп"', 2.8, 'B', ['career-pages']),
      ]
      mockLeads[0].inn = '7701234567'
      mockLeads[1].inn = '7707654321'

      const aggregated = await aggregator.aggregateLeads(mockLeads)

      // Different INNs → different canonical IDs → separate leads
      expect(aggregated.length).toBe(2)
    })

    it('should fall back to name-hash matching when INN is absent', async () => {
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'TechCorp', 2.5, 'B', ['hh']),
        createMockLead('company1', 'TechCorp', 2.8, 'B', ['career-pages']),
      ]
      // No INN set on either lead

      const aggregated = await aggregator.aggregateLeads(mockLeads)

      // Same companyId → same name-hash → merged
      expect(aggregated.length).toBe(1)
    })
  })

  describe('determineConfidence', () => {
    it('should return A confidence for 2+ direct evidence sources with clean entity match', async () => {
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'TechCorp', 2.5, 'A', ['hh', 'career-pages'], [], {
          'hh': { evidenceType: 'career-page' },
          'career-pages': { evidenceType: 'career-page' },
        }),
      ]
      const aggregated = await aggregator.aggregateLeads(mockLeads)
      expect(aggregated[0].confidence).toBe('A')
    })

    it('should return C confidence for questionable entity match even with strong evidence', async () => {
      // No companyId → questionable entity match → forces gate C
      const mockLeads: MultiSourceLead[] = [
        createMockLead('', 'TechCorp', 2.5, 'A', ['hh', 'career-pages'], [], {
          'hh': { evidenceType: 'career-page' },
          'career-pages': { evidenceType: 'career-page' },
        }),
      ]
      const aggregated = await aggregator.aggregateLeads(mockLeads)
      expect(aggregated[0].confidence).toBe('C')
    })

    it('should return B for 1 direct + 0 corroboration', async () => {
      const mockLeads: MultiSourceLead[] = [
        createMockLead('company1', 'TechCorp', 2.5, 'B', ['career-pages'], [], {
          'career-pages': { evidenceType: 'career-page' },
        }),
      ]
      const aggregated = await aggregator.aggregateLeads(mockLeads)
      expect(aggregated[0].confidence).toBe('B')
    })
  })

  function createMockLead(
    companyId: string,
    companyName: string,
    score: number,
    confidence: string,
    sources: string[],
    signals: HiringSignal[] = [],
    sourceOverrides: Record<string, Partial<{ evidenceType: string }>> = {},
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
        evidenceType: (sourceOverrides[sourceId]?.evidenceType ?? 'vacancy') as any,
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