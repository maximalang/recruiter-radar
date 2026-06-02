import { runScoringPipeline } from '@/lib/scoring/scoring-pipeline'
import type { ScoringPipelineInput } from '@/lib/scoring/scoring-pipeline'

const fixedNow = new Date('2026-05-26T12:00:00Z')

const baseInput: ScoringPipelineInput = {
  leadId: 'lead-acme-1',
  company: {
    id: 'co-acme',
    name: 'Acme Corp',
    website: 'https://acme.ru',
    industry: 'fintech',
    industries: ['fintech'],
    locations: ['Москва'],
    size: 'medium',
    hasCareerPage: true,
    hasCorporateContactPath: true,
  },
  vacancies: [
    {
      id: 'v1',
      title: 'Senior Backend Engineer',
      role: 'backend',
      location: 'Москва',
      publishedAt: '2026-05-26T09:00:00Z',
      salaryFrom: 250_000,
      salaryTo: 350_000,
      salaryCurrency: 'RUB',
      sourceTier: 'direct',
    },
    {
      id: 'v2',
      title: 'Product Manager',
      role: 'product',
      location: 'Москва',
      publishedAt: '2026-05-26T10:30:00Z',
      salaryFrom: 280_000,
      salaryTo: 380_000,
      salaryCurrency: 'RUB',
      sourceTier: 'direct',
    },
  ],
  evidence: [
    { source: 'career_page', tier: 'direct', fetchedAt: '2026-05-26T11:30:00Z' },
    { source: 'hh', tier: 'direct', fetchedAt: '2026-05-26T11:00:00Z' },
  ],
  contactPaths: [
    { category: 'hr-email', value: 'hr@acme.ru', confidence: 'high' },
    { category: 'careers-email', value: 'careers@acme.ru', confidence: 'high' },
    { category: 'phone', value: '+74951234567', confidence: 'medium' },
    { category: 'contact-form', value: 'https://acme.ru/contact', confidence: 'medium' },
  ],
  agencyProfile: {
    industries: ['fintech'],
    locations: ['Москва'],
    roles: ['backend', 'product'],
  },
  marketContext: {
    industryTrend: 'growing',
    growthSignals: ['funding-round', 'office-expansion'],
  },
  careerPageHtml: '<h2>Engineering</h2><h2>Sales</h2>',
  now: fixedNow,
}

