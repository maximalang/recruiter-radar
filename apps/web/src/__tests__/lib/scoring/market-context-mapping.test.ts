/**
 * T3.3: marketContext maps to real MarketFitInput — no 'as any' cast
 */

import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'

jest.mock('@/lib/lead-discovery/multi-source-lead-generator', () => ({
  MultiSourceLeadGenerator: jest.fn().mockImplementation(() => ({
    generateLeads: jest.fn().mockResolvedValue([]),
  })),
}))

const service = new LeadScoringService()

describe('T3.3: marketContext maps to real MarketFitInput', () => {
  it('boom → industryTrend "growing"', () => {
    const result = service.mapMarketContext({
      marketConditions: 'boom',
      industryGrowth: { fintech: 0.15 },
    })
    expect(result.industryTrend).toBe('growing')
    expect(result.growthSignals).toEqual(['fintech'])
  })

  it('normal → industryTrend "stable"', () => {
    const result = service.mapMarketContext({
      marketConditions: 'normal',
    })
    expect(result.industryTrend).toBe('stable')
  })

  it('bust → industryTrend "declining"', () => {
    const result = service.mapMarketContext({
      marketConditions: 'bust',
    })
    expect(result.industryTrend).toBe('declining')
  })

  it('undefined marketContext → undefined', () => {
    const result = service.mapMarketContext(undefined)
    expect(result).toBeUndefined()
  })
})
