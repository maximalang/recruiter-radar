import { describe, it, expect, jest } from '@jest/globals'
import { LeadAggregator } from '@/lib/lead-discovery/lead-aggregator'
import type {
  MultiSourceLead,
  EvidenceSource,
} from '@/lib/lead-discovery/multi-source-lead-generator'
import type { HiringSignal } from '@/lib/lead-discovery/hiring-pattern-detector'

function fakeSource(overrides: Partial<EvidenceSource> = {}): EvidenceSource {
  return {
    sourceId: 'hh',
    sourceName: 'HeadHunter',
    evidenceType: 'vacancy',
    confidence: 0.8,
    extractedAt: new Date('2026-05-20T10:00:00Z'),
    relevanceScore: 0.7,
    ...overrides,
  }
}

function fakeSignal(overrides: Partial<HiringSignal> = {}): HiringSignal {
  return {
    companyId: 'company1',
    companyName: 'TechCorp',
    signalType: 'burst',
    strength: 0.5,
    evidence: ['evidence'],
    detectedAt: new Date('2026-05-20T10:00:00Z'),
    ...overrides,
  }
}

function fakeLead(overrides: Partial<MultiSourceLead> = {}): MultiSourceLead {
  return {
    id: 'multi-lead1',
    companyId: 'company1',
    companyName: 'TechCorp',
    score: 2.5,
    confidence: 'B',
    sources: [fakeSource()],
    signals: [],
    nextAction: 'Contact',
    reasons: ['baseline'],
    detectedAt: new Date('2026-05-20T10:00:00Z'),
    enrichment: {},
    ...overrides,
  }
}

describe('LeadAggregator', () => {
  let aggregator: LeadAggregator

  beforeEach(() => {
    aggregator = new LeadAggregator()
  })

  describe('aggregateLeads', () => {
    it('groups leads from the same company into a single record', async () => {
      const leads: MultiSourceLead[] = [
        fakeLead({
          id: 'multi-1',
          score: 2.5,
          sources: [fakeSource({ sourceId: 'hh', sourceName: 'HeadHunter' })],
        }),
        fakeLead({
          id: 'multi-2',
          score: 2.8,
          confidence: 'A',
          sources: [fakeSource({ sourceId: 'career-pages', sourceName: 'Career Pages', confidence: 0.92 })],
        }),
      ]

      const aggregated = await aggregator.aggregateLeads(leads)

      expect(aggregated).toHaveLength(1)
      expect(aggregated[0].companyName).toBe('TechCorp')
      expect(aggregated[0].sources.map(s => s.sourceId).sort()).toEqual(['career-pages', 'hh'])
      expect(aggregated[0].score).toBeGreaterThan(2.5)
    })

    it('deduplicates signals keeping the strongest for each (type, company)', async () => {
      const leads: MultiSourceLead[] = [
        fakeLead({
          id: 'multi-1',
          signals: [fakeSignal({ strength: 0.8 })],
        }),
        fakeLead({
          id: 'multi-2',
          signals: [fakeSignal({ strength: 0.6 })],
        }),
      ]

      const aggregated = await aggregator.aggregateLeads(leads)

      const burstSignals = aggregated[0].signals.filter(s => s.signalType === 'burst')
      expect(burstSignals).toHaveLength(1)
      expect(burstSignals[0].strength).toBe(0.8)
    })

    it('ranks by score, then confidence, then freshness', async () => {
      const leads: MultiSourceLead[] = [
        fakeLead({
          id: 'multi-a',
          companyId: 'companyA',
          companyName: 'CompanyA',
          score: 3.0,
          confidence: 'B',
          sources: [fakeSource({ sourceId: 'hh', confidence: 0.7 })],
        }),
        fakeLead({
          id: 'multi-b',
          companyId: 'companyB',
          companyName: 'CompanyB',
          score: 2.8,
          confidence: 'A',
          sources: [
            fakeSource({ sourceId: 'hh', confidence: 0.9 }),
            fakeSource({ sourceId: 'career-pages', confidence: 0.92 }),
          ],
        }),
        fakeLead({
          id: 'multi-c',
          companyId: 'companyC',
          companyName: 'CompanyC',
          score: 3.2,
          confidence: 'C',
          sources: [fakeSource({ sourceId: 'hh', confidence: 0.6 })],
        }),
      ]

      const aggregated = await aggregator.aggregateLeads(leads)

      expect(aggregated[0].companyName).toBe('CompanyC')
      expect(aggregated.map(a => a.companyName)).toContain('CompanyA')
      expect(aggregated.map(a => a.companyName)).toContain('CompanyB')
    })

    it('returns empty array for empty input', async () => {
      const aggregated = await aggregator.aggregateLeads([])
      expect(aggregated).toEqual([])
    })

    it('assigns A confidence when primary sources cover the lead with high avg confidence', async () => {
      const leads: MultiSourceLead[] = [
        fakeLead({
          sources: [
            fakeSource({ sourceId: 'hh', confidence: 0.85 }),
            fakeSource({ sourceId: 'career-pages', confidence: 0.92 }),
          ],
        }),
      ]
      const aggregated = await aggregator.aggregateLeads(leads)
      expect(aggregated[0].confidence).toBe('A')
    })

    it('falls back to D confidence when no sources contribute', async () => {
      const leads: MultiSourceLead[] = [
        fakeLead({ sources: [] }),
      ]
      const aggregated = await aggregator.aggregateLeads(leads)
      expect(aggregated[0].confidence).toBe('D')
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })
})
