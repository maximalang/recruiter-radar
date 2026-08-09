import {
  buildEvidenceIndependence,
  buildOpportunityQuality,
  unknownQualityComponent,
  type CommercialSignalEvidenceProvenance,
} from '@/lib/opportunities/commercial-signal-quality-v2'

const OBSERVED_AT = '2026-08-08T09:00:00.000Z'

function evidence(
  overrides: Partial<CommercialSignalEvidenceProvenance> = {},
): CommercialSignalEvidenceProvenance {
  return {
    evidenceId: '101',
    sourceFamily: 'career-pages',
    sourceDomain: 'example.ru',
    upstreamOrigin: 'ats:example:vacancy-42',
    canonicalUrl: 'https://example.ru/careers/vacancy-42',
    vacancyFingerprint: 'vacancy-42',
    publicationFingerprint: 'publication-career-42',
    organizationDomain: 'example.ru',
    contentFingerprint: 'a'.repeat(64),
    observedAt: OBSERVED_AT,
    ...overrides,
  }
}

describe('Commercial Signal Quality Engine v2 contracts', () => {
  it('counts one upstream vacancy republished on three surfaces as one independent group', () => {
    const result = buildEvidenceIndependence([
      evidence(),
      evidence({
        evidenceId: '102',
        sourceFamily: 'job-boards',
        sourceDomain: 'hh.ru',
        canonicalUrl: 'https://hh.ru/vacancy/42',
        publicationFingerprint: 'publication-hh-42',
      }),
      evidence({
        evidenceId: '103',
        sourceFamily: 'aggregators',
        sourceDomain: 'jobs.example',
        canonicalUrl: 'https://jobs.example/vacancy/42',
        publicationFingerprint: 'publication-aggregator-42',
      }),
    ], new Date('2026-08-09T00:00:00.000Z'))

    expect(result.independentGroupCount).toBe(1)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.evidenceIds).toEqual(['101', '102', '103'])
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'EVIDENCE_REPUBLICATION',
      'EVIDENCE_SAME_UPSTREAM',
    ]))
  })

  it('counts genuinely distinct direct origins independently', () => {
    const result = buildEvidenceIndependence([
      evidence(),
      evidence({
        evidenceId: '102',
        sourceFamily: 'official-newsroom',
        sourceDomain: 'example.ru',
        upstreamOrigin: 'newsroom:example:new-unit-7',
        canonicalUrl: 'https://example.ru/news/new-unit-7',
        vacancyFingerprint: null,
        publicationFingerprint: 'publication-news-7',
        contentFingerprint: 'b'.repeat(64),
      }),
    ], new Date('2026-08-09T00:00:00.000Z'))

    expect(result.independentGroupCount).toBe(2)
    expect(result.coverage).toBe(1)
    expect(result.confidence).toBe(1)
    expect(result.reasonCodes).toContain('EVIDENCE_INDEPENDENT')
  })

  it('represents unknown commercial data as null with zero confidence', () => {
    expect(unknownQualityComponent('ECONOMICS_FIT_UNKNOWN')).toEqual({
      value: null,
      confidence: 0,
      coverage: 0,
      reasonCodes: ['ECONOMICS_FIT_UNKNOWN'],
      evidenceIds: [],
    })
  })

  it('does not make a high known score actionable when critical coverage is low', () => {
    const result = buildOpportunityQuality({
      components: [
        {
          key: 'hiring_need',
          critical: true,
          weight: 1,
          component: {
            value: 0.95,
            confidence: 0.95,
            coverage: 1,
            reasonCodes: ['HIRING_NEED_EVIDENCED'],
            evidenceIds: ['101'],
          },
        },
        {
          key: 'hiring_friction',
          critical: true,
          weight: 1,
          component: unknownQualityComponent('HIRING_FRICTION_UNKNOWN'),
        },
        {
          key: 'economics_fit',
          critical: false,
          weight: 0.5,
          component: unknownQualityComponent('ECONOMICS_FIT_UNKNOWN'),
        },
      ],
      minimumCriticalCoverage: 1,
      minimumQualityCoverage: 0.7,
    })

    expect(result.qualityScore).toBe(0)
    expect(result.qualityCoverage).toBe(0.4)
    expect(result.qualityConfidence).toBeLessThan(0.4)
    expect(result.actionable).toBe(false)
    expect(result.reasonCodes).toContain('QUALITY_CRITICAL_COVERAGE_LOW')
  })

  it('does not let unknown critical values satisfy coverage', () => {
    const result = buildOpportunityQuality({
      components: [{
        key: 'hiring_need',
        critical: true,
        weight: 1,
        component: {
          value: null,
          confidence: 0,
          coverage: 1,
          reasonCodes: ['HIRING_NEED_UNKNOWN'],
          evidenceIds: ['101'],
        },
      }, {
        key: 'agency_fit',
        critical: true,
        weight: 1,
        component: {
          value: 0.95,
          confidence: 0.95,
          coverage: 1,
          reasonCodes: ['AGENCY_FIT_EVIDENCED'],
          evidenceIds: ['102'],
        },
      }],
      minimumCriticalCoverage: 1,
      minimumQualityCoverage: 0.5,
    })

    expect(result.criticalCoverage).toBe(0.5)
    expect(result.actionable).toBe(false)
    expect(result.qualityScore).toBe(0)
  })

  it('does not count unknown-origin groups as independent evidence', () => {
    const result = buildEvidenceIndependence([
      evidence({
        upstreamOrigin: null,
        canonicalUrl: null,
        vacancyFingerprint: null,
        publicationFingerprint: null,
        contentFingerprint: null,
      }),
      evidence({
        evidenceId: '102',
        sourceFamily: 'job-boards',
        sourceDomain: 'hh.ru',
        upstreamOrigin: null,
        canonicalUrl: null,
        vacancyFingerprint: null,
        publicationFingerprint: null,
        contentFingerprint: null,
      }),
    ], new Date('2026-08-09T00:00:00.000Z'))

    expect(result.groups).toHaveLength(2)
    expect(result.independentGroupCount).toBe(0)
    expect(result.reasonCodes).not.toContain('EVIDENCE_INDEPENDENT')
  })

  it('excludes evidence observed after the decision clock', () => {
    const result = buildEvidenceIndependence([
      evidence(),
      evidence({
        evidenceId: '102',
        observedAt: '2026-08-10T00:00:00.000Z',
      }),
    ], new Date('2026-08-09T00:00:00.000Z'))

    expect(result.groups.flatMap((group) => group.evidenceIds)).toEqual(['101'])
    expect(result.excludedFutureEvidenceIds).toEqual(['102'])
  })

  it('does not let a missing non-critical component destroy strong covered quality', () => {
    const result = buildOpportunityQuality({
      components: [
        {
          key: 'hiring_need',
          critical: true,
          weight: 1,
          component: {
            value: 0.9,
            confidence: 0.9,
            coverage: 1,
            reasonCodes: ['HIRING_NEED_EVIDENCED'],
            evidenceIds: ['101'],
          },
        },
        {
          key: 'hiring_friction',
          critical: true,
          weight: 1,
          component: {
            value: 0.8,
            confidence: 0.85,
            coverage: 1,
            reasonCodes: ['HIRING_FRICTION_EVIDENCED'],
            evidenceIds: ['102'],
          },
        },
        {
          key: 'economics_fit',
          critical: false,
          weight: 0.25,
          component: unknownQualityComponent('ECONOMICS_FIT_UNKNOWN'),
        },
      ],
      minimumCriticalCoverage: 1,
      minimumQualityCoverage: 0.75,
    })

    expect(result.qualityScore).toBeGreaterThan(0.8)
    expect(result.qualityCoverage).toBeCloseTo(0.88889, 5)
    expect(result.actionable).toBe(true)
    expect(result.reasonCodes).toContain('QUALITY_NONCRITICAL_DATA_MISSING')
  })
})
