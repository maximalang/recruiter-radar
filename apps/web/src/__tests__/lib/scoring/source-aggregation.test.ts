import {
  aggregateSourceSignals,
} from '@/lib/scoring/source-aggregation'
import type {
  AggregationInput,
} from '@/lib/scoring/source-aggregation'

const career: AggregationInput = {
  source: 'career_page',
  tier: 'direct',
  fetchedAt: '2026-05-25T00:00:00Z',
}
const hh: AggregationInput = {
  source: 'hh',
  tier: 'direct',
  fetchedAt: '2026-05-24T00:00:00Z',
}
const rabotaRossii: AggregationInput = {
  source: 'rabota_rossii',
  tier: 'corroboration',
  fetchedAt: '2026-05-20T00:00:00Z',
}
const news: AggregationInput = {
  source: 'news',
  tier: 'context',
  fetchedAt: '2026-05-01T00:00:00Z',
}

describe('aggregateSourceSignals', () => {
  describe('contract', () => {
    it('returns zero weight and zero independent sources for empty input', () => {
      const result = aggregateSourceSignals([])
      expect(result.weight).toBe(0)
      expect(result.independentSources).toBe(0)
      expect(result.breakdown).toEqual([])
      expect(result.hasMultiSourceConfirmation).toBe(false)
    })

    it('clamps weight to [0, 1]', () => {
      const result = aggregateSourceSignals([
        career,
        hh,
        rabotaRossii,
        news,
        { source: 'social', tier: 'context', fetchedAt: '2026-05-01T00:00:00Z' },
      ])
      expect(result.weight).toBeLessThanOrEqual(1)
      expect(result.weight).toBeGreaterThanOrEqual(0)
    })
  })

  describe('source weighting', () => {
    it('career_page direct evidence outweighs hh direct evidence', () => {
      const careerOnly = aggregateSourceSignals([career])
      const hhOnly = aggregateSourceSignals([hh])
      expect(careerOnly.weight).toBeGreaterThan(hhOnly.weight)
    })

    it('uses the canonical career-pages source id rather than the unknown-source fallback', () => {
      const careerPages = aggregateSourceSignals([
        { source: 'career-pages', tier: 'direct', fetchedAt: '2026-05-25T00:00:00Z' },
      ])
      const unknown = aggregateSourceSignals([
        { source: 'unregistered-source', tier: 'direct', fetchedAt: '2026-05-25T00:00:00Z' },
      ])

      expect(careerPages.weight).toBeGreaterThan(unknown.weight)
    })

    it('keeps owned ATS above major platforms, specialist boards, media, and aggregators', () => {
      const weight = (source: string) => aggregateSourceSignals([
        { source, tier: 'direct', fetchedAt: '2026-05-25T00:00:00Z' },
      ]).weight

      expect(weight('greenhouse')).toBeGreaterThan(weight('hh'))
      expect(weight('hh')).toBeGreaterThan(weight('habr-career'))
      expect(weight('habr-career')).toBeGreaterThan(weight('industry-media'))
      expect(weight('industry-media')).toBeGreaterThan(weight('unknown-source'))
      expect(weight('industry-media')).toBeGreaterThan(weight('platform-aggregator'))
    })

    it('hh direct outweighs rabota_rossii corroboration', () => {
      const hhOnly = aggregateSourceSignals([hh])
      const rrOnly = aggregateSourceSignals([rabotaRossii])
      expect(hhOnly.weight).toBeGreaterThan(rrOnly.weight)
    })

    it('news context contributes the least weight among supported sources', () => {
      const newsOnly = aggregateSourceSignals([news])
      const rrOnly = aggregateSourceSignals([rabotaRossii])
      expect(newsOnly.weight).toBeLessThan(rrOnly.weight)
    })

    it('unknown sources receive a low default weight rather than crashing', () => {
      const result = aggregateSourceSignals([
        { source: 'mystery', tier: 'context', fetchedAt: '2026-05-25T00:00:00Z' },
      ])
      expect(result.weight).toBeGreaterThan(0)
      expect(result.weight).toBeLessThan(0.2)
    })
  })

  describe('independence and confirmation', () => {
    it('counts each unique source family once even with multiple items', () => {
      const result = aggregateSourceSignals([
        hh,
        { ...hh, fetchedAt: '2026-05-23T00:00:00Z' },
        { ...hh, fetchedAt: '2026-05-22T00:00:00Z' },
      ])
      expect(result.independentSources).toBe(1)
      expect(result.hasMultiSourceConfirmation).toBe(false)
    })

    it('flags multi-source confirmation when 2+ independent direct/corroboration sources agree', () => {
      const result = aggregateSourceSignals([career, hh])
      expect(result.independentSources).toBe(2)
      expect(result.hasMultiSourceConfirmation).toBe(true)
    })

    it('does NOT flag multi-source confirmation when both signals are context-only', () => {
      const result = aggregateSourceSignals([
        news,
        { source: 'social', tier: 'context', fetchedAt: '2026-05-15T00:00:00Z' },
      ])
      expect(result.hasMultiSourceConfirmation).toBe(false)
    })

    it('rewards 2+ independent sources with a higher aggregate weight than a single rich source', () => {
      const careerOnly = aggregateSourceSignals([career])
      const careerPlusHh = aggregateSourceSignals([career, hh])
      expect(careerPlusHh.weight).toBeGreaterThan(careerOnly.weight)
    })

    it('applies a graduated bonus: 3+ strong sources outrank exactly 2', () => {
      // Two strong sources → +0.2 tier; three strong sources → +0.35 tier.
      // Use low-base-weight corroboration sources so the aggregate stays well
      // below the [0,1] clamp ceiling and the bonus delta is observable.
      const rr: AggregationInput = { source: 'rabota_rossii', tier: 'corroboration', fetchedAt: '2026-05-20T00:00:00Z' }
      const egrul: AggregationInput = { source: 'egrul', tier: 'corroboration', fetchedAt: '2026-05-20T00:00:00Z' }
      const funding: AggregationInput = { source: 'funding', tier: 'corroboration', fetchedAt: '2026-05-20T00:00:00Z' }

      const two = aggregateSourceSignals([rr, egrul])
      const three = aggregateSourceSignals([rr, egrul, funding])
      const fundingBase = aggregateSourceSignals([funding]).weight
      // three = base(two) + base(funding) + 0.35 ; two = base(two) + 0.2
      // ⇒ three - two = base(funding) + 0.15  > base(funding)
      expect(three.weight).toBeLessThan(1) // not saturated — delta is real, not clamped
      expect(three.weight - two.weight).toBeGreaterThan(fundingBase + 1e-9)
    })
  })

  describe('breakdown', () => {
    it('returns a per-source breakdown with weight contributions and item counts', () => {
      const result = aggregateSourceSignals([career, hh, hh])
      const careerEntry = result.breakdown.find((b) => b.source === 'career_page')
      const hhEntry = result.breakdown.find((b) => b.source === 'hh')

      expect(careerEntry).toBeDefined()
      expect(hhEntry).toBeDefined()
      expect(careerEntry!.itemCount).toBe(1)
      expect(hhEntry!.itemCount).toBe(2)
      expect(careerEntry!.weight).toBeGreaterThan(0)
      expect(hhEntry!.weight).toBeGreaterThan(0)
    })

    it('breakdown weights sum to (or below) the aggregated weight before any multi-source bonus', () => {
      const result = aggregateSourceSignals([career, rabotaRossii])
      const sum = result.breakdown.reduce((acc, b) => acc + b.weight, 0)
      expect(sum).toBeGreaterThan(0)
      expect(sum).toBeLessThanOrEqual(result.weight + 1e-9)
    })
  })

  describe('tier handling within a source', () => {
    it('direct evidence beats context evidence from the same source', () => {
      const direct = aggregateSourceSignals([
        { source: 'hh', tier: 'direct', fetchedAt: '2026-05-25T00:00:00Z' },
      ])
      const context = aggregateSourceSignals([
        { source: 'hh', tier: 'context', fetchedAt: '2026-05-25T00:00:00Z' },
      ])
      expect(direct.weight).toBeGreaterThan(context.weight)
    })
  })
})
