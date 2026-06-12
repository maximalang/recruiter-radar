import { computeFiur, type FiurInput } from '@/lib/scoring/fiur'

const baseProfile: FiurInput['clientProfile'] = {
  industries: ['fintech'],
  roles: ['backend engineer'],
  locations: ['Moscow'],
}

const baseCompany: FiurInput['company'] = {
  id: 'co-1',
  name: 'Test Company',
  industry: 'fintech',
  location: 'Moscow',
  hasCareerPage: true,
  hasCorporateContactPath: true,
}

const baseVacancy = {
  id: 'v-1',
  title: 'Backend Engineer',
  role: 'backend engineer',
  location: 'Moscow',
  publishedAt: new Date().toISOString(),
  isInternalRecruiter: false,
  isHardToFill: false,
  sourceTier: 'direct' as const,
}

describe('computeFiur with reweighting', () => {
  it('lowers fit score when 3+ badfits recorded for matching industry', () => {
    const normalResult = computeFiur({
      company: baseCompany,
      vacancies: [baseVacancy],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })

    const reweightedResult = computeFiur({
      company: baseCompany,
      vacancies: [baseVacancy],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
      clientOverrides: {
        industryFitPenalty: { 'fintech': 0.5 }, // 50% penalty for fintech
      },
    })

    // With 50% penalty on industry (base score ~0.35), fit should be reduced
    expect(reweightedResult.fit).toBeLessThan(normalResult.fit)
    expect(reweightedResult.reasons.fit.some(r => r.key === 'fit.industry.match.reweighted')).toBe(true)
  })

  it('clamps fit penalty to minimum 0.3 multiplier — industry component drops below 0.35', () => {
    // The industry penalty is clamped to min 0.3, so industry contribution = 0.35 * 0.3 = 0.105
    const result = computeFiur({
      company: baseCompany,
      vacancies: [baseVacancy],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
      clientOverrides: {
        industryFitPenalty: { 'fintech': 0.01 }, // extreme penalty, gets clamped to 0.3
      },
    })

    // Industry contribution clamped to 0.3: 0.35 * 0.3 = 0.105
    // Total fit: 0.105 (industry) + 0.3 (role) + 0.2 (location) = 0.605
    expect(result.fit).toBeGreaterThan(0.6)
    expect(result.fit).toBeLessThan(0.65)
  })

  it('does not affect fit when company industry has no penalty', () => {
    const normalResult = computeFiur({
      company: baseCompany,
      vacancies: [baseVacancy],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
    })

    const reweightedResult = computeFiur({
      company: baseCompany,
      vacancies: [baseVacancy],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
      clientOverrides: {
        industryFitPenalty: { 'logistics': 0.5 }, // Different industry
      },
    })

    expect(reweightedResult.fit).toBe(normalResult.fit)
  })

  it('reasons include reweight explanation', () => {
    const result = computeFiur({
      company: baseCompany,
      vacancies: [baseVacancy],
      clientProfile: baseProfile,
      evidence: [{ tier: 'direct', source: 'career-page' }],
      clientOverrides: {
        industryFitPenalty: { 'fintech': 0.5 },
      },
    })

    const hasPenaltyReason = result.reasons.fit.some(r =>
      r.key === 'fit.industry.match.reweighted'
    )
    expect(hasPenaltyReason).toBe(true)
  })
})
