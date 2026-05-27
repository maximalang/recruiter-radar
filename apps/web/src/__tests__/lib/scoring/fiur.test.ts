import {
  computeFiur,
  type FiurInput,
} from '@/lib/scoring/fiur'

const baseProfile: FiurInput['clientProfile'] = {
  industries: ['fintech'],
  roles: ['backend engineer', 'ml engineer'],
  locations: ['Moscow', 'Remote'],
  companySizes: ['medium', 'large'],
  exclusions: ['gambling'],
}

const baseCompany: FiurInput['company'] = {
  id: 'co-1',
  name: 'Acme Fintech',
  industry: 'fintech',
  location: 'Moscow',
  size: 'medium',
  hasCareerPage: true,
  hasCorporateContactPath: true,
}

function vacancy(
  override: Partial<NonNullable<FiurInput['vacancies']>[number]> = {}
): NonNullable<FiurInput['vacancies']>[number] {
  return {
    id: 'v-1',
    title: 'Senior Backend Engineer',
    role: 'backend engineer',
    location: 'Moscow',
    publishedAt: new Date().toISOString(),
    isInternalRecruiter: false,
    isHardToFill: false,
    sourceTier: 'direct',
    ...override,
  }
}

describe('computeFiur', () => {
  it('returns explainable breakdown with reasons for every component', () => {
    const result = computeFiur({
      company: baseCompany,
      vacancies: [vacancy()],
      clientProfile: baseProfile,
      evidence: [
        { tier: 'direct', source: 'career-page' },
        { tier: 'corroboration', source: 'hh' },
      ],
    })

    expect(result.fit).toBeGreaterThan(0)
    expect(result.intent).toBeGreaterThan(0)
    expect(result.urgency).toBeGreaterThanOrEqual(0)
    expect(result.reachability).toBeGreaterThan(0)
    expect(result.total).toBeCloseTo(
      result.fit + result.intent + result.urgency + result.reachability,
      5
    )
    expect(result.reasons.fit.length).toBeGreaterThan(0)
    expect(result.reasons.intent.length).toBeGreaterThan(0)
    expect(result.reasons.reachability.length).toBeGreaterThan(0)
  })

  it('clamps each component to [0, 1] and total to [0, 4]', () => {
    const result = computeFiur({
      company: { ...baseCompany, hasCareerPage: true, hasCorporateContactPath: true },
      vacancies: Array.from({ length: 50 }, (_, i) => vacancy({ id: `v-${i}` })),
      clientProfile: baseProfile,
      evidence: [
        { tier: 'direct', source: 'career-page' },
        { tier: 'direct', source: 'company-api' },
        { tier: 'corroboration', source: 'hh' },
        { tier: 'corroboration', source: 'linkedin' },
      ],
    })

    expect(result.fit).toBeLessThanOrEqual(1)
    expect(result.intent).toBeLessThanOrEqual(1)
    expect(result.urgency).toBeLessThanOrEqual(1)
    expect(result.reachability).toBeLessThanOrEqual(1)
    expect(result.total).toBeLessThanOrEqual(4)
  })

  it('penalises industry that does not match ICP', () => {
    const off = computeFiur({
      company: { ...baseCompany, industry: 'logistics' },
      vacancies: [vacancy()],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })
    const on = computeFiur({
      company: baseCompany,
      vacancies: [vacancy()],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })

    expect(off.fit).toBeLessThan(on.fit)
    expect(off.reasons.fit.some((r) => /industry/i.test(r))).toBe(true)
  })

  it('drops fit to zero when company industry is in exclusions', () => {
    const result = computeFiur({
      company: { ...baseCompany, industry: 'gambling' },
      vacancies: [vacancy()],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })

    expect(result.fit).toBe(0)
    expect(result.reasons.fit.some((r) => /exclud/i.test(r))).toBe(true)
  })

  it('penalises a non-ICP region', () => {
    const result = computeFiur({
      company: { ...baseCompany, location: 'Vladivostok' },
      vacancies: [vacancy({ location: 'Vladivostok' })],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })
    expect(result.reasons.fit.some((r) => /region|location/i.test(r))).toBe(true)
  })

  it('does not raise intent when the only vacancy is an internal recruiter', () => {
    const internalOnly = computeFiur({
      company: baseCompany,
      vacancies: [
        vacancy({ title: 'Internal Recruiter', role: 'recruiter', isInternalRecruiter: true }),
      ],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })
    const realRole = computeFiur({
      company: baseCompany,
      vacancies: [vacancy()],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })

    expect(internalOnly.intent).toBeLessThan(realRole.intent)
    expect(
      internalOnly.reasons.intent.some((r) =>
        /internal recruiter|internal_recruiter|internal/i.test(r)
      )
    ).toBe(true)
  })

  it('rewards hiring burst (multiple fresh vacancies)', () => {
    const burst = computeFiur({
      company: baseCompany,
      vacancies: [
        vacancy({ id: 'v-1' }),
        vacancy({ id: 'v-2', title: 'Backend Engineer 2' }),
        vacancy({ id: 'v-3', title: 'Backend Engineer 3' }),
        vacancy({ id: 'v-4', title: 'Backend Engineer 4' }),
      ],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })
    const single = computeFiur({
      company: baseCompany,
      vacancies: [vacancy()],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })

    expect(burst.urgency).toBeGreaterThan(single.urgency)
    expect(
      burst.reasons.urgency.some((r) => /burst|multiple|hiring/i.test(r))
    ).toBe(true)
  })

  it('decays intent for stale vacancies', () => {
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString() // 90 days ago
    const fresh = computeFiur({
      company: baseCompany,
      vacancies: [vacancy()],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })
    const stale = computeFiur({
      company: baseCompany,
      vacancies: [vacancy({ publishedAt: old })],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })

    expect(stale.intent).toBeLessThan(fresh.intent)
    expect(
      stale.reasons.intent.some((r) => /stale|fresh|days|old/i.test(r))
    ).toBe(true)
  })

  it('lowers reachability when company has no safe contact path', () => {
    const result = computeFiur({
      company: { ...baseCompany, hasCareerPage: false, hasCorporateContactPath: false },
      vacancies: [vacancy()],
      clientProfile: baseProfile,
      evidence: [{ tier: 'corroboration', source: 'hh' }],
    })

    expect(result.reachability).toBeLessThan(0.5)
  })

  it('does not throw on empty inputs', () => {
    const result = computeFiur({
      company: baseCompany,
      vacancies: [],
      clientProfile: baseProfile,
      evidence: [],
    })

    expect(result.intent).toBe(0)
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(4)
  })

  describe('SMB sweet-spot fit bonus (50–500 employees)', () => {
    const profileWithoutSizes: FiurInput['clientProfile'] = {
      industries: ['fintech'],
      roles: ['backend engineer'],
      locations: ['Moscow'],
    }

    it('rewards companies with 50–500 employees when ICP has no size preference', () => {
      const sweetSpot = computeFiur({
        company: { ...baseCompany, size: undefined, employeeCount: 200 },
        vacancies: [vacancy()],
        clientProfile: profileWithoutSizes,
        evidence: [{ tier: 'direct', source: 'career-page' }],
      })
      const tooSmall = computeFiur({
        company: { ...baseCompany, size: undefined, employeeCount: 10 },
        vacancies: [vacancy()],
        clientProfile: profileWithoutSizes,
        evidence: [{ tier: 'direct', source: 'career-page' }],
      })
      const tooLarge = computeFiur({
        company: { ...baseCompany, size: undefined, employeeCount: 5000 },
        vacancies: [vacancy()],
        clientProfile: profileWithoutSizes,
        evidence: [{ tier: 'direct', source: 'career-page' }],
      })

      expect(sweetSpot.fit).toBeGreaterThan(tooSmall.fit)
      expect(sweetSpot.fit).toBeGreaterThan(tooLarge.fit)
      expect(
        sweetSpot.reasons.fit.some((r) => /sweet spot|smb|50.?500|optimal/i.test(r))
      ).toBe(true)
    })

    it('falls back to categorical size when employeeCount is missing', () => {
      const small = computeFiur({
        company: { ...baseCompany, size: 'small', employeeCount: undefined },
        vacancies: [vacancy()],
        clientProfile: profileWithoutSizes,
        evidence: [{ tier: 'direct', source: 'career-page' }],
      })
      const enterprise = computeFiur({
        company: { ...baseCompany, size: 'enterprise', employeeCount: undefined },
        vacancies: [vacancy()],
        clientProfile: profileWithoutSizes,
        evidence: [{ tier: 'direct', source: 'career-page' }],
      })

      expect(small.fit).toBeGreaterThan(enterprise.fit)
      expect(
        small.reasons.fit.some((r) => /sweet spot|smb|50.?500|optimal/i.test(r))
      ).toBe(true)
    })

    it('does not double-count the bonus when ICP companySizes is specified', () => {
      const explicitProfile: FiurInput['clientProfile'] = {
        ...profileWithoutSizes,
        companySizes: ['medium'],
      }
      const explicit = computeFiur({
        company: { ...baseCompany, size: 'medium', employeeCount: 200 },
        vacancies: [vacancy()],
        clientProfile: explicitProfile,
        evidence: [{ tier: 'direct', source: 'career-page' }],
      })

      const sweetSpotReasons = explicit.reasons.fit.filter((r) =>
        /sweet spot|smb|50.?500|optimal/i.test(r)
      )
      expect(sweetSpotReasons.length).toBe(0)
    })
  })
})
