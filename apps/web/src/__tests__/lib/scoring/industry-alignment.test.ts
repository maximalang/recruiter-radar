import {
  computeIndustryAlignment,
} from '@/lib/scoring/industry-alignment'

describe('computeIndustryAlignment', () => {
  describe('contract', () => {
    it('returns score 0 with match "none" when neither side has industries', () => {
      const result = computeIndustryAlignment({ targetIndustries: [], companyIndustries: [] })
      expect(result.score).toBe(0)
      expect(result.match).toBe('none')
    })

    it('returns score 0 with match "none" when company has industries but profile does not target any', () => {
      const result = computeIndustryAlignment({
        targetIndustries: [],
        companyIndustries: ['fintech'],
      })
      expect(result.score).toBe(0)
      expect(result.match).toBe('none')
    })

    it('returns a score in [0, 1]', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['fintech'],
        companyIndustries: ['fintech'],
      })
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
    })
  })

  describe('exact match', () => {
    it('returns score 1.0 and match "exact" when industries match', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['fintech', 'edtech'],
        companyIndustries: ['fintech'],
      })
      expect(result.score).toBe(1)
      expect(result.match).toBe('exact')
      expect(result.reasons.some((r) => /fintech/i.test(r))).toBe(true)
    })

    it('matches case-insensitively and trims whitespace', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['  Fintech  '],
        companyIndustries: ['FINTECH'],
      })
      expect(result.match).toBe('exact')
    })
  })

  describe('related match (adjacency)', () => {
    it('treats related industries as partial credit (~0.6)', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['fintech'],
        companyIndustries: ['banking'],
      })
      expect(result.match).toBe('related')
      expect(result.score).toBeGreaterThan(0.4)
      expect(result.score).toBeLessThan(1)
    })

    it('treats saas <-> software as related', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['saas'],
        companyIndustries: ['software'],
      })
      expect(result.match).toBe('related')
    })

    it('does NOT treat unrelated industries as related', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['fintech'],
        companyIndustries: ['retail'],
      })
      expect(result.match).toBe('none')
      expect(result.score).toBe(0)
    })
  })

  describe('multi-industry / conglomerate', () => {
    it('rewards an exact match even when company spans multiple industries', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['fintech'],
        companyIndustries: ['retail', 'logistics', 'fintech'],
      })
      expect(result.match).toBe('exact')
      expect(result.score).toBe(1)
    })

    it('falls back to related when no exact match but at least one industry is adjacent', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['fintech'],
        companyIndustries: ['retail', 'banking'],
      })
      expect(result.match).toBe('related')
    })
  })

  describe('exclusions', () => {
    it('returns score 0 with match "excluded" when company belongs to an excluded industry', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['fintech'],
        excludedIndustries: ['gambling'],
        companyIndustries: ['fintech', 'gambling'],
      })
      expect(result.score).toBe(0)
      expect(result.match).toBe('excluded')
      expect(result.reasons.some((r) => /excluded|gambling/i.test(r))).toBe(true)
    })

    it('exclusion takes precedence over exact match', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['gambling'],
        excludedIndustries: ['gambling'],
        companyIndustries: ['gambling'],
      })
      expect(result.match).toBe('excluded')
    })

    it('case-insensitive exclusion matching', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['fintech'],
        excludedIndustries: ['Adult'],
        companyIndustries: ['ADULT', 'fintech'],
      })
      expect(result.match).toBe('excluded')
    })
  })

  describe('reasons', () => {
    it('explains the matched industry name in reasons for exact match', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['edtech'],
        companyIndustries: ['edtech'],
      })
      expect(result.reasons.some((r) => r.toLowerCase().includes('edtech'))).toBe(true)
    })

    it('explains which related industry triggered the partial credit', () => {
      const result = computeIndustryAlignment({
        targetIndustries: ['fintech'],
        companyIndustries: ['banking'],
      })
      expect(result.reasons.some((r) => /banking/i.test(r))).toBe(true)
    })
  })
})
