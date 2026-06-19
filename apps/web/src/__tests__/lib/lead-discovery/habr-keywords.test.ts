import {
  deriveHabrKeywordsFromProfiles,
  ROLE_HABR_KEYWORDS,
} from '@/lib/lead-discovery/habr-keywords'
import { VALID_ROLES } from '@/lib/clientProfiles'

describe('deriveHabrKeywordsFromProfiles', () => {
  it('maps a profile with one role to that role keywords', () => {
    const keywords = deriveHabrKeywordsFromProfiles([['hr']])
    expect(keywords).toEqual(ROLE_HABR_KEYWORDS.hr)
  })

  it('maps a profile with two roles to BOTH role keyword sets', () => {
    const keywords = deriveHabrKeywordsFromProfiles([['hr', 'it-engineering']])
    for (const kw of ROLE_HABR_KEYWORDS.hr) expect(keywords).toContain(kw)
    for (const kw of ROLE_HABR_KEYWORDS['it-engineering']) expect(keywords).toContain(kw)
  })

  it('unions roles across multiple active profiles', () => {
    const keywords = deriveHabrKeywordsFromProfiles([['hr'], ['sales']])
    for (const kw of ROLE_HABR_KEYWORDS.hr) expect(keywords).toContain(kw)
    for (const kw of ROLE_HABR_KEYWORDS.sales) expect(keywords).toContain(kw)
  })

  it('dedupes case-insensitively, preserving first-seen casing and order', () => {
    // Two profiles both declaring the same role must not duplicate keywords.
    const keywords = deriveHabrKeywordsFromProfiles([['hr'], ['hr']])
    expect(keywords).toEqual(ROLE_HABR_KEYWORDS.hr)
    // No duplicates overall.
    expect(new Set(keywords.map(k => k.toLowerCase())).size).toBe(keywords.length)
  })

  it('ignores unknown / unmapped roles', () => {
    const keywords = deriveHabrKeywordsFromProfiles([['not-a-role', 'other']])
    expect(keywords).toEqual([])
  })

  it('returns [] for no profiles (caller falls back to ENV/default)', () => {
    expect(deriveHabrKeywordsFromProfiles([])).toEqual([])
    expect(deriveHabrKeywordsFromProfiles([[]])).toEqual([])
  })

  it('every mapped key is a canonical role', () => {
    for (const key of Object.keys(ROLE_HABR_KEYWORDS)) {
      expect(VALID_ROLES.has(key)).toBe(true)
    }
  })
})
