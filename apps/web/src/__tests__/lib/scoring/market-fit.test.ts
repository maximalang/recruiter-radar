import {
  computeMarketFit,
} from '@/lib/scoring/market-fit'

describe('computeMarketFit', () => {
  describe('contract', () => {
    it('returns score 0 with no signals or trend data', () => {
      const result = computeMarketFit({})
      expect(result.score).toBe(0)
      expect(result.reasons).toEqual([])
    })

    it('returns score in [0, 1]', () => {
      const result = computeMarketFit({
        industryTrend: 'growing',
        growthSignals: ['funding-round', 'office-expansion', 'new-product', 'leadership-hire', 'media-mention'],
        expandingIntoNewMarket: true,
      })
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
    })
  })

  describe('industry trend', () => {
    it('rewards a growing industry', () => {
      const growing = computeMarketFit({ industryTrend: 'growing' })
      const stable = computeMarketFit({ industryTrend: 'stable' })
      const declining = computeMarketFit({ industryTrend: 'declining' })

      expect(growing.score).toBeGreaterThan(stable.score)
      expect(stable.score).toBeGreaterThan(declining.score)
      expect(declining.score).toBe(0)
    })

    it('mentions the industry trend in reasons', () => {
      const result = computeMarketFit({ industryTrend: 'growing' })
      expect(result.reasons.some((r) => /grow/i.test(r))).toBe(true)
    })
  })

  describe('growth signals', () => {
    it('a funding-round signal materially boosts the score', () => {
      const withFunding = computeMarketFit({ growthSignals: ['funding-round'] })
      const noSignals = computeMarketFit({})
      expect(withFunding.score).toBeGreaterThan(noSignals.score)
    })

    it('multiple growth signals stack but are capped', () => {
      const one = computeMarketFit({ growthSignals: ['funding-round'] })
      const many = computeMarketFit({
        growthSignals: ['funding-round', 'office-expansion', 'new-product', 'leadership-hire', 'media-mention'],
      })
      expect(many.score).toBeGreaterThan(one.score)
      expect(many.score).toBeLessThanOrEqual(1)
    })

    it('deduplicates repeated signals of the same kind', () => {
      const single = computeMarketFit({ growthSignals: ['funding-round'] })
      const repeated = computeMarketFit({
        growthSignals: ['funding-round', 'funding-round', 'funding-round'],
      })
      expect(repeated.score).toBe(single.score)
    })

    it('ignores unknown signal kinds rather than crashing', () => {
      const result = computeMarketFit({
        growthSignals: ['funding-round', 'mystery-signal', 'another-bogus'],
      })
      expect(result.score).toBeGreaterThan(0)
      expect(result.score).toBeLessThanOrEqual(1)
    })
  })

  describe('expansion into new market', () => {
    it('rewards expansion-into-new-market on top of other signals', () => {
      const baseline = computeMarketFit({ industryTrend: 'stable' })
      const expanding = computeMarketFit({
        industryTrend: 'stable',
        expandingIntoNewMarket: true,
      })
      expect(expanding.score).toBeGreaterThan(baseline.score)
      expect(expanding.reasons.some((r) => /expansion|new market/i.test(r))).toBe(true)
    })
  })

  describe('declining industry guard', () => {
    it('declining-industry penalty does not push the score below 0', () => {
      const result = computeMarketFit({
        industryTrend: 'declining',
        growthSignals: ['funding-round'],
      })
      expect(result.score).toBeGreaterThanOrEqual(0)
    })

    it('a strong company signal can still rescue a declining-industry company', () => {
      const declining = computeMarketFit({
        industryTrend: 'declining',
        growthSignals: ['funding-round', 'office-expansion'],
      })
      const decliningAlone = computeMarketFit({ industryTrend: 'declining' })
      expect(declining.score).toBeGreaterThan(decliningAlone.score)
    })
  })

  describe('reasons', () => {
    it('lists each contributing signal in reasons', () => {
      const result = computeMarketFit({
        growthSignals: ['funding-round', 'leadership-hire'],
      })
      const joined = result.reasons.join(' | ').toLowerCase()
      expect(joined).toContain('funding')
      expect(joined).toContain('leadership')
    })
  })
})
