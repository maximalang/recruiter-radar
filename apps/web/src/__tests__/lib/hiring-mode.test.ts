/**
 * Universal agency-model tests (2026-07-06).
 *
 * Verifies that the hiring-mode dimension changes product behavior across
 * agency types — not just labels. Covers:
 *   - normalizeHiringMode / resolveHiringMode (the model + auto inference)
 *   - mode-aware FIUR (executive seniority fit bonus + role-count discount)
 *   - mode-aware getClientScopeScore ranking (executive vs volume vs specialist)
 *   - mode-aware deriveUrgencyCue (executive downgrades volume cues)
 *   - mode-aware fit-explanation (seniority line for executive agencies)
 */
import {
  normalizeHiringMode,
  resolveHiringMode,
  type ClientProfile,
} from '@/lib/clientProfiles'
import { computeFiur, type FiurInput } from '@/lib/scoring/fiur'
import { getClientScopeScore } from '@/lib/digest'
import { deriveUrgencyCue } from '@/lib/leads/lead-quality'
import { buildFitExplanation } from '@/lib/leads/fit-explanation'
import type { DigestItemInput } from '@/lib/digest'

function profile(overrides: Partial<ClientProfile> = {}): ClientProfile {
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
    hiringMode: 'auto',
    ...overrides,
  }
}

describe('normalizeHiringMode', () => {
  it('accepts the four canonical modes', () => {
    expect(normalizeHiringMode('auto')).toBe('auto')
    expect(normalizeHiringMode('specialist')).toBe('specialist')
    expect(normalizeHiringMode('executive')).toBe('executive')
    expect(normalizeHiringMode('volume')).toBe('volume')
  })

  it('falls back to default for unknown / non-string input', () => {
    expect(normalizeHiringMode('unknown')).toBe('auto')
    expect(normalizeHiringMode(null)).toBe('auto')
    expect(normalizeHiringMode(undefined)).toBe('auto')
    expect(normalizeHiringMode(42)).toBe('auto')
  })

  it('trims and lowercases', () => {
    expect(normalizeHiringMode('  Executive  ')).toBe('executive')
  })
})

describe('resolveHiringMode', () => {
  it('returns an explicit non-auto mode unchanged', () => {
    expect(resolveHiringMode(profile({ hiringMode: 'executive' }))).toBe('executive')
    expect(resolveHiringMode(profile({ hiringMode: 'volume' }))).toBe('volume')
    expect(resolveHiringMode(profile({ hiringMode: 'specialist' }))).toBe('specialist')
  })

  it('auto → executive when an executive role is declared', () => {
    expect(resolveHiringMode(profile({ hiringMode: 'auto', roles: ['executive'] }))).toBe('executive')
    // Executive wins even alongside industrial/logistics roles.
    expect(
      resolveHiringMode(profile({ hiringMode: 'auto', roles: ['executive', 'industrial'] })),
    ).toBe('executive')
  })

  it('auto → volume when industrial/logistics roles DOMINATE (no executive)', () => {
    // A pure volume practice — all declared roles are industrial/logistics.
    expect(resolveHiringMode(profile({ hiringMode: 'auto', roles: ['industrial'] }))).toBe('volume')
    expect(resolveHiringMode(profile({ hiringMode: 'auto', roles: ['logistics'] }))).toBe('volume')
    expect(
      resolveHiringMode(profile({ hiringMode: 'auto', roles: ['industrial', 'logistics'] })),
    ).toBe('volume')
    // A majority-volume practice (2 of 3) also infers volume.
    expect(
      resolveHiringMode(
        profile({ hiringMode: 'auto', roles: ['industrial', 'logistics', 'it-engineering'] }),
      ),
    ).toBe('volume')
  })

  // R7 (review follow-up): a single industrial/logistics role amid a mostly-
  // specialist practice must NOT flip the whole agency into volume mode. The
  // pre-fix logic triggered volume on ANY volume-role presence, so an agency
  // with 1 industrial + 9 IT roles was mis-inferred as volume — too aggressive.
  // The fix requires volume roles to be ≥ 50% of the declared roles (a clear
  // majority) before auto-inference commits to volume; otherwise specialist.
  it('auto → specialist when a volume role is a minority of a mixed practice (R7)', () => {
    // 1 industrial + 9 IT → 10% volume share → specialist, NOT volume.
    expect(
      resolveHiringMode(
        profile({
          hiringMode: 'auto',
          roles: ['it-engineering', 'data', 'product', 'design', 'frontend', 'backend', 'mobile', 'devops', 'qa', 'industrial'],
        }),
      ),
    ).toBe('specialist')
    // 1 logistics + 1 IT → 50% is the boundary; ≥ 50% stays volume (tie goes
    // to volume so a half-volume practice still reads as volume, matching the
    // "dominant volume markets" framing). Confirm the boundary explicitly.
    expect(
      resolveHiringMode(profile({ hiringMode: 'auto', roles: ['logistics', 'it-engineering'] })),
    ).toBe('volume')
  })

  it('auto → specialist otherwise (the pre-existing default behavior)', () => {
    expect(resolveHiringMode(profile({ hiringMode: 'auto', roles: ['it-engineering'] }))).toBe(
      'specialist',
    )
    expect(resolveHiringMode(profile({ hiringMode: 'auto', roles: [] }))).toBe('specialist')
  })
})

