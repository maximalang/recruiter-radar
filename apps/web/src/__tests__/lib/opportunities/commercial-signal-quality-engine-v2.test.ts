import {
  buildCommercialSignalQualityEngineV2,
  type CommercialSignalQualityEngineV2Input,
} from '@/lib/opportunities/commercial-signal-quality-engine-v2'

const GROUP_A = 'a'.repeat(64)
const GROUP_B = 'b'.repeat(64)

function input(
  overrides: Partial<CommercialSignalQualityEngineV2Input> = {},
): CommercialSignalQualityEngineV2Input {
  return {
    decisionAt: '2026-08-08T10:00:00.000Z',
    decisionSource: 'deterministic',
    componentSources: {
      hiringNeed: 'direct',
      hiringFriction: 'derived_deterministic',
      agencyFit: 'derived_deterministic',
      propensity: 'derived_deterministic',
      convergence: 'derived_deterministic',
      economics: 'derived_deterministic',
      marketDifficulty: 'derived_deterministic',
    },
    currentHiringEvidence: { present: true, evidenceIds: ['101'] },
    hiringNeed: {
      value: 0.9,
      confidence: 0.9,
      coverage: 1,
      reasonCodes: ['HIRING_NEED_EVIDENCED'],
      evidenceIds: ['101'],
    },
    hiringFriction: {
      featureVersion: 'hiring-friction-v1',
      frictionLevel: 'high',
      frictionScore: 0.82,
      coverage: 0.9,
      positiveReasons: [{ code: 'PERSISTENT_DEMAND_COMBINATION', evidenceIds: ['102'] }],
      negativeReasons: [],
      evidenceIds: ['102'],
      componentValues: {},
    },
    agencyFit: {
      value: 0.88,
      confidence: 0.9,
      coverage: 1,
      reasonCodes: ['AGENCY_FIT_EVIDENCED'],
      evidenceIds: ['103'],
    },
    propensity: {
      featureVersion: 'external-agency-propensity-v2',
      propensityLevel: 'high',
      propensityScore: 0.86,
      confidence: 0.9,
      coverage: 0.9,
      actionability: 'eligible',
      reasonCodes: ['EXTERNAL_SUPPORT_PLAUSIBLE'],
      evidenceIds: ['104'],
      affirmativeEvidenceIds: ['104'],
      componentValues: {},
    },
    convergence: {
      featureVersion: 'signal-convergence-v1',
      convergenceScore: 0.85,
      coverage: 1,
      confidence: 0.9,
      independentGroupCount: 2,
      status: 'active',
      components: {
        coOccurrence: 1,
        sequence: 1,
        velocity: 0.8,
        recency: 0.9,
        contradiction: 0,
      },
      positiveReasons: ['INDEPENDENT_ORIGIN_CONVERGENCE'],
      negativeReasons: [],
      eventIds: ['201', '202'],
      evidenceIds: ['101', '102'],
      affirmativeEvidenceIds: ['101', '102'],
      excludedFutureEventIds: [],
    },
    economics: {
      featureVersion: 'commercial-fit-v2',
      economicsFit: 'unknown',
      componentValue: null,
      componentConfidence: 0,
      coverage: 0.3,
      reasons: ['ECONOMICS_SCOPE_UNKNOWN'],
      evidenceIds: [],
    },
    marketDifficulty: {
      marketDifficulty: 'unknown',
      componentValue: null,
      componentConfidence: 0,
      roleFamily: 'backend',
      seniority: 'senior',
      region: 'moscow',
      evidenceDate: null,
      source: null,
      evidenceIds: [],
    },
    negativeEvidence: {
      featureVersion: 'negative-evidence-v1',
      action: 'none',
      scoreMultiplier: 1,
      confirmedReasons: [],
      heuristicReasons: [],
      unknownReasons: [],
      evidenceIds: [],
      expiredEvidenceIds: [],
      excludedFutureEvidenceIds: [],
    },
    contact: {
      corporateContactPathAvailable: true,
      doNotContact: false,
      conflict: false,
      evidenceIds: ['105'],
    },
    evidence: [
      evidence('101', GROUP_A),
      evidence('102', GROUP_B),
      evidence('103', GROUP_A),
      evidence('104', GROUP_B),
      evidence('105', GROUP_A),
    ],
    ...overrides,
  }
}

