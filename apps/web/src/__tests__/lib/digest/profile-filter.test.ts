/**
 * Unit tests for matchesClientProfile + getClientScopeScore (lib/digest.ts).
 *
 * Unlike pipeline-gates.test.ts (which mirrors the filter logic), these import
 * the REAL functions so regressions in the per-client digest filter are caught.
 *
 * Covers the S1 wiring added 2026-06-27: contactPolicy gate, excludedLocations
 * drop, excludedIndustries drop, remoteFriendly relaxation, and roles boost.
 */

import {
  matchesClientProfile,
  getClientScopeScore,
  type DigestItemInput,
} from '@/lib/digest'
import type { ClientProfile } from '@/lib/clientProfiles'

function mockItem(overrides: Partial<DigestItemInput> = {}): DigestItemInput {
  return {
    rank: 1,
    org_id: '1',
    source_external_id: 'hh-123',
    source_display_name: 'Тестовая компания',
    source_families: ['hh'],
    evidence_titles: ['Backend разработчик'],
    candidate_source_keys: [],
    location_names: ['Москва'],
    vacancies_count: 2,
    distinct_vacancy_names_count: 1,
    latest_published_at: new Date().toISOString(),
    total_score: 320,
    reasons: ['Есть активная вакансия', 'Опубликовано в пределах месяца'],
    opener: 'Здравствуйте! По Тестовая компания видно...',
    confidence_gate: 'A',
    ...overrides,
  }
}

function mockProfile(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return {
    id: '1',
    agencyName: 'Агентство',
    telegramChatId: null,
    targetCity: null,
    specialization: null,
    includeKeywords: [],
    excludeKeywords: [],
    industries: [],
    companySizes: [],
    dailyDigestLimit: 10,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contactPolicy: 'unrestricted',
    roles: [],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: false,
    hiringIntentMin: null,
    signalFreshnessDays: null,
    minOpenRoles: null,
    ...overrides,
  }
}

describe('matchesClientProfile — contactPolicy gate', () => {
  it('corporate_only passes a gate A candidate even without career-pages source', () => {
    const item = mockItem({ confidence_gate: 'A', source_families: ['hh'] })
    const profile = mockProfile({ contactPolicy: 'corporate_only' })
    expect(matchesClientProfile(item, profile)).toBe(true)
  })

  it('corporate_only passes a gate B candidate (auto-deliverable surface)', () => {
    const item = mockItem({ confidence_gate: 'B', source_families: ['hh'] })
    const profile = mockProfile({ contactPolicy: 'corporate_only' })
    expect(matchesClientProfile(item, profile)).toBe(true)
  })

  it('corporate_only passes a gate C candidate WHEN career-pages source is present', () => {
    const item = mockItem({ confidence_gate: 'C', source_families: ['hh', 'career-pages'] })
    const profile = mockProfile({ contactPolicy: 'corporate_only' })
    expect(matchesClientProfile(item, profile)).toBe(true)
  })

  it('corporate_only DROPS a gate C platform-only candidate (no corporate surface)', () => {
    const item = mockItem({ confidence_gate: 'C', source_families: ['hh'] })
    const profile = mockProfile({ contactPolicy: 'corporate_only' })
    expect(matchesClientProfile(item, profile)).toBe(false)
  })

  it('unrestricted policy keeps a gate C platform-only candidate', () => {
    const item = mockItem({ confidence_gate: 'C', source_families: ['hh'] })
    const profile = mockProfile({ contactPolicy: 'unrestricted' })
    expect(matchesClientProfile(item, profile)).toBe(true)
  })
})

describe('matchesClientProfile — excludedLocations', () => {
  it('drops a candidate whose location matches an excluded location', () => {
    const item = mockItem({ location_names: ['Москва'] })
    const profile = mockProfile({ excludedLocations: ['Москва'] })
    expect(matchesClientProfile(item, profile)).toBe(false)
  })

  it('keeps a candidate in a non-excluded location', () => {
    const item = mockItem({ location_names: ['Казань'] })
    const profile = mockProfile({ excludedLocations: ['Москва'] })
    expect(matchesClientProfile(item, profile)).toBe(true)
  })

  it('remoteFriendly relaxes excludedLocations when candidate has a remote signal', () => {
    const item = mockItem({
      location_names: ['Москва'],
      reasons: ['Удалённая вакансия', 'Опубликовано недавно'],
    })
    const profile = mockProfile({ excludedLocations: ['Москва'], remoteFriendly: true })
    expect(matchesClientProfile(item, profile)).toBe(true)
  })

  it('remoteFriendly does NOT relax when candidate has no remote signal', () => {
    const item = mockItem({ location_names: ['Москва'], reasons: ['Офисная вакансия', ''] })
    const profile = mockProfile({ excludedLocations: ['Москва'], remoteFriendly: true })
    expect(matchesClientProfile(item, profile)).toBe(false)
  })
})

