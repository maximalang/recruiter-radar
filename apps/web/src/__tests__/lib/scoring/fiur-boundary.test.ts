/**
 * FIUR boundary & invariant tests.
 *
 * Verifies the additive contract: Total = Fit + Intent + Urgency + Reachability,
 * each component ∈ [0, 1], total ∈ [0, 4]. Tests degenerate and extreme inputs.
 */
import {
  computeFiur,
  type FiurInput,
} from '@/lib/scoring/fiur'

const baseProfile: FiurInput['clientProfile'] = {
  industries: ['fintech'],
  roles: ['backend engineer'],
  locations: ['Moscow'],
  companySizes: ['medium'],
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

function vacancy(override: Partial<NonNullable<FiurInput['vacancies']>[number]> = {}) {
  return {
    id: 'v-1',
    title: 'Senior Backend Engineer',
    role: 'backend engineer',
    location: 'Moscow',
    publishedAt: new Date().toISOString(),
    isInternalRecruiter: false,
    isHardToFill: false,
    sourceTier: 'direct' as const,
    ...override,
  }
}

describe('FIUR boundary & invariant tests', () => {
  describe('additive invariant: total = fit + intent + urgency + reachability', () => {
    it('holds for a well-matched company with fresh vacancies', () => {
      const result = computeFiur({
        company: baseCompany,
        vacancies: [vacancy()],
        clientProfile: baseProfile,
        evidence: [
          { tier: 'direct', source: 'career-page' },
          { tier: 'corroboration', source: 'hh' },
        ],
      })

      expect(result.total).toBeCloseTo(
        result.fit + result.intent + result.urgency + result.reachability,
        10,
      )
    })

    it('holds for empty evidence and no vacancies', () => {
      const result = computeFiur({
        company: { id: 'co-x', name: 'NoInfo Corp' },
        vacancies: [],
        clientProfile: baseProfile,
        evidence: [],
      })

      expect(result.total).toBeCloseTo(
        result.fit + result.intent + result.urgency + result.reachability,
        10,
      )
    })

    it('holds for excluded company', () => {
      const result = computeFiur({
        company: { id: 'co-ex', name: 'Gambling Inc', industry: 'gambling' },
        vacancies: [vacancy()],
        clientProfile: { ...baseProfile, exclusions: ['gambling'] },
        evidence: [{ tier: 'direct', source: 'career-page' }],
      })

      expect(result.fit).toBe(0)
      expect(result.total).toBeCloseTo(
        result.fit + result.intent + result.urgency + result.reachability,
        10,
      )
    })

    it('holds for internal-recruiter-only vacancies', () => {
      const result = computeFiur({
        company: baseCompany,
        vacancies: [vacancy({ isInternalRecruiter: true })],
        clientProfile: baseProfile,
        evidence: [{ tier: 'corroboration', source: 'hh' }],
      })

      expect(result.total).toBeCloseTo(
        result.fit + result.intent + result.urgency + result.reachability,
        10,
      )
    })

    it('holds with market conditions', () => {
      const result = computeFiur({
        company: baseCompany,
        vacancies: [vacancy()],
        clientProfile: baseProfile,
        evidence: [{ tier: 'direct', source: 'career-page' }],
        marketConditions: 'boom',
      })

      expect(result.total).toBeCloseTo(
        result.fit + result.intent + result.urgency + result.reachability,
        10,
      )
    })

    it('holds with recent signal count', () => {
      const result = computeFiur({
        company: baseCompany,
        vacancies: [vacancy()],
        clientProfile: baseProfile,
        evidence: [{ tier: 'direct', source: 'career-page' }],
        recentSignalCount: 5,
      })

      expect(result.total).toBeCloseTo(
        result.fit + result.intent + result.urgency + result.reachability,
        10,
      )
    })
  })

  describe('component bounds: each ∈ [0, 1]', () => {
    it('all components in [0, 1] for maximum-score company', () => {
      const result = computeFiur({
        company: {
          ...baseCompany,
          hasCareerPage: true,
          hasCorporateContactPath: true,
          employeeCount: 200,
        },
        vacancies: [
          vacancy(),
          vacancy({ id: 'v-2', role: 'ml engineer', isHardToFill: true }),
          vacancy({ id: 'v-3', role: 'product manager' }),
        ],
        clientProfile: {
          ...baseProfile,
          roles: ['backend engineer', 'ml engineer', 'product manager'],
          companySizes: ['medium'],
        },
        evidence: [
          { tier: 'direct', source: 'career-page' },
          { tier: 'corroboration', source: 'hh' },
          { tier: 'corroboration', source: 'superjob' },
        ],
        marketConditions: 'boom',
        recentSignalCount: 5,
      })

      expect(result.fit).toBeGreaterThanOrEqual(0)
      expect(result.fit).toBeLessThanOrEqual(1)
      expect(result.intent).toBeGreaterThanOrEqual(0)
      expect(result.intent).toBeLessThanOrEqual(1)
      expect(result.urgency).toBeGreaterThanOrEqual(0)
      expect(result.urgency).toBeLessThanOrEqual(1)
      expect(result.reachability).toBeGreaterThanOrEqual(0)
      expect(result.reachability).toBeLessThanOrEqual(1)
    })

    it('all components in [0, 1] for zero-score company', () => {
      const result = computeFiur({
        company: { id: 'co-0', name: 'Unknown Corp' },
        vacancies: [],
        clientProfile: baseProfile,
        evidence: [],
      })

      expect(result.fit).toBeGreaterThanOrEqual(0)
      expect(result.fit).toBeLessThanOrEqual(1)
      expect(result.intent).toBeGreaterThanOrEqual(0)
      expect(result.intent).toBeLessThanOrEqual(1)
      expect(result.urgency).toBeGreaterThanOrEqual(0)
      expect(result.urgency).toBeLessThanOrEqual(1)
      expect(result.reachability).toBeGreaterThanOrEqual(0)
      expect(result.reachability).toBeLessThanOrEqual(1)
    })
  })

  describe('total bounds: total ∈ [0, 4]', () => {
    it('total is 0 when there are no signals at all', () => {
      const result = computeFiur({
        company: { id: 'co-0', name: 'Blank' },
        vacancies: [],
        clientProfile: { industries: ['fintech'], roles: [], locations: [] },
        evidence: [],
      })

      // No industry match, no vacancies, no career page → fit=0, intent=0, urgency=0, reachability=0
      expect(result.total).toBe(0)
    })

    it('total never exceeds 4.0 even with all boosts', () => {
      const result = computeFiur({
        company: {
          ...baseCompany,
          hasCareerPage: true,
          hasCorporateContactPath: true,
          employeeCount: 300,
        },
        vacancies: [
          vacancy(),
          vacancy({ id: 'v-2', role: 'ml engineer', isHardToFill: true }),
          vacancy({ id: 'v-3', role: 'product manager', isHardToFill: true }),
        ],
        clientProfile: {
          ...baseProfile,
          roles: ['backend engineer', 'ml engineer', 'product manager'],
        },
        evidence: [
          { tier: 'direct', source: 'career-page' },
          { tier: 'direct', source: 'company-profile' },
          { tier: 'corroboration', source: 'hh' },
          { tier: 'corroboration', source: 'superjob' },
          { tier: 'corroboration', source: 'habr-career' },
        ],
        marketConditions: 'boom',
        recentSignalCount: 10,
      })

      expect(result.total).toBeLessThanOrEqual(4.0)
    })
  })

  describe('clamp01 with min parameter', () => {
    it('industry penalty is clamped to min 0.3 (industry never fully zeroed)', () => {
      const result = computeFiur({
        company: { ...baseCompany, industry: 'fintech' },
        vacancies: [vacancy()],
        clientProfile: baseProfile,
        evidence: [{ tier: 'direct', source: 'career-page' }],
        clientOverrides: {
          industryFitPenalty: { 'fintech': 0.0 }, // try to zero it out
        },
      })

      // Even with penalty=0.0, the industry contribution should not be zeroed
      // because clamp01(penalty, 0.3) => 0.3, and score = 0.35 * 0.3 = 0.105
      expect(result.fit).toBeGreaterThan(0)
      expect(result.fit).toBeLessThanOrEqual(1)
      // Should mention reweighted
      expect(result.reasons.fit.some(r => r.key === 'fit.industry.match.reweighted')).toBe(true)
    })
  })

  describe('reasons coverage', () => {
    it('every non-zero component has at least one reason', () => {
      const result = computeFiur({
        company: baseCompany,
        vacancies: [vacancy()],
        clientProfile: baseProfile,
        evidence: [{ tier: 'direct', source: 'career-page' }],
      })

      if (result.fit > 0) expect(result.reasons.fit.length).toBeGreaterThan(0)
      if (result.intent > 0) expect(result.reasons.intent.length).toBeGreaterThan(0)
      if (result.urgency > 0) expect(result.reasons.urgency.length).toBeGreaterThan(0)
      if (result.reachability > 0) expect(result.reasons.reachability.length).toBeGreaterThan(0)
    })

    it('zero urgency when no vacancies', () => {
      const result = computeFiur({
        company: baseCompany,
        vacancies: [],
        clientProfile: baseProfile,
        evidence: [],
      })

      expect(result.urgency).toBe(0)
      expect(result.reasons.urgency.some(r => r.key === 'urgency.no-vacancies')).toBe(true)
    })

    it('zero intent when no vacancies', () => {
      const result = computeFiur({
        company: baseCompany,
        vacancies: [],
        clientProfile: baseProfile,
        evidence: [],
      })

      expect(result.intent).toBe(0)
      expect(result.reasons.intent.some(r => r.key === 'intent.no-vacancies')).toBe(true)
    })
  })
})
