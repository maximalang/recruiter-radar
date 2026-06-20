import { detectHiringBurst, type BurstVacancy } from '@/lib/scoring/hiring-burst'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-05-27T12:00:00.000Z')

function vac(overrides: Partial<BurstVacancy> = {}): BurstVacancy {
  return {
    id: 'v-1',
    role: 'backend engineer',
    publishedAt: new Date(NOW - 3 * DAY_MS).toISOString(),
    isInternalRecruiter: false,
    ...overrides,
  }
}

describe('detectHiringBurst', () => {
  it('returns no burst when there are zero vacancies', () => {
    const result = detectHiringBurst({ vacancies: [], now: () => NOW })

    expect(result.isBurst).toBe(false)
    expect(result.score).toBe(0)
    expect(result.recentCount).toBe(0)
    expect(result.reasons[0]).toMatch(/no vacancies/i)
  })

  it('ignores internal-recruiter vacancies — they do not count toward burst', () => {
    const result = detectHiringBurst({
      vacancies: [
        vac({ id: 'v-1', isInternalRecruiter: true }),
        vac({ id: 'v-2', isInternalRecruiter: true }),
        vac({ id: 'v-3', isInternalRecruiter: true }),
      ],
      now: () => NOW,
    })

    expect(result.isBurst).toBe(false)
    expect(result.recentCount).toBe(0)
  })

  it('does not flag a burst when fewer than 3 vacancies are within the 14-day window', () => {
    const result = detectHiringBurst({
      vacancies: [
        vac({ id: 'v-1' }),
        vac({ id: 'v-2' }),
      ],
      now: () => NOW,
    })

    expect(result.isBurst).toBe(false)
    expect(result.recentCount).toBe(2)
    expect(result.score).toBeLessThan(0.4)
  })

  it('flags a burst with 3+ fresh vacancies inside the 14-day window', () => {
    const result = detectHiringBurst({
      vacancies: [
        vac({ id: 'v-1', publishedAt: new Date(NOW - 1 * DAY_MS).toISOString() }),
        vac({ id: 'v-2', publishedAt: new Date(NOW - 5 * DAY_MS).toISOString() }),
        vac({ id: 'v-3', publishedAt: new Date(NOW - 13 * DAY_MS).toISOString() }),
      ],
      now: () => NOW,
    })

    expect(result.isBurst).toBe(true)
    expect(result.recentCount).toBe(3)
    expect(result.score).toBeGreaterThanOrEqual(0.4)
    expect(result.reasons.some((r) => /burst|spike|concurrent/i.test(r))).toBe(true)
  })

  it('excludes vacancies older than the 14-day window from the burst count', () => {
    const result = detectHiringBurst({
      vacancies: [
        vac({ id: 'v-1', publishedAt: new Date(NOW - 2 * DAY_MS).toISOString() }),
        vac({ id: 'v-2', publishedAt: new Date(NOW - 30 * DAY_MS).toISOString() }),
        vac({ id: 'v-3', publishedAt: new Date(NOW - 60 * DAY_MS).toISOString() }),
      ],
      now: () => NOW,
    })

    expect(result.isBurst).toBe(false)
    expect(result.recentCount).toBe(1)
  })

  it('rewards role diversity — same role 5x scores lower than 5 distinct roles', () => {
    const sameRole = detectHiringBurst({
      vacancies: Array.from({ length: 5 }, (_, i) =>
        vac({
          id: `v-${i}`,
          role: 'backend engineer',
          publishedAt: new Date(NOW - (i + 1) * DAY_MS).toISOString(),
        })
      ),
      now: () => NOW,
    })

    const diverseRoles = detectHiringBurst({
      vacancies: ['backend', 'frontend', 'hr', 'sales', 'designer'].map((r, i) =>
        vac({
          id: `v-${i}`,
          role: r,
          publishedAt: new Date(NOW - (i + 1) * DAY_MS).toISOString(),
        })
      ),
      now: () => NOW,
    })

    expect(diverseRoles.isBurst).toBe(true)
    expect(sameRole.isBurst).toBe(true)
    expect(diverseRoles.score).toBeGreaterThan(sameRole.score)
    expect(diverseRoles.distinctRoles).toBe(5)
    expect(sameRole.distinctRoles).toBe(1)
  })

  it('amplifies a burst built from very fresh (0–3 day) postings', () => {
    const fresh = detectHiringBurst({
      vacancies: [
        vac({ id: 'v-1', role: 'backend', publishedAt: new Date(NOW - 0 * DAY_MS).toISOString() }),
        vac({ id: 'v-2', role: 'frontend', publishedAt: new Date(NOW - 1 * DAY_MS).toISOString() }),
        vac({ id: 'v-3', role: 'sales', publishedAt: new Date(NOW - 2 * DAY_MS).toISOString() }),
      ],
      now: () => NOW,
    })

    const trailing = detectHiringBurst({
      vacancies: [
        vac({ id: 'v-1', role: 'backend', publishedAt: new Date(NOW - 10 * DAY_MS).toISOString() }),
        vac({ id: 'v-2', role: 'frontend', publishedAt: new Date(NOW - 11 * DAY_MS).toISOString() }),
        vac({ id: 'v-3', role: 'sales', publishedAt: new Date(NOW - 13 * DAY_MS).toISOString() }),
      ],
      now: () => NOW,
    })

    expect(fresh.isBurst).toBe(true)
    expect(trailing.isBurst).toBe(true)
    expect(fresh.freshCount).toBe(3)
    expect(trailing.freshCount).toBe(0)
    expect(fresh.score).toBeGreaterThan(trailing.score)
  })

  it('does not let the recency boost push a sub-threshold signal into burst', () => {
    // Two postings today: very fresh, but below BURST_THRESHOLD. The recency
    // amplifier must stay gated behind isBurst so this remains non-burst.
    const result = detectHiringBurst({
      vacancies: [
        vac({ id: 'v-1', publishedAt: new Date(NOW - 0 * DAY_MS).toISOString() }),
        vac({ id: 'v-2', publishedAt: new Date(NOW - 1 * DAY_MS).toISOString() }),
      ],
      now: () => NOW,
    })

    expect(result.isBurst).toBe(false)
    expect(result.freshCount).toBe(2)
    expect(result.score).toBeLessThan(0.4)
  })

  it('clamps the score to [0, 1] even with many fresh diverse vacancies', () => {
    const result = detectHiringBurst({
      vacancies: Array.from({ length: 30 }, (_, i) =>
        vac({
          id: `v-${i}`,
          role: `role-${i}`,
          publishedAt: new Date(NOW - (i % 14) * DAY_MS).toISOString(),
        })
      ),
      now: () => NOW,
    })

    expect(result.score).toBeLessThanOrEqual(1)
    expect(result.score).toBeGreaterThan(0)
  })

  it('skips vacancies with unparseable publishedAt timestamps', () => {
    const result = detectHiringBurst({
      vacancies: [
        vac({ id: 'v-1', publishedAt: 'not-a-date' }),
        vac({ id: 'v-2', publishedAt: 'also-bad' }),
      ],
      now: () => NOW,
    })

    expect(result.isBurst).toBe(false)
    expect(result.recentCount).toBe(0)
  })
})
