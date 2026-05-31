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
  evidence: [
    { tier: 'direct', source: 'career_page' },
    { tier: 'direct', source: 'hh' },
  ],
  entityMatch: 'clean',
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

    it('maps strong signals (2+ direct evidence + clean entity) to confidence "A"', () => {
      const lead = buildAgencyLead(baseInput)
      expect(lead.confidence).toBe('A')
    })

    it('maps no evidence to confidence "D"', () => {
      const lead = buildAgencyLead({
        ...baseInput,
        evidence: [],
        entityMatch: 'clean',
      })
      expect(lead.confidence).toBe('D')
    })

    it('maps single direct source with clean entity to confidence "B"', () => {
      const lead = buildAgencyLead({
        ...baseInput,
        evidence: [{ tier: 'direct', source: 'hh' }],
        entityMatch: 'clean',
      })
      expect(lead.confidence).toBe('B')
    })

    it('maps questionable entity match to confidence "C"', () => {
      const lead = buildAgencyLead({
        ...baseInput,
        evidence: [{ tier: 'direct', source: 'hh' }],
        entityMatch: 'questionable',
      })
      expect(lead.confidence).toBe('C')
    })

    it('maps corroboration-only evidence to confidence "C"', () => {
      const lead = buildAgencyLead({
        ...baseInput,
        evidence: [{ tier: 'corroboration', source: 'news' }],
        entityMatch: 'clean',
      })
      expect(lead.confidence).toBe('C')
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
