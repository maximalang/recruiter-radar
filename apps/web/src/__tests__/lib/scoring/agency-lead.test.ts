import {
  buildAgencyLead,
} from '@/lib/scoring/agency-lead'
import type {
  AgencyLeadInput,
} from '@/lib/scoring/agency-lead'

const baseInput: AgencyLeadInput = {
  id: 'lead-1',
  company: {
    id: 'co-1',
    name: 'Acme Corp',
    website: 'https://acme.ru',
  },
  fiur: {
    fit: 0.8,
    intent: 0.7,
    urgency: 0.5,
    reachability: 0.6,
    total: 2.6,
    reasons: ['exact ICP match', 'fresh hiring burst'],
  },
  sourceAggregation: {
    weight: 0.85,
    independentSources: 2,
    hasMultiSourceConfirmation: true,
    breakdown: [
      { source: 'career_page', weight: 0.45, itemCount: 2, topTier: 'direct' },
      { source: 'hh', weight: 0.35, itemCount: 5, topTier: 'direct' },
    ],
  },
  freshness: {
    newestAgeHours: 1.2,
    oldestAgeHours: 24,
    status: 'fresh',
    meetsSla: true,
  },
  contactQuality: {
    score: 0.85,
    tier: 'rich',
    diversity: 4,
    hasHrChannel: true,
    reasons: ['HR or careers contact path available', '4 independent channel categories'],
  },
  now: new Date('2026-05-26T12:00:00Z'),
}

describe('buildAgencyLead', () => {
  describe('contract', () => {
    it('returns an AgencyLead with the input id and company', () => {
      const lead = buildAgencyLead(baseInput)
      expect(lead.id).toBe('lead-1')
      expect(lead.company.id).toBe('co-1')
      expect(lead.company.name).toBe('Acme Corp')
    })

    it('starts in status "new" by default', () => {
      const lead = buildAgencyLead(baseInput)
      expect(lead.status).toBe('new')
    })

    it('preserves an explicit status when provided', () => {
      const lead = buildAgencyLead({ ...baseInput, status: 'contacted' })
      expect(lead.status).toBe('contacted')
    })

    it('exposes createdAt and updatedAt set to the injected clock', () => {
      const lead = buildAgencyLead(baseInput)
      expect(lead.createdAt.toISOString()).toBe('2026-05-26T12:00:00.000Z')
      expect(lead.updatedAt.toISOString()).toBe('2026-05-26T12:00:00.000Z')
    })
  })

  describe('score and confidence', () => {
    it('uses the FIUR total score', () => {
      const lead = buildAgencyLead(baseInput)
      expect(lead.score).toBe(2.6)
    })

    it('maps strong signals (fresh + multi-source + good contact + high FIUR) to confidence "high"', () => {
      const lead = buildAgencyLead(baseInput)
      expect(lead.confidence).toBe('high')
    })

    it('maps single-source stale data to confidence "low"', () => {
      const lead = buildAgencyLead({
        ...baseInput,
        sourceAggregation: {
          ...baseInput.sourceAggregation,
          independentSources: 1,
          hasMultiSourceConfirmation: false,
        },
        freshness: {
          newestAgeHours: 200,
          oldestAgeHours: 200,
          status: 'stale',
          meetsSla: false,
        },
        fiur: { ...baseInput.fiur, total: 1.2 },
      })
      expect(lead.confidence).toBe('low')
    })

    it('maps moderate signals to confidence "medium"', () => {
      const lead = buildAgencyLead({
        ...baseInput,
        sourceAggregation: {
          ...baseInput.sourceAggregation,
          independentSources: 1,
          hasMultiSourceConfirmation: false,
        },
        freshness: {
          newestAgeHours: 12,
          oldestAgeHours: 30,
          status: 'aging',
          meetsSla: false,
        },
        fiur: { ...baseInput.fiur, total: 2.0 },
      })
      expect(lead.confidence).toBe('medium')
    })
  })

  describe('next action', () => {
    it('suggests "outreach" when contact quality is rich and lead is fresh', () => {
      const lead = buildAgencyLead(baseInput)
      expect(lead.nextAction.kind).toBe('outreach')
    })

    it('suggests "enrich-contacts" when no HR channel is available', () => {
      const lead = buildAgencyLead({
        ...baseInput,
        contactQuality: {
          ...baseInput.contactQuality,
          hasHrChannel: false,
          tier: 'weak',
          score: 0.2,
          diversity: 1,
        },
      })
      expect(lead.nextAction.kind).toBe('enrich-contacts')
    })

    it('suggests "review" when freshness is stale or expired', () => {
      const lead = buildAgencyLead({
        ...baseInput,
        freshness: {
          newestAgeHours: 200,
          oldestAgeHours: 200,
          status: 'stale',
          meetsSla: false,
        },
      })
      expect(lead.nextAction.kind).toBe('review')
    })
  })

  describe('sources', () => {
    it('flattens the source aggregation breakdown into HiringSource entries', () => {
      const lead = buildAgencyLead(baseInput)
      const names = lead.sources.map((s) => s.source)
      expect(names).toEqual(expect.arrayContaining(['career_page', 'hh']))
      const career = lead.sources.find((s) => s.source === 'career_page')
      expect(career?.itemCount).toBe(2)
      expect(career?.topTier).toBe('direct')
    })
  })

  describe('reasons', () => {
    it('aggregates reasons from FIUR and contact quality', () => {
      const lead = buildAgencyLead(baseInput)
      const joined = lead.reasons.join(' | ').toLowerCase()
      expect(joined).toContain('icp')
      expect(joined).toContain('hr')
    })
  })
})
