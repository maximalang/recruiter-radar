import {
  buildProfileKeywords,
  buildProfileSearchEnv,
  profileToSearchInput,
  ROLE_SEARCH_KEYWORDS,
} from '@/lib/lead-discovery/search-query-builder'
import { VALID_ROLES, VALID_INDUSTRIES } from '@/lib/clientProfiles'
import type { ClientProfile } from '@/lib/clientProfiles'
import type { SourceId } from '@/lib/sources/source-registry'

function makeInput(overrides: Partial<Parameters<typeof buildProfileKeywords>[0]> = {}) {
  return {
    roles: [],
    industries: [],
    excludedIndustries: [],
    includeKeywords: [],
    excludeKeywords: [],
    targetCity: null,
    ...overrides,
  }
}

function makeProfile(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return {
    id: '1',
    userId: '1',
    agencyName: 'Test',
    contactName: null,
    contactEmail: null,
    telegramChatId: null,
    targetCity: null,
    specialization: null,
    includeKeywords: [],
    excludeKeywords: [],
    industries: [],
    companySizes: [],
    dailyDigestLimit: 10,
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    contactPolicy: 'corporate_only',
    roles: [],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: false,
    hiringIntentMin: null,
    signalFreshnessDays: null,
    minOpenRoles: null,
    hiringMode: 'internal',
    ...overrides,
  } as unknown as ClientProfile
}

describe('buildProfileKeywords', () => {
  it('maps a profile with one role to that role keywords', () => {
    const keywords = buildProfileKeywords(makeInput({ roles: ['hr'] }))
    expect(keywords).toEqual([...ROLE_SEARCH_KEYWORDS.hr])
  })

  it('unions role keywords across multiple roles', () => {
    const keywords = buildProfileKeywords(makeInput({ roles: ['hr', 'sales'] }))
    for (const kw of ROLE_SEARCH_KEYWORDS.hr) expect(keywords).toContain(kw)
    for (const kw of ROLE_SEARCH_KEYWORDS.sales) expect(keywords).toContain(kw)
  })

  it('places operator includeKeywords FIRST (strongest signal)', () => {
    const keywords = buildProfileKeywords(
      makeInput({ includeKeywords: ['qlikview'], roles: ['hr'] }),
    )
    expect(keywords[0]).toBe('qlikview')
    for (const kw of ROLE_SEARCH_KEYWORDS.hr) expect(keywords).toContain(kw)
  })

  it('appends industry keywords after role keywords', () => {
    const keywords = buildProfileKeywords(
      makeInput({ roles: ['it-engineering'], industries: ['finance'] }),
    )
    const firstRoleKw = ROLE_SEARCH_KEYWORDS['it-engineering'][0]
    const firstIndustryKw = 'финанс' // first term in INDUSTRY_KEYWORDS['finance']
    expect(keywords.indexOf(firstRoleKw)).toBeLessThan(keywords.indexOf(firstIndustryKw))
  })

  it('subtracts explicit excludeKeywords', () => {
    const keywords = buildProfileKeywords(
      makeInput({ roles: ['sales'], excludeKeywords: ['sales manager'] }),
    )
    expect(keywords).not.toContain('sales manager')
    expect(keywords).not.toContain('Sales Manager')
  })

  it('removes excluded-industry terms and skips the excluded industry entirely', () => {
    const keywords = buildProfileKeywords(
      makeInput({ industries: ['it', 'finance'], excludedIndustries: ['finance'] }),
    )
    // it terms present
    expect(keywords).toContain('айти')
    // finance terms removed
    for (const term of ['финанс', 'банк', 'инвестицион']) {
      expect(keywords).not.toContain(term)
    }
  })

  it('dedupes case-insensitively preserving first-seen casing', () => {
    const keywords = buildProfileKeywords(
      makeInput({ includeKeywords: ['Sales Manager'], roles: ['sales'] }),
    )
    // 'Sales Manager' (operator) kept, 'sales manager' (role map) dropped as dup.
    expect(keywords.filter(k => k.toLowerCase() === 'sales manager')).toHaveLength(1)
    expect(keywords[0]).toBe('Sales Manager')
  })

  it('ignores unknown roles and industries', () => {
    const keywords = buildProfileKeywords(
      makeInput({ roles: ['not-a-role', 'other'], industries: ['not-an-industry'] }),
    )
    expect(keywords).toEqual([])
  })

  it('returns [] for an empty profile (caller falls back to source default)', () => {
    expect(buildProfileKeywords(makeInput())).toEqual([])
  })

  it('every ROLE_SEARCH_KEYWORDS key is a canonical role', () => {
    for (const key of Object.keys(ROLE_SEARCH_KEYWORDS)) {
      expect(VALID_ROLES.has(key)).toBe(true)
    }
  })

  it('trims operator keywords', () => {
    const keywords = buildProfileKeywords(
      makeInput({ includeKeywords: ['  qlikview  '] }),
    )
    expect(keywords).toEqual(['qlikview'])
  })
})