// ─── Mode-aware FIUR ────────────────────────────────────────────────────────

function fiurInput(overrides: Partial<FiurInput> = {}): FiurInput {
  return {
    company: { id: 'org-1', name: 'TestCo' },
    vacancies: [
      { id: 'v1', title: 'Accountant', role: 'finance', publishedAt: new Date().toISOString() },
    ],
    clientProfile: {
      industries: [],
      roles: [],
      locations: [],
    },
    evidence: [],
    ...overrides,
  }
}

describe('FIUR executive mode', () => {
  it('awards a seniority fit bonus for a senior role', () => {
    const input = fiurInput({
      vacancies: [
        { id: 'v1', title: 'CFO', role: 'finance', publishedAt: new Date().toISOString() },
      ],
      clientProfile: { industries: [], roles: [], locations: [], hiringMode: 'executive' },
    })
    const result = computeFiur(input)
    expect(result.reasons.fit.some((r) => r.key === 'fit.seniority.match')).toBe(true)
  })

  it('emits an honest no-senior line for volume-only roles (no inflation)', () => {
    const input = fiurInput({
      vacancies: [
        { id: 'v1', title: 'Junior Developer', role: 'it-engineering', publishedAt: new Date().toISOString() },
        { id: 'v2', title: 'Junior Developer', role: 'it-engineering', publishedAt: new Date().toISOString() },
        { id: 'v3', title: 'Junior Developer', role: 'it-engineering', publishedAt: new Date().toISOString() },
      ],
      clientProfile: { industries: [], roles: [], locations: [], hiringMode: 'executive' },
    })
    const result = computeFiur(input)
    expect(result.reasons.fit.some((r) => r.key === 'fit.seniority.volume-mode')).toBe(true)
    // The role-count intent bonus is suppressed in executive mode.
    expect(result.reasons.intent.some((r) => r.key === 'intent.multiple-roles')).toBe(false)
  })
})

describe('FIUR specialist/volume mode', () => {
  it('keeps the role-count intent bonus for volume mode', () => {
    const input = fiurInput({
      vacancies: [
        { id: 'v1', title: 'Worker', role: 'industrial', publishedAt: new Date().toISOString() },
        { id: 'v2', title: 'Worker', role: 'industrial', publishedAt: new Date().toISOString() },
        { id: 'v3', title: 'Worker', role: 'industrial', publishedAt: new Date().toISOString() },
      ],
      clientProfile: { industries: [], roles: [], locations: [], hiringMode: 'volume' },
    })
    const result = computeFiur(input)
    expect(result.reasons.intent.some((r) => r.key === 'intent.multiple-roles')).toBe(true)
    // No seniority reason in non-executive modes.
    expect(result.reasons.fit.some((r) => r.key === 'fit.seniority.match')).toBe(false)
  })

  it('keeps the role-count intent bonus for specialist mode (default)', () => {
    const input = fiurInput({
      vacancies: [
        { id: 'v1', title: 'Engineer', role: 'it-engineering', publishedAt: new Date().toISOString() },
        { id: 'v2', title: 'Engineer', role: 'it-engineering', publishedAt: new Date().toISOString() },
        { id: 'v3', title: 'Engineer', role: 'it-engineering', publishedAt: new Date().toISOString() },
      ],
      clientProfile: { industries: [], roles: [], locations: [], hiringMode: 'specialist' },
    })
    const result = computeFiur(input)
    expect(result.reasons.intent.some((r) => r.key === 'intent.multiple-roles')).toBe(true)
  })
})

// ─── Mode-aware ranking ─────────────────────────────────────────────────────

function digestItem(overrides: Partial<DigestItemInput> = {}): DigestItemInput {
  return {
    rank: 1,
    org_id: 'org-1',
    source_external_id: 'ext-1',
    source_display_name: 'TestCo',
    source_families: ['hh'],
    evidence_titles: [],
    candidate_source_keys: [],
    location_names: [],
    vacancies_count: 1,
    distinct_vacancy_names_count: 1,
    latest_published_at: new Date().toISOString(),
    total_score: 300,
    reasons: ['У компании есть активная вакансия', 'Свежий сигнал найма'] as [string, string],
    opener: 'opener',
    confidence_gate: 'B',
    is_foreign_employer: false,
    foreign_matched_domain: null,
    ...overrides,
  } as DigestItemInput
}

