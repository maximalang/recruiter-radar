import {
  CORRELATION_RULES,
  SIGNAL_TAXONOMY,
  buildEvidenceRadarMetadata,
  calculateLeadScore,
  correlateSignals,
  decaySignalStrength,
  dedupeEvents,
  forecastStaffing,
  projectRussianCoordinates,
  resolveOrganization,
  type EvidenceEvent,
  type NormalizedSignal,
} from '@/lib/intelligence/evidence-radar'
import {
  SOURCE_REGISTRY,
  SOURCE_ROLES,
  canAutomateSource,
  validateSourceRegistry,
} from '@/lib/intelligence/source-registry'

describe('Evidence Radar v1 contracts', () => {
  it('covers every source role and fails closed for external automation', () => {
    expect(validateSourceRegistry()).toEqual([])
    expect(new Set(SOURCE_REGISTRY.map((entry) => entry.role))).toEqual(new Set(SOURCE_ROLES))
    expect(SOURCE_REGISTRY.filter(canAutomateSource).map((entry) => entry.id)).toEqual(['first-party-crm'])
  })

  it('defines the complete 20-type signal taxonomy', () => {
    expect(SIGNAL_TAXONOMY).toHaveLength(20)
    expect(new Set(SIGNAL_TAXONOMY.map((item) => item.type)).size).toBe(20)
    expect(SIGNAL_TAXONOMY.find((item) => item.type === 'hiring_freeze'))
      .toMatchObject({ polarity: 'negative' })
  })

  it('uses exact legal identifiers before ambiguous brand matches', () => {
    const candidates = [
      { organizationId: '1', legalName: 'ООО Ромашка', brand: 'Ромашка', inn: '7701234567', domains: ['romashka.ru'], confidence: 1 },
      { organizationId: '2', legalName: 'ООО Ромашка Плюс', brand: 'Ромашка', inn: '7701234568', domains: ['romashka.ru'], confidence: 1 },
    ]
    expect(resolveOrganization({ organizationId: 'source', inn: '7701234567' }, candidates))
      .toMatchObject({ status: 'resolved', organizationId: '1' })
    expect(resolveOrganization({ organizationId: 'source', brand: 'Ромашка', domains: ['romashka.ru'] }, candidates))
      .toMatchObject({ status: 'review' })
  })

  it('deduplicates copied publications and correlates independent evidence', () => {
    const event = evidenceEvent('e1', 'funding_or_investment', 'investments', 'same-hash')
    expect(dedupeEvents([event, { ...event, id: 'e2' }])).toHaveLength(1)

    const matches = correlateSignals([
      signal('funding', 'funding_received', 'investments'),
      signal('hiring', 'hiring_growth', 'career-page'),
    ])
    expect(matches).toEqual([
      expect.objectContaining({ ruleId: 'funding-hiring-recruiter' }),
    ])
    expect(CORRELATION_RULES.every((rule) => rule.minimumSourceFamilies >= 2)).toBe(true)
  })

  it('calculates a transparent multiplicative score minus risk', () => {
    const score = calculateLeadScore({
      hiringIntent: .9, confidence: .8, freshness: .75, urgency: .8,
      commercialFit: .85, contactability: .7, risk: .2,
      eventContributions: [{ eventId: 'e1', component: 'hiring_intent', delta: .2, reason: 'vacancy burst' }],
    })
    expect(score).toMatchObject({ confidenceScore: 80, urgencyScore: 80, contactabilityScore: 70, riskScore: 20 })
    expect(score.leadScore).toBeLessThan(score.opportunityScore)
    expect(score.contributions).toHaveLength(1)
  })

  it('decays stale evidence and forecasts bounded staffing demand', () => {
    expect(decaySignalStrength(1, '2026-07-01T00:00:00Z', 30, new Date('2026-07-31T00:00:00Z')))
      .toBeCloseTo(.5, 5)
    expect(forecastStaffing([signal('plant', 'production_expansion', 'official-news')]))
      .toMatchObject({ mode: 'mass', minHeadcount: 20, maxHeadcount: 200, basisSignalIds: ['plant'] })
  })

  it('renders geography only from verified Russian coordinates', () => {
    expect(projectRussianCoordinates(55.7558, 37.6173)).toEqual(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    )
    expect(() => projectRussianCoordinates(0, 0)).toThrow('outside supported Russian geography')
    expect(buildEvidenceRadarMetadata({
      location: { city: 'Рязань', federalSubjectCode: '62', federalSubjectName: 'Рязанская область', latitude: 54.6296, longitude: 39.7419, confidence: .95 },
      hiringIntent: .8, freshness: .9, risk: .1, independentSourceCount: 3,
      specialization: 'production',
    })).toMatchObject({ version: 'evidence-radar-v1', independentSourceCount: 3 })
  })
})

function evidenceEvent(id: string, eventType: string, sourceFamily: string, contentFingerprint: string): EvidenceEvent {
  return {
    id, organizationId: '1', eventType, sourceRegistryId: 'official-company-news', sourceFamily,
    occurredAt: '2026-08-01T00:00:00Z', detectedAt: '2026-08-01T01:00:00Z',
    canonicalUrl: 'https://example.invalid/event', facts: { eventType }, confidence: .9,
    independentConfirmations: 1, validUntil: '2026-10-01T00:00:00Z', polarity: 'positive',
    verificationStatus: 'verified', contentFingerprint,
  }
}

function signal(id: string, type: NormalizedSignal['type'], source: string): NormalizedSignal {
  return {
    id, organizationId: '1', type, startedAt: '2026-08-01T00:00:00Z',
    lastSeenAt: '2026-08-02T00:00:00Z', validUntil: '2026-10-01T00:00:00Z',
    confidence: .8, strength: .8, eventIds: [`${id}:event`], sourceFamilies: [source],
    affectedFunctions: ['engineering'],
  }
}