describe('buildProfileKeywords — feedback-driven demote (bounded re-ordering)', () => {
  it('pushes demoted industry terms to the END of the list (not removed)', () => {
    const demote = new Set(['финанс', 'банк']) // finance terms demoted by feedback
    const keywords = buildProfileKeywords(
      makeInput({ roles: ['hr'], industries: ['finance', 'it'] }),
      demote,
    )
    // finance (demoted) terms still present, but after the non-demoted it/hr terms.
    expect(keywords).toContain('финанс')
    expect(keywords).toContain('банк')
    const firstFinanceIdx = keywords.findIndex(k => k.toLowerCase() === 'финанс')
    const lastItTermIdx = Math.max(
      ...(['айти', 'информационные технологии']).map(t =>
        keywords.findIndex(k => k.toLowerCase() === t.toLowerCase()),
      ),
    )
    expect(firstFinanceIdx).toBeGreaterThan(lastItTermIdx)
  })

  it('NEVER demotes operator-pinned includeKeywords even if in the demote set', () => {
    const demote = new Set(['qlikview'])
    const keywords = buildProfileKeywords(
      makeInput({ includeKeywords: ['qlikview'], roles: ['hr'] }),
      demote,
    )
    // Operator pin stays first (strongest signal, immune to the feedback loop).
    expect(keywords[0]).toBe('qlikview')
  })

  it('does not change order when demoteTerms is empty or undefined', () => {
    const a = buildProfileKeywords(makeInput({ roles: ['hr'], industries: ['it'] }))
    const b = buildProfileKeywords(makeInput({ roles: ['hr'], industries: ['it'] }), new Set())
    const c = buildProfileKeywords(makeInput({ roles: ['hr'], industries: ['it'] }), undefined)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('keeps the demoted term count identical (bounded effect = re-order, not removal)', () => {
    const withoutDemote = buildProfileKeywords(
      makeInput({ roles: ['hr'], industries: ['finance', 'it'] }),
    )
    const withDemote = buildProfileKeywords(
      makeInput({ roles: ['hr'], industries: ['finance', 'it'] }),
      new Set(['финанс', 'банк']),
    )
    expect(withDemote.length).toBe(withoutDemote.length)
    expect(new Set(withDemote.map(k => k.toLowerCase()))).toEqual(
      new Set(withoutDemote.map(k => k.toLowerCase())),
    )
  })
})

describe('buildProfileSearchEnv', () => {
  it('emits HH_SEARCH_TEXT as space-joined keywords', () => {
    const env = buildProfileSearchEnv('hh' as SourceId, makeInput({ roles: ['hr'] }))
    expect(env.HH_SEARCH_TEXT).toBeDefined()
    expect(env.HH_SEARCH_TEXT).toContain('рекрутер')
    // free-text, not comma-joined
    expect(env.HH_SEARCH_TEXT).toMatch(/\s/)
    expect(env.HH_SEARCH_TEXT).not.toContain(',')
  })

  it('emits HABR_CAREER_KEYWORDS as comma-joined keywords', () => {
    const env = buildProfileSearchEnv(
      'habr-career' as SourceId,
      makeInput({ roles: ['hr', 'sales'] }),
    )
    expect(env.HABR_CAREER_KEYWORDS).toBeDefined()
    expect(env.HABR_CAREER_KEYWORDS).toContain(',')
    expect(env.HABR_CAREER_KEYWORDS.split(',')).toContain('рекрутер')
  })

  it('emits SUPERJOB_KEYWORD for superjob', () => {
    const env = buildProfileSearchEnv('superjob' as SourceId, makeInput({ roles: ['hr'] }))
    expect(env.SUPERJOB_KEYWORD).toBeDefined()
    expect(env.SUPERJOB_KEYWORD).toContain('рекрутер')
  })

  it('emits RABOTA_ROSSII_SEARCH_TEXT for rabota-rossii', () => {
    const env = buildProfileSearchEnv(
      'rabota-rossii' as SourceId,
      makeInput({ roles: ['hr'] }),
    )
    expect(env.RABOTA_ROSSII_SEARCH_TEXT).toBeDefined()
    expect(env.RABOTA_ROSSII_SEARCH_TEXT).toContain('рекрутер')
  })

  it('does NOT emit a region code from free-text targetCity (no lookup table yet)', () => {
    const env = buildProfileSearchEnv(
      'rabota-rossii' as SourceId,
      makeInput({ roles: ['hr'], targetCity: 'Москва' }),
    )
    // Region must stay absent: emitting a wrong federal-subject code would be
    // worse than none. This locks the honest "no-lookup" state until a code
    // table is added.
    expect(env.RABOTA_ROSSII_REGION).toBeUndefined()
  })

  it('returns {} for sources with no supported search params (career-pages)', () => {
    const env = buildProfileSearchEnv('career-pages' as SourceId, makeInput({ roles: ['hr'] }))
    expect(env).toEqual({})
  })

  it('returns {} when the profile yields no keywords', () => {
    const env = buildProfileSearchEnv('hh' as SourceId, makeInput())
    expect(env).toEqual({})
  })

  it('returns {} for an unknown source', () => {
    const env = buildProfileSearchEnv('unknown-source' as SourceId, makeInput({ roles: ['hr'] }))
    expect(env).toEqual({})
  })
})

describe('profileToSearchInput', () => {
  it('projects the relevant ClientProfile fields', () => {
    const input = profileToSearchInput(
      makeProfile({
        roles: ['hr'],
        industries: ['it'],
        excludedIndustries: ['finance'],
        includeKeywords: ['qlik'],
        excludeKeywords: ['junk'],
        targetCity: 'Москва',
      }),
    )
    expect(input).toMatchObject({
      roles: ['hr'],
      industries: ['it'],
      excludedIndustries: ['finance'],
      includeKeywords: ['qlik'],
      excludeKeywords: ['junk'],
      targetCity: 'Москва',
    })
  })

  it('defaults missing array fields to [] so the builder never sees undefined', () => {
    const input = profileToSearchInput(makeProfile())
    expect(input.roles).toEqual([])
    expect(input.industries).toEqual([])
    expect(input.excludedIndustries).toEqual([])
    expect(input.includeKeywords).toEqual([])
    expect(input.excludeKeywords).toEqual([])
  })
})
