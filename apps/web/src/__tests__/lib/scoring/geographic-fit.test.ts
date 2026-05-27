import {
  computeGeographicFit,
} from '@/lib/scoring/geographic-fit'

describe('computeGeographicFit', () => {
  describe('contract', () => {
    it('returns 0/none when neither side declares a geography', () => {
      const result = computeGeographicFit({
        targetGeographies: [],
        companyLocations: [],
      })
      expect(result.score).toBe(0)
      expect(result.match).toBe('none')
    })

    it('returns score in [0, 1]', () => {
      const result = computeGeographicFit({
        targetGeographies: ['Москва'],
        companyLocations: ['Москва'],
      })
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
    })
  })

  describe('exact city match', () => {
    it('returns 1.0 when company is in a targeted city', () => {
      const result = computeGeographicFit({
        targetGeographies: ['Москва', 'Санкт-Петербург'],
        companyLocations: ['Москва'],
      })
      expect(result.score).toBe(1)
      expect(result.match).toBe('city')
    })

    it('matches case-insensitively and trims whitespace', () => {
      const result = computeGeographicFit({
        targetGeographies: ['  МОСКВА  '],
        companyLocations: ['москва'],
      })
      expect(result.match).toBe('city')
    })
  })

  describe('region/country fallbacks', () => {
    it('returns ~0.6 region match when company is in same broader region', () => {
      const result = computeGeographicFit({
        targetGeographies: ['Россия'],
        companyLocations: ['Москва'],
      })
      expect(result.match).toBe('region')
      expect(result.score).toBeGreaterThan(0.4)
      expect(result.score).toBeLessThan(1)
    })

    it('returns "none" when targets and company are in unrelated countries', () => {
      const result = computeGeographicFit({
        targetGeographies: ['Москва'],
        companyLocations: ['New York'],
      })
      expect(result.match).toBe('none')
      expect(result.score).toBe(0)
    })
  })

  describe('anywhere / remote-friendly profile', () => {
    it('returns 1.0 / "anywhere" when profile targets "anywhere"', () => {
      const result = computeGeographicFit({
        targetGeographies: ['anywhere'],
        companyLocations: ['Vladivostok'],
      })
      expect(result.match).toBe('anywhere')
      expect(result.score).toBe(1)
    })

    it('returns 1.0 when remoteFriendly is true and company has any location', () => {
      const result = computeGeographicFit({
        targetGeographies: ['Москва'],
        companyLocations: ['Vladivostok'],
        remoteFriendly: true,
      })
      expect(result.match).toBe('anywhere')
      expect(result.score).toBe(1)
    })
  })

  describe('exclusions', () => {
    it('hard-zero / "excluded" when company is in an excluded geography', () => {
      const result = computeGeographicFit({
        targetGeographies: ['Россия'],
        excludedGeographies: ['Crimea'],
        companyLocations: ['Crimea'],
      })
      expect(result.score).toBe(0)
      expect(result.match).toBe('excluded')
    })

    it('exclusion takes precedence over remoteFriendly and anywhere', () => {
      const result = computeGeographicFit({
        targetGeographies: ['anywhere'],
        excludedGeographies: ['Sanctioned Region'],
        companyLocations: ['Sanctioned Region'],
        remoteFriendly: true,
      })
      expect(result.match).toBe('excluded')
      expect(result.score).toBe(0)
    })
  })

  describe('multi-location companies', () => {
    it('takes the best matching company location', () => {
      const result = computeGeographicFit({
        targetGeographies: ['Москва'],
        companyLocations: ['Vladivostok', 'Москва', 'Krasnodar'],
      })
      expect(result.match).toBe('city')
      expect(result.score).toBe(1)
    })
  })

  describe('reasons', () => {
    it('includes the matched location name in reasons', () => {
      const result = computeGeographicFit({
        targetGeographies: ['Москва'],
        companyLocations: ['Москва'],
      })
      expect(result.reasons.some((r) => /москва/i.test(r))).toBe(true)
    })
  })
})
