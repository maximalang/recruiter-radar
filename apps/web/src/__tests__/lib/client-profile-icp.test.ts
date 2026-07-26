import {
  clientProfileToAgencyProfile,
  VALID_COMPANY_SIZES,
  VALID_INDUSTRIES,
  INDUSTRY_KEYWORDS,
  type ClientProfile,
} from '@/lib/clientProfiles'

function makeProfile(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return {
    id: '1',
    agencyName: 'Test Agency',
    telegramChatId: null,
    targetCity: null,
    specialization: null,
    includeKeywords: [],
    excludeKeywords: [],
    industries: [],
    companySizes: [],
    dailyDigestLimit: 5,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    contactPolicy: 'corporate_only',
    roles: [],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: false,
    hiringIntentMin: null,
    signalFreshnessDays: null,
    minOpenRoles: null,
    hiringMode: 'auto',
    ...overrides,
  }
}

describe('clientProfileToAgencyProfile', () => {
  it('maps industries from ClientProfile', () => {
    const profile = makeProfile({ industries: ['it', 'finance'] })
    const agency = clientProfileToAgencyProfile(profile)

    expect(agency.industries).toEqual(['it', 'finance'])
  })

  it('maps targetCity to locations', () => {
    const profile = makeProfile({ targetCity: 'Москва' })
    const agency = clientProfileToAgencyProfile(profile)

    expect(agency.locations).toEqual(['Москва'])
  })

  it('returns empty locations when targetCity is null', () => {
    const profile = makeProfile({ targetCity: null })
    const agency = clientProfileToAgencyProfile(profile)

    expect(agency.locations).toEqual([])
  })

  it('maps companySizes with valid values only', () => {
    const profile = makeProfile({ companySizes: ['startup', 'medium', 'large'] })
    const agency = clientProfileToAgencyProfile(profile)

    expect(agency.companySizes).toEqual(['startup', 'medium', 'large'])
  })

  it('filters invalid company size values', () => {
    // This shouldn't happen in practice due to normalizeCompanySizeList,
    // but the bridge function also validates as a safety net
    const profile = makeProfile({ companySizes: ['startup', 'invalid', 'large'] })
    const agency = clientProfileToAgencyProfile(profile)

    expect(agency.companySizes).toEqual(['startup', 'large'])
  })

  it('maps excludeKeywords to exclusions', () => {
    const profile = makeProfile({ excludeKeywords: ['вахта', 'завод'] })
    const agency = clientProfileToAgencyProfile(profile)

    expect(agency.exclusions).toEqual(['вахта', 'завод'])
  })

  it('returns empty excludedIndustries and excludedLocations', () => {
    const profile = makeProfile()
    const agency = clientProfileToAgencyProfile(profile)

    expect(agency.excludedIndustries).toEqual([])
    expect(agency.excludedLocations).toEqual([])
  })

  it('returns empty arrays for a placeholder profile', () => {
    const profile = makeProfile()
    const agency = clientProfileToAgencyProfile(profile)

    expect(agency.industries).toEqual([])
    expect(agency.locations).toEqual([])
    expect(agency.companySizes).toEqual([])
    expect(agency.exclusions).toEqual([])
  })

  it('filters invalid industry values', () => {
    // normalizeIndustryList should strip unknown keys before they reach the bridge
    const profile = makeProfile({ industries: ['it', 'nonexistent', 'finance'] })
    const agency = clientProfileToAgencyProfile(profile)

    expect(agency.industries).toEqual(['it', 'finance'])
  })
})

describe('VALID_COMPANY_SIZES', () => {
  it('contains exactly 5 valid sizes', () => {
    expect(VALID_COMPANY_SIZES.size).toBe(5)
  })

  it('contains startup, small, medium, large, enterprise', () => {
    expect(VALID_COMPANY_SIZES.has('startup')).toBe(true)
    expect(VALID_COMPANY_SIZES.has('small')).toBe(true)
    expect(VALID_COMPANY_SIZES.has('medium')).toBe(true)
    expect(VALID_COMPANY_SIZES.has('large')).toBe(true)
    expect(VALID_COMPANY_SIZES.has('enterprise')).toBe(true)
  })

  it('does not contain invalid values', () => {
    expect(VALID_COMPANY_SIZES.has('huge')).toBe(false)
    expect(VALID_COMPANY_SIZES.has('')).toBe(false)
    expect(VALID_COMPANY_SIZES.has('Startup')).toBe(false) // case-sensitive
  })
})

describe('VALID_INDUSTRIES', () => {
  it('contains exactly 17 valid industries', () => {
    // 10 original IT+generalist sectors + 7 non-IT sectors added 2026-07-06
    // (agro, hospitality, energy, government, real-estate, telecom, auto) so
    // the product framing + matching work for industrial / regional / mass /
    // executive agencies, not only IT + finance.
    expect(VALID_INDUSTRIES.size).toBe(17)
  })

  it('contains all canonical industry keys', () => {
    const expected = [
      'it', 'finance', 'manufacturing', 'retail', 'healthcare', 'construction',
      'logistics', 'consulting', 'education', 'media',
      'agro', 'hospitality', 'energy', 'government', 'real-estate', 'telecom', 'auto',
    ]
    for (const key of expected) {
      expect(VALID_INDUSTRIES.has(key)).toBe(true)
    }
  })

  it('does not contain invalid values', () => {
    expect(VALID_INDUSTRIES.has('pharma')).toBe(false)
    expect(VALID_INDUSTRIES.has('')).toBe(false)
    expect(VALID_INDUSTRIES.has('IT')).toBe(false) // case-sensitive
  })
})

describe('INDUSTRY_KEYWORDS', () => {
  it('has keyword entries for every valid industry', () => {
    for (const key of VALID_INDUSTRIES) {
      expect(INDUSTRY_KEYWORDS.has(key)).toBe(true)
    }
  })

  it('every keyword entry has at least one search term', () => {
    for (const [, keywords] of INDUSTRY_KEYWORDS) {
      expect(keywords.length).toBeGreaterThan(0)
    }
  })

  it('contains Russian keywords for IT industry', () => {
    const itKeywords = INDUSTRY_KEYWORDS.get('it')!
    expect(itKeywords.some(k => k.includes('айти') || k.includes('разработк') || k.includes('софт'))).toBe(true)
  })
})