describe('runScoringPipeline', () => {
  describe('contract', () => {
    it('returns lead and full breakdown', () => {
      const result = runScoringPipeline(baseInput)
      expect(result.lead).toBeDefined()
      expect(result.lead.id).toBe('lead-acme-1')
      expect(result.lead.company.id).toBe('co-acme')
      expect(result.breakdown).toBeDefined()
      expect(result.breakdown.fiur).toBeDefined()
      expect(result.breakdown.sourceAggregation).toBeDefined()
      expect(result.breakdown.freshness).toBeDefined()
      expect(result.breakdown.contactQuality).toBeDefined()
      expect(result.breakdown.industryAlignment).toBeDefined()
      expect(result.breakdown.geographicFit).toBeDefined()
      expect(result.breakdown.salaryAnalysis).toBeDefined()
      expect(result.breakdown.marketFit).toBeDefined()
      expect(result.breakdown.departments).toBeDefined()
    })

    it('uses injected clock for createdAt and freshness', () => {
      const result = runScoringPipeline(baseInput)
      expect(result.lead.createdAt.toISOString()).toBe('2026-05-26T12:00:00.000Z')
      expect(result.lead.updatedAt.toISOString()).toBe('2026-05-26T12:00:00.000Z')
      expect(result.breakdown.freshness.meetsSla).toBe(true)
    })
  })

  describe('strong signals → high confidence', () => {
    it('produces an A-lead-grade output for ICP-matching, fresh, multi-source, well-contacted company', () => {
      const result = runScoringPipeline(baseInput)
      expect(result.lead.confidence).toBe('A')
      expect(result.breakdown.fiur.total).toBeGreaterThan(2.0)
      expect(result.breakdown.industryAlignment.match).toBe('exact')
      expect(result.breakdown.geographicFit.match).toBe('city')
      expect(result.breakdown.contactQuality.tier).toBe('rich')
      expect(result.breakdown.sourceAggregation.hasMultiSourceConfirmation).toBe(true)
      expect(result.breakdown.freshness.status).toBe('fresh')
    })

    it('suggests outreach when channel is strong and signal is fresh', () => {
      const result = runScoringPipeline(baseInput)
      expect(result.lead.nextAction.kind).toBe('outreach')
    })

    it('extracts departments from career page HTML when provided', () => {
      const result = runScoringPipeline(baseInput)
      const names = result.breakdown.departments.map((d) => d.name)
      expect(names).toEqual(expect.arrayContaining(['engineering', 'sales']))
    })
  })

  describe('weak signals → low confidence and review', () => {
    it('downgrades a single-source, stale, no-contact lead', () => {
      const result = runScoringPipeline({
        ...baseInput,
        evidence: [{ source: 'news', tier: 'context', fetchedAt: '2025-01-01T00:00:00Z' }],
        contactPaths: [],
        vacancies: [],
        agencyProfile: { industries: ['edtech'], locations: ['Berlin'] },
        marketContext: { industryTrend: 'declining' },
      })
      expect(result.lead.confidence).toBe('D')
      expect(result.breakdown.freshness.status).toBe('expired')
      expect(result.breakdown.sourceAggregation.hasMultiSourceConfirmation).toBe(false)
      expect(result.lead.nextAction.kind === 'review' || result.lead.nextAction.kind === 'enrich-contacts').toBe(true)
    })
  })

  describe('excluded ICP', () => {
    it('returns industryAlignment.match=excluded and a low confidence lead', () => {
      const result = runScoringPipeline({
        ...baseInput,
        company: { ...baseInput.company, industries: ['gambling'] },
        agencyProfile: {
          industries: ['fintech'],
          locations: ['Москва'],
          excludedIndustries: ['gambling'],
        },
      })
      expect(result.breakdown.industryAlignment.match).toBe('excluded')
      expect(result.lead.confidence).toBe('D')
    })
  })

  describe('reasons aggregation', () => {
    it('includes signals from multiple helpers in lead.reasons', () => {
      const result = runScoringPipeline(baseInput)
      const joined = result.lead.reasons.join(' | ').toLowerCase()
      expect(joined.length).toBeGreaterThan(0)
      expect(joined).toContain('hr')
    })
  })

  describe('entityMatch quality', () => {
    it('questionable entityMatch forces gate C even with strong multi-source evidence', () => {
      // baseInput would normally produce gate A (2+ direct evidence, career page, etc.)
      const result = runScoringPipeline({ ...baseInput, entityMatch: 'questionable' })
      expect(result.lead.confidence).toBe('C')
    })

    it('clean entityMatch preserves normal gate computation', () => {
      const result = runScoringPipeline({ ...baseInput, entityMatch: 'clean' })
      expect(result.lead.confidence).toBe('A')
    })

    it('default (no entityMatch) is treated as clean', () => {
      const result = runScoringPipeline(baseInput)
      expect(result.lead.confidence).toBe('A')
    })
  })

  describe('optional inputs', () => {
    it('handles missing careerPageHtml by returning empty departments', () => {
      const { careerPageHtml: _omit, ...rest } = baseInput
      const result = runScoringPipeline(rest)
      expect(result.breakdown.departments).toEqual([])
    })

    it('handles missing marketContext gracefully', () => {
      const { marketContext: _omit, ...rest } = baseInput
      const result = runScoringPipeline(rest)
      expect(result.breakdown.marketFit.score).toBeGreaterThanOrEqual(0)
    })

    it('handles missing vacancies for salary analysis', () => {
      const result = runScoringPipeline({ ...baseInput, vacancies: [] })
      expect(result.breakdown.salaryAnalysis.tier).toBe('unknown')
    })
  })
})
