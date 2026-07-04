import {
  deriveRoleNames,
  splitRolesForDisplay,
  deriveUrgencyCue,
  passesMinimumSignalGate,
} from '@/lib/leads/lead-quality'

describe('deriveRoleNames', () => {
  it('returns cleaned, deduped evidence titles preserving order', () => {
    const roles = deriveRoleNames({
      evidenceTitles: ['Backend Developer', 'backend developer', 'QA Engineer', '  '],
    })
    expect(roles).toEqual(['Backend Developer', 'QA Engineer'])
  })

  it('drops noise tokens', () => {
    const roles = deriveRoleNames({
      evidenceTitles: ['Hiring Position', 'вакансия', 'ML Engineer'],
    })
    expect(roles).toEqual(['ML Engineer'])
  })

  it('falls back to AI role titles only when evidence has none', () => {
    expect(
      deriveRoleNames({ evidenceTitles: [], aiRoleTitles: ['Data Scientist'] }),
    ).toEqual(['Data Scientist'])
    // Evidence wins when present — AI never overrides real evidence.
    expect(
      deriveRoleNames({ evidenceTitles: ['Backend'], aiRoleTitles: ['Data Scientist'] }),
    ).toEqual(['Backend'])
  })

  it('returns empty when nothing usable exists', () => {
    expect(deriveRoleNames({ evidenceTitles: null, aiRoleTitles: null })).toEqual([])
  })
})

describe('splitRolesForDisplay', () => {
  it('shows all when at or under the limit', () => {
    expect(splitRolesForDisplay(['a', 'b', 'c'], 5)).toEqual({ shown: ['a', 'b', 'c'], more: 0 })
  })
  it('caps and reports the remainder', () => {
    expect(splitRolesForDisplay(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5)).toEqual({
      shown: ['a', 'b', 'c', 'd', 'e'],
      more: 2,
    })
  })
})

describe('deriveUrgencyCue', () => {
  const now = Date.parse('2026-07-03T00:00:00Z')
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString()

  it('flags a burst on 5+ recent signals', () => {
    const cue = deriveUrgencyCue({ vacanciesCount: 6, recentSignalCount: 6, latestPublishedAt: daysAgo(1), now })
    expect(cue.level).toBe('burst')
    expect(cue.label).toContain('7 дней')
  })

  it('flags active hiring on 10+ open roles', () => {
    const cue = deriveUrgencyCue({ vacanciesCount: 12, recentSignalCount: 1, latestPublishedAt: daysAgo(3), now })
    expect(cue.level).toBe('active')
    expect(cue.label).toContain('12')
  })

  it('flags fresh when the latest signal is within a week', () => {
    const cue = deriveUrgencyCue({ vacanciesCount: 1, latestPublishedAt: daysAgo(2), now })
    expect(cue.level).toBe('fresh')
  })

  it('downgrades to stale past 30 days', () => {
    const cue = deriveUrgencyCue({ vacanciesCount: 2, latestPublishedAt: daysAgo(40), now })
    expect(cue.level).toBe('stale')
    expect(cue.label).toContain('дней назад')
  })

  it('falls back to a neutral cue with no date and low counts', () => {
    const cue = deriveUrgencyCue({ vacanciesCount: 1, latestPublishedAt: null, now })
    expect(cue.level).toBe('normal')
  })
})

describe('passesMinimumSignalGate', () => {
  const base = {
    vacanciesCount: 0,
    roleNames: [] as string[],
    hasAiHint: false,
    sourceFamilies: [] as string[],
    confidenceGate: 'C',
  }

  it('fails an empty shell (no roles, no AI hint, no direct surface)', () => {
    expect(passesMinimumSignalGate(base)).toBe(false)
  })

  it('passes when real roles exist', () => {
    expect(passesMinimumSignalGate({ ...base, vacanciesCount: 2, roleNames: ['Backend'] })).toBe(true)
  })

  it('passes on an AI hint alone', () => {
    expect(passesMinimumSignalGate({ ...base, hasAiHint: true })).toBe(true)
  })

  it('passes on a direct corporate surface (career-pages)', () => {
    expect(passesMinimumSignalGate({ ...base, sourceFamilies: ['career-pages'] })).toBe(true)
  })

  it('passes on an A/B gate', () => {
    expect(passesMinimumSignalGate({ ...base, confidenceGate: 'A' })).toBe(true)
  })
})