function evidence(evidenceId: string, fingerprint: string) {
  return {
    evidenceId,
    sourceKind: 'direct' as const,
    sourceFamily: 'career-pages',
    sourceDomain: 'example.ru',
    upstreamOrigin: `origin:${evidenceId}`,
    canonicalUrl: `https://example.ru/${evidenceId}`,
    vacancyFingerprint: fingerprint,
    publicationFingerprint: `publication-${evidenceId}`,
    organizationDomain: 'example.ru',
    contentFingerprint: fingerprint,
    observedAt: '2026-08-08T09:00:00.000Z',
  }
}

describe('Commercial Signal Quality Engine v2 integration', () => {
  it('keeps a strong opportunity without a contact path in enrichment', () => {
    const result = buildCommercialSignalQualityEngineV2(input({
      contact: {
        corporateContactPathAvailable: false,
        doNotContact: false,
        conflict: false,
        evidenceIds: ['105'],
      },
    }))

    expect(result.quality.actionable).toBe(true)
    expect(result.status).toBe('qualified_needs_enrichment')
    expect(result.actionability).toBe('needs_enrichment')
    expect(result.reasonCodes).toContain('CORPORATE_CONTACT_PATH_MISSING')
  })

  it('blocks DNC and conflict after quality calculation', () => {
    for (const contact of [
      {
        corporateContactPathAvailable: true,
        doNotContact: true,
        conflict: false,
        evidenceIds: ['105'],
      },
      {
        corporateContactPathAvailable: true,
        doNotContact: false,
        conflict: true,
        evidenceIds: ['105'],
      },
    ]) {
      const result = buildCommercialSignalQualityEngineV2(input({ contact }))
      expect(result.quality.qualityScore).toBeGreaterThan(0.7)
      expect(result.status).toBe('blocked')
      expect(result.actionability).toBe('blocked')
    }
  })

  it('keeps context-only business events out of actionable supply', () => {
    const result = buildCommercialSignalQualityEngineV2(input({
      currentHiringEvidence: { present: false, evidenceIds: [] },
    }))

    expect(result.status).toBe('review')
    expect(result.quality.actionable).toBe(false)
    expect(result.reasonCodes).toContain('CURRENT_HIRING_EVIDENCE_MISSING')
  })

  it('keeps a high score in review without two known independent origins', () => {
    const result = buildCommercialSignalQualityEngineV2(input({
      evidence: ['101', '102', '103', '104', '105'].map((id) =>
        evidence(id, GROUP_A)),
    }))

    expect(result.quality.qualityScore).toBeGreaterThan(0.68)
    expect(result.quality.actionable).toBe(false)
    expect(result.status).toBe('review')
    expect(result.reasonCodes).toContain('QUALITY_INDEPENDENT_ORIGINS_LOW')
  })

  it('does not count contact or policy evidence toward positive independence', () => {
    const result = buildCommercialSignalQualityEngineV2(input({
      evidence: [
        evidence('101', GROUP_A), evidence('102', GROUP_A),
        evidence('103', GROUP_A), evidence('104', GROUP_A),
        evidence('105', GROUP_B),
      ],
    }))

    expect(result.independence.independentGroupCount).toBe(2)
    expect(result.actionabilityIndependence.independentGroupCount).toBe(1)
    expect(result.status).toBe('review')
  })

  it('keeps low market difficulty out of affirmative independence', () => {
    const result = buildCommercialSignalQualityEngineV2(input({
      marketDifficulty: {
        marketDifficulty: 'low',
        componentValue: 0.2,
        componentConfidence: 0.85,
        roleFamily: 'backend',
        seniority: 'senior',
        region: 'moscow',
        evidenceDate: '2026-08-08',
        source: 'official_salary_observation',
        evidenceIds: ['106'],
      },
      evidence: [...input().evidence, evidence('106', 'c'.repeat(64))],
    }))
    expect(result.decisionEvidence.positiveEvidenceIds).not.toContain('106')
    expect(result.decisionEvidence.negativeEvidenceIds).toContain('106')
  })

  it('rejects contact evidence reused as positive evidence', () => {
    expect(() => buildCommercialSignalQualityEngineV2(input({
      contact: {
        corporateContactPathAvailable: true,
        doNotContact: false,
        conflict: false,
        evidenceIds: ['104'],
      },
      evidence: input().evidence.filter((item) => item.evidenceId !== '105'),
    }))).toThrow(/positive and contact/i)
  })

  it('derives affirmative evidence from positive reasons and validates sources', () => {
    const withoutPositiveFriction = buildCommercialSignalQualityEngineV2(input({
      hiringFriction: {
        ...input().hiringFriction,
        positiveReasons: [],
        negativeReasons: [{ code: 'ONLY_NEGATIVE', evidenceIds: ['102'] }],
      },
      convergence: {
        ...input().convergence,
        affirmativeEvidenceIds: ['101'],
      },
    }))
    expect(withoutPositiveFriction.decisionEvidence.positiveEvidenceIds)
      .not.toContain('102')
    expect(withoutPositiveFriction.decisionEvidence.negativeEvidenceIds)
      .toContain('102')

    expect(() => buildCommercialSignalQualityEngineV2(input({
      componentSources: {
        ...input().componentSources,
        hiringNeed: 'official',
      },
    }))).toThrow(/declared source/i)
  })

  it('requires direct or official provenance for current hiring evidence', () => {
    expect(() => buildCommercialSignalQualityEngineV2(input({
      componentSources: {
        ...input().componentSources,
        hiringNeed: 'derived_deterministic',
      },
      evidence: [
        { ...evidence('101', GROUP_A), sourceKind: 'approved_context' },
        evidence('102', GROUP_B), evidence('103', GROUP_A),
        evidence('104', GROUP_B), evidence('105', GROUP_A),
      ],
    }))).toThrow(/current hiring evidence|declared source/i)
  })

  it('rejects unused or future evidence from exact decision lineage', () => {
    expect(() => buildCommercialSignalQualityEngineV2(input({
      evidence: [
        evidence('101', GROUP_A), evidence('102', GROUP_B),
        evidence('103', GROUP_A), evidence('104', GROUP_B),
        evidence('105', GROUP_A), evidence('106', GROUP_B),
      ],
    }))).toThrow(/exact evidence lineage/i)

    expect(() => buildCommercialSignalQualityEngineV2(input({
      evidence: [
        { ...evidence('101', GROUP_A), observedAt: '2026-08-09T09:00:00.000Z' },
        evidence('102', GROUP_B), evidence('103', GROUP_A),
        evidence('104', GROUP_B), evidence('105', GROUP_A),
      ],
    }))).toThrow(/future evidence/i)
  })

  it('preserves exact evidence and independence lineage across every layer', () => {
    const result = buildCommercialSignalQualityEngineV2(input())

    expect(result.evidenceIds).toEqual(['101', '102', '103', '104', '105'])
    expect(result.independence.groups).toHaveLength(2)
    expect(result.featureVersions).toMatchObject({
      quality: 'commercial-signal-quality-v2',
      friction: 'hiring-friction-v1',
      propensity: 'external-agency-propensity-v2',
      convergence: 'signal-convergence-v1',
      economics: 'commercial-fit-v2',
    })
  })

  it('rejects component evidence that is not in the exact provenance set', () => {
    expect(() => buildCommercialSignalQualityEngineV2(input({
      agencyFit: {
        value: 0.9,
        confidence: 0.9,
        coverage: 1,
        reasonCodes: ['AGENCY_FIT_EVIDENCED'],
        evidenceIds: ['999'],
      },
    }))).toThrow(/lineage/i)
  })

  it('does not allow LLM output to determine score or eligibility', () => {
    expect(() => buildCommercialSignalQualityEngineV2(input({
      decisionSource: 'llm',
    }))).toThrow(/LLM/i)
  })

  it('applies new negative evidence to a previously strong opportunity', () => {
    const result = buildCommercialSignalQualityEngineV2(input({
      negativeEvidence: {
        featureVersion: 'negative-evidence-v1',
        action: 'close',
        scoreMultiplier: 0,
        confirmedReasons: [{
          code: 'HIRING_FREEZE_CONFIRMED',
          type: 'hiring_freeze',
          severity: 1,
          eventIds: ['203'],
          evidenceIds: ['106'],
        }],
        heuristicReasons: [],
        unknownReasons: [],
        evidenceIds: ['106'],
        expiredEvidenceIds: [],
        excludedFutureEvidenceIds: [],
      },
      evidence: [...input().evidence, evidence('106', 'c'.repeat(64))],
    }))

    expect(result.quality.qualityScore).toBe(0)
    expect(result.status).toBe('expired')
    expect(result.reasonCodes).toContain('HIRING_FREEZE_CONFIRMED')
  })
})