describe('getClientScopeScore mode-aware ranking', () => {
  it('executive mode boosts a candidate with a senior role title', () => {
    const item = digestItem({ evidence_titles: ['Финансовый директор'] })
    const execProfile = profile({ hiringMode: 'executive' })
    const specialistProfile = profile({ hiringMode: 'specialist' })
    const execScore = getClientScopeScore(item, execProfile)
    const specialistScore = getClientScopeScore(item, specialistProfile)
    expect(execScore).toBeGreaterThan(specialistScore)
    expect(execScore - specialistScore).toBe(6) // the executive seniority boost
  })

  it('volume mode boosts a candidate with high open-role count', () => {
    const item = digestItem({ vacancies_count: 12 })
    const volumeProfile = profile({ hiringMode: 'volume' })
    const specialistProfile = profile({ hiringMode: 'specialist' })
    const volumeScore = getClientScopeScore(item, volumeProfile)
    const specialistScore = getClientScopeScore(item, specialistProfile)
    expect(volumeScore).toBeGreaterThan(specialistScore)
    expect(volumeScore - specialistScore).toBe(5) // 10+ roles → +5
  })

  it('volume mode gives a smaller boost for 5–9 roles', () => {
    const item = digestItem({ vacancies_count: 6 })
    const volumeScore = getClientScopeScore(item, profile({ hiringMode: 'volume' }))
    const specialistScore = getClientScopeScore(item, profile({ hiringMode: 'specialist' }))
    expect(volumeScore - specialistScore).toBe(3)
  })

  it('executive mode does NOT boost volume-only roles', () => {
    const item = digestItem({ vacancies_count: 12, evidence_titles: ['Worker'] })
    const execScore = getClientScopeScore(item, profile({ hiringMode: 'executive' }))
    const specialistScore = getClientScopeScore(item, profile({ hiringMode: 'specialist' }))
    // No senior title → no executive boost; equal to specialist baseline.
    expect(execScore).toBe(specialistScore)
  })
})

// ─── Mode-aware urgency ─────────────────────────────────────────────────────

describe('deriveUrgencyCue mode-aware', () => {
  it('executive mode downgrades volume cues — 10 roles does NOT read as "active"', () => {
    const cue = deriveUrgencyCue({
      vacanciesCount: 12,
      latestPublishedAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
      hiringMode: 'executive',
    })
    // 20 days old → not fresh; executive mode does not lead with volume.
    expect(cue.level).not.toBe('active')
    expect(cue.label).not.toContain('12')
  })

  it('executive mode upgrades a fresh single posting', () => {
    const cue = deriveUrgencyCue({
      vacanciesCount: 1,
      latestPublishedAt: new Date().toISOString(),
      hiringMode: 'executive',
    })
    expect(cue.level).toBe('fresh')
    expect(cue.label).toContain('Свежая вакансия')
  })

  it('volume mode keeps the volume-shaped ladder', () => {
    const cue = deriveUrgencyCue({
      vacanciesCount: 12,
      latestPublishedAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
      hiringMode: 'volume',
    })
    expect(cue.level).toBe('active')
    expect(cue.label).toContain('12')
  })

  it('specialist mode (default) keeps the pre-mode behavior', () => {
    const cue = deriveUrgencyCue({
      vacanciesCount: 12,
      latestPublishedAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
      hiringMode: 'specialist',
    })
    expect(cue.level).toBe('active')
  })
})

// ─── Mode-aware fit-explanation ─────────────────────────────────────────────

describe('buildFitExplanation seniority line', () => {
  it('surfaces a seniority line when FIUR emitted fit.seniority.match', () => {
    const lead = {
      structuredReasons: [
        { component: 'fit' as const, key: 'fit.seniority.match' },
        { component: 'fit' as const, key: 'fit.role.match', params: { count: 1 } },
      ],
      locationNames: [],
      lawfulContactPath: null,
      sourceFamilies: ['career-pages'],
    }
    const result = buildFitExplanation(lead, {
      industries: [],
      roles: ['executive'],
      excludedIndustries: [],
      excludedLocations: [],
      contactPolicy: 'corporate_only',
      remoteFriendly: false,
      targetCity: null,
    })
    const seniorityLine = result.lines.find((l) => l.dimension === 'seniority')
    expect(seniorityLine).toBeDefined()
    expect(seniorityLine!.basis).toBe('fit.seniority.match')
    expect(seniorityLine!.text).toContain('руководителя')
  })

  it('does not surface a seniority line when the reason is absent', () => {
    const lead = {
      structuredReasons: [
        { component: 'fit' as const, key: 'fit.role.match', params: { count: 2 } },
      ],
      locationNames: [],
      lawfulContactPath: null,
      sourceFamilies: ['hh'],
    }
    const result = buildFitExplanation(lead, {
      industries: [],
      roles: [],
      excludedIndustries: [],
      excludedLocations: [],
      contactPolicy: 'corporate_only',
      remoteFriendly: false,
      targetCity: null,
    })
    expect(result.lines.find((l) => l.dimension === 'seniority')).toBeUndefined()
  })
})
