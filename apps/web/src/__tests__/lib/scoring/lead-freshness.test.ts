import {
  computeLeadFreshness,
} from '@/lib/scoring/lead-freshness'

const at = (iso: string) => ({ fetchedAt: iso })

const now = new Date('2026-05-26T12:00:00Z')

describe('computeLeadFreshness', () => {
  describe('contract', () => {
    it('returns null age and status "expired" for an empty evidence list', () => {
      const result = computeLeadFreshness([], { now })
      expect(result.newestAgeHours).toBeNull()
      expect(result.oldestAgeHours).toBeNull()
      expect(result.status).toBe('expired')
      expect(result.meetsSla).toBe(false)
    })

    it('uses Date.now when no clock is injected', () => {
      const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      const result = computeLeadFreshness([at(recent)])
      expect(result.status).toBe('fresh')
      expect(result.meetsSla).toBe(true)
    })

    it('ignores items with invalid fetchedAt and uses the remaining ones', () => {
      const result = computeLeadFreshness(
        [
          { fetchedAt: 'not-a-date' },
          at('2026-05-26T11:00:00Z'),
        ],
        { now }
      )
      expect(result.newestAgeHours).toBe(1)
      expect(result.status).toBe('fresh')
    })

    it('returns expired status when every item has invalid fetchedAt', () => {
      const result = computeLeadFreshness(
        [{ fetchedAt: 'invalid' }, { fetchedAt: '' }],
        { now }
      )
      expect(result.newestAgeHours).toBeNull()
      expect(result.status).toBe('expired')
    })
  })

  describe('status categories', () => {
    it('classifies items <= 2h old as fresh and meeting the SLA', () => {
      const result = computeLeadFreshness([at('2026-05-26T10:30:00Z')], { now })
      expect(result.newestAgeHours).toBeCloseTo(1.5)
      expect(result.status).toBe('fresh')
      expect(result.meetsSla).toBe(true)
    })

    it('classifies items 2h..24h old as aging and missing the SLA', () => {
      const result = computeLeadFreshness([at('2026-05-25T18:00:00Z')], { now })
      expect(result.status).toBe('aging')
      expect(result.meetsSla).toBe(false)
    })

    it('classifies items 1..7 days old as stale', () => {
      const result = computeLeadFreshness([at('2026-05-23T12:00:00Z')], { now })
      expect(result.status).toBe('stale')
    })

    it('classifies items > 7 days old as expired', () => {
      const result = computeLeadFreshness([at('2026-05-15T12:00:00Z')], { now })
      expect(result.status).toBe('expired')
    })
  })

  describe('aggregate behavior', () => {
    it('uses the NEWEST item to determine status, not an average', () => {
      const result = computeLeadFreshness(
        [
          at('2026-05-15T12:00:00Z'),
          at('2026-05-26T11:00:00Z'),
        ],
        { now }
      )
      expect(result.status).toBe('fresh')
      expect(result.newestAgeHours).toBe(1)
    })

    it('reports oldestAgeHours separately so callers can detect re-enrichment needs', () => {
      const result = computeLeadFreshness(
        [
          at('2026-05-15T12:00:00Z'),
          at('2026-05-26T11:00:00Z'),
        ],
        { now }
      )
      expect(result.oldestAgeHours).toBeCloseTo(11 * 24, 0)
    })

    it('accepts Date instances as fetchedAt', () => {
      const result = computeLeadFreshness(
        [{ fetchedAt: new Date('2026-05-26T11:30:00Z') }],
        { now }
      )
      expect(result.status).toBe('fresh')
      expect(result.newestAgeHours).toBeCloseTo(0.5)
    })
  })
})