describe('matchesClientProfile — excludedIndustries', () => {
  it('drops a candidate matching an excluded industry keyword', () => {
    const item = mockItem({ source_display_name: 'Сбербанк', evidence_titles: ['Финансовый аналитик'] })
    const profile = mockProfile({ excludedIndustries: ['finance'] })
    expect(matchesClientProfile(item, profile)).toBe(false)
  })

  it('keeps a candidate outside the excluded industry', () => {
    const item = mockItem({ source_display_name: 'Яндекс', evidence_titles: ['Разработчик'] })
    const profile = mockProfile({ excludedIndustries: ['finance'] })
    expect(matchesClientProfile(item, profile)).toBe(true)
  })
})

describe('getClientScopeScore — roles boost', () => {
  it('boosts a candidate whose evidence matches a target role', () => {
    const withRole = mockItem({ evidence_titles: ['Разработчик Python'], reasons: ['Разработчик нужен', ''] })
    const profile = mockProfile({ roles: ['it-engineering'] })
    const noRoleProfile = mockProfile({ roles: [] })
    expect(getClientScopeScore(withRole, profile)).toBeGreaterThan(
      getClientScopeScore(withRole, noRoleProfile),
    )
  })

  it('does not boost when no role keyword matches', () => {
    const item = mockItem({ evidence_titles: ['Бариста'], reasons: ['', ''], source_display_name: 'Кофейня' })
    const profile = mockProfile({ roles: ['it-engineering'] })
    expect(getClientScopeScore(item, profile)).toBe(0)
  })
})

describe('matchesClientProfile — hiringIntentMin gate', () => {
  // total_score is the raw evidence score (~200–390). hiringIntentMin is on the
  // [0,4] signal-strength scale, so the gate divides total_score by 100 before
  // comparing: raw 320 → strength 3.2, raw 210 → strength 2.1.
  it('keeps a candidate at or above the signal-strength threshold', () => {
    const item = mockItem({ total_score: 320 })
    expect(matchesClientProfile(item, mockProfile({ hiringIntentMin: 3.0 }))).toBe(true)
  })

  it('drops a candidate below the signal-strength threshold', () => {
    const item = mockItem({ total_score: 210 })
    expect(matchesClientProfile(item, mockProfile({ hiringIntentMin: 3.0 }))).toBe(false)
  })

  it('is a no-op when unset (null)', () => {
    const item = mockItem({ total_score: 50 })
    expect(matchesClientProfile(item, mockProfile({ hiringIntentMin: null }))).toBe(true)
  })
})

describe('matchesClientProfile — minOpenRoles gate', () => {
  it('keeps a candidate with enough open roles', () => {
    const item = mockItem({ vacancies_count: 4 })
    expect(matchesClientProfile(item, mockProfile({ minOpenRoles: 3 }))).toBe(true)
  })

  it('drops a candidate with too few open roles', () => {
    const item = mockItem({ vacancies_count: 1 })
    expect(matchesClientProfile(item, mockProfile({ minOpenRoles: 3 }))).toBe(false)
  })

  it('is a no-op when unset (null)', () => {
    const item = mockItem({ vacancies_count: 0 })
    expect(matchesClientProfile(item, mockProfile({ minOpenRoles: null }))).toBe(true)
  })
})

describe('matchesClientProfile — signalFreshnessDays gate', () => {
  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  }

  it('keeps a candidate whose signal is within the window', () => {
    const item = mockItem({ latest_published_at: daysAgo(5) })
    expect(matchesClientProfile(item, mockProfile({ signalFreshnessDays: 14 }))).toBe(true)
  })

  it('drops a candidate whose signal is older than the window', () => {
    const item = mockItem({ latest_published_at: daysAgo(40) })
    expect(matchesClientProfile(item, mockProfile({ signalFreshnessDays: 14 }))).toBe(false)
  })

  it('keeps a candidate with no signal date (cannot prove staleness)', () => {
    const item = mockItem({ latest_published_at: null })
    expect(matchesClientProfile(item, mockProfile({ signalFreshnessDays: 14 }))).toBe(true)
  })

  it('is a no-op when unset (null)', () => {
    const item = mockItem({ latest_published_at: daysAgo(400) })
    expect(matchesClientProfile(item, mockProfile({ signalFreshnessDays: null }))).toBe(true)
  })
})

