/**
 * Tests for T1: ICP profile expansion — roles, excludedIndustries, excludedLocations, remoteFriendly.
 *
 * These test the ClientProfile type + mapping + clientProfileToAgencyProfile bridge.
 * They verify that new ICP fields flow correctly into the scoring pipeline input.
 */

import {
  ClientProfile,
  clientProfileToAgencyProfile,
  VALID_ROLES,
  VALID_INDUSTRIES,
} from '@/lib/clientProfiles'

// ─── ClientProfile type accepts new fields ────────────────────────

function makeClientProfile(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return {
    id: '1',
    agencyName: 'Test Agency',
    telegramChatId: null,
    targetCity: 'Москва',
    specialization: null,
    includeKeywords: [],
    excludeKeywords: [],
    industries: ['it'],
    companySizes: ['medium'],
    dailyDigestLimit: 5,
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    contactPolicy: 'corporate_only',
    roles: ['it-engineering', 'data'],
    excludedIndustries: ['healthcare'],
    excludedLocations: ['Владивосток'],
    remoteFriendly: true,
    hiringIntentMin: null,
    signalFreshnessDays: null,
    minOpenRoles: null,
    hiringMode: 'auto',
    ...overrides,
  }
}

describe('ClientProfile ICP expansion (T1)', () => {
  it('ClientProfile type accepts roles field', () => {
    const profile = makeClientProfile({ roles: ['it-engineering', 'data', 'product'] })
    expect(profile.roles).toEqual(['it-engineering', 'data', 'product'])
  })

  it('ClientProfile type accepts excludedIndustries field', () => {
    const profile = makeClientProfile({ excludedIndustries: ['healthcare', 'construction'] })
    expect(profile.excludedIndustries).toEqual(['healthcare', 'construction'])
  })

  it('ClientProfile type accepts excludedLocations field', () => {
    const profile = makeClientProfile({ excludedLocations: ['Владивосток', 'Казань'] })
    expect(profile.excludedLocations).toEqual(['Владивосток', 'Казань'])
  })

  it('ClientProfile type accepts remoteFriendly field', () => {
    const profile = makeClientProfile({ remoteFriendly: true })
    expect(profile.remoteFriendly).toBe(true)
  })

  it('ClientProfile defaults: roles=[], excludedIndustries=[], excludedLocations=[], remoteFriendly=false', () => {
    const profile = makeClientProfile({
      roles: [],
      excludedIndustries: [],
      excludedLocations: [],
      remoteFriendly: false,
    })
    expect(profile.roles).toEqual([])
    expect(profile.excludedIndustries).toEqual([])
    expect(profile.excludedLocations).toEqual([])
    expect(profile.remoteFriendly).toBe(false)
  })
})

// ─── clientProfileToAgencyProfile bridge ──────────────────────────

describe('clientProfileToAgencyProfile — new ICP fields', () => {
  it('maps roles from ClientProfile to AgencyProfile', () => {
    const profile = makeClientProfile({ roles: ['it-engineering', 'data'] })
    const agency = clientProfileToAgencyProfile(profile)
    expect(agency.roles).toEqual(['it-engineering', 'data'])
  })

  it('maps excludedIndustries from ClientProfile to AgencyProfile', () => {
    const profile = makeClientProfile({ excludedIndustries: ['healthcare', 'construction'] })
    const agency = clientProfileToAgencyProfile(profile)
    expect(agency.excludedIndustries).toEqual(['healthcare', 'construction'])
  })

  it('maps excludedLocations from ClientProfile to AgencyProfile', () => {
    const profile = makeClientProfile({ excludedLocations: ['Владивосток'] })
    const agency = clientProfileToAgencyProfile(profile)
    expect(agency.excludedLocations).toEqual(['Владивосток'])
  })

  it('maps remoteFriendly from ClientProfile to AgencyProfile', () => {
    const profile = makeClientProfile({ remoteFriendly: true })
    const agency = clientProfileToAgencyProfile(profile)
    expect(agency.remoteFriendly).toBe(true)
  })

  it('default AgencyProfile has empty roles, excludedIndustries, excludedLocations, remoteFriendly=false', () => {
    const profile = makeClientProfile({
      roles: [],
      excludedIndustries: [],
      excludedLocations: [],
      remoteFriendly: false,
    })
    const agency = clientProfileToAgencyProfile(profile)
    expect(agency.roles).toEqual([])
    expect(agency.excludedIndustries).toEqual([])
    expect(agency.excludedLocations).toEqual([])
    expect(agency.remoteFriendly).toBe(false)
  })
})

// ─── VALID_ROLES set ──────────────────────────────────────────────

describe('VALID_ROLES', () => {
  it('contains expected agency role keys', () => {
    expect(VALID_ROLES.has('it-engineering')).toBe(true)
    expect(VALID_ROLES.has('data')).toBe(true)
    expect(VALID_ROLES.has('product')).toBe(true)
    expect(VALID_ROLES.has('sales')).toBe(true)
    expect(VALID_ROLES.has('marketing')).toBe(true)
    expect(VALID_ROLES.has('hr')).toBe(true)
    expect(VALID_ROLES.has('finance')).toBe(true)
    expect(VALID_ROLES.has('operations')).toBe(true)
    expect(VALID_ROLES.has('legal')).toBe(true)
    expect(VALID_ROLES.has('executive')).toBe(true)
  })

  it('does not contain invalid role keys', () => {
    expect(VALID_ROLES.has('random-stuff')).toBe(false)
    expect(VALID_ROLES.has('')).toBe(false)
  })
})
