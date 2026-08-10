import {
  buildCaseSimilarity,
  buildEconomicsFit,
  buildMarketDifficulty,
  type CaseSimilarityInput,
  type EconomicsFitInput,
} from '@/lib/opportunities/commercial-fit-v2'

function economics(
  overrides: Partial<EconomicsFitInput> = {},
): EconomicsFitInput {
  return {
    expectedRoleCount: { value: 3, evidenceIds: ['101'] },
    roleSeniority: { value: 'senior', evidenceIds: ['101'] },
    serviceType: { value: 'permanent', evidenceIds: ['101'] },
    companySize: { value: 'medium', evidenceIds: ['102'] },
    agencyMinimumFeeMinor: 300_000_00,
    agencyTypicalFeeMinor: 500_000_00,
    engagementType: { value: 'exclusive', evidenceIds: ['103'] },
    estimatedScopeMinor: { value: null, evidenceIds: [] },
    caseSimilarity: null,
    ...overrides,
  }
}

function caseInput(
  overrides: Partial<CaseSimilarityInput> = {},
): CaseSimilarityInput {
  return {
    opportunity: {
      roleFamily: 'backend',
      specialization: 'golang',
      seniority: 'senior',
      industry: 'fintech',
      companySize: 'medium',
      region: 'moscow',
      serviceType: 'permanent',
      hiringArchetype: 'hard_to_fill',
    },
    cases: [{
      caseId: '501',
      roleFamily: 'backend',
      specialization: 'golang',
      seniority: 'senior',
      industry: 'fintech',
      companySize: 'medium',
      region: 'moscow',
      serviceType: 'permanent',
      hiringArchetype: 'hard_to_fill',
    }],
    ...overrides,
  }
}

describe('Commercial Fit v2', () => {
  it('keeps unknown economics null with zero confidence instead of a positive score', () => {
    const result = buildEconomicsFit(economics())

    expect(result.economicsFit).toBe('unknown')
    expect(result.componentValue).toBeNull()
    expect(result.componentConfidence).toBe(0)
    expect(result.coverage).toBeLessThan(1)
    expect(result).not.toHaveProperty('dealValue')
    expect(result).not.toHaveProperty('revenue')
  })

  it('returns mismatch when evidenced scope is below the agency minimum', () => {
    const result = buildEconomicsFit(economics({
      estimatedScopeMinor: { value: 200_000_00, evidenceIds: ['104'] },
    }))

    expect(result.economicsFit).toBe('mismatch')
    expect(result.componentValue).toBe(0)
    expect(result.reasons).toContain('ESTIMATED_SCOPE_BELOW_AGENCY_MINIMUM')
    expect(result.evidenceIds).toContain('104')
  })

  it('returns match only when evidenced scope and service context align', () => {
    const result = buildEconomicsFit(economics({
      estimatedScopeMinor: { value: 600_000_00, evidenceIds: ['104'] },
      caseSimilarity: 0.9,
    }))

    expect(result.economicsFit).toBe('match')
    expect(result.componentValue).toBeGreaterThanOrEqual(0.8)
    expect(result.componentConfidence).toBeGreaterThan(0.7)
  })

  it('computes deterministic case similarity across explicit dimensions', () => {
    const result = buildCaseSimilarity(caseInput())

    expect(result).toEqual({
      bestCaseId: '501',
      similarity: 1,
      matchedDimensions: [
        'company_size',
        'hiring_archetype',
        'industry',
        'region',
        'role_family',
        'seniority',
        'service_type',
        'specialization',
      ],
      missingDimensions: [],
    })
  })

  it('reports missing dimensions instead of treating them as matches', () => {
    const result = buildCaseSimilarity(caseInput({
      cases: [{
        ...caseInput().cases[0]!,
        caseId: '502',
        region: null,
        hiringArchetype: null,
      }],
    }))

    expect(result.bestCaseId).toBe('502')
    expect(result.similarity).toBeLessThan(1)
    expect(result.missingDimensions).toEqual([
      'hiring_archetype',
      'region',
    ])
  })

  it('returns unknown market difficulty when approved data is absent', () => {
    expect(buildMarketDifficulty({
      decisionDate: '2026-08-09',
      roleFamily: 'backend',
      seniority: 'senior',
      region: 'moscow',
      observation: null,
    })).toMatchObject({
      marketDifficulty: 'unknown',
      componentValue: null,
      componentConfidence: 0,
    })
  })

  it('rejects LLM and non-reproducible market difficulty sources', () => {
    expect(() => buildMarketDifficulty({
      decisionDate: '2026-08-09',
      roleFamily: 'backend',
      seniority: 'senior',
      region: 'moscow',
      observation: {
        level: 'high',
        evidenceDate: '2026-08-01',
        source: 'llm',
        approved: true,
        reproducible: true,
        evidenceIds: ['101'],
      },
    })).toThrow(/LLM/i)
    expect(() => buildMarketDifficulty({
      decisionDate: '2026-08-09',
      roleFamily: 'backend',
      seniority: 'senior',
      region: 'moscow',
      observation: {
        level: 'high',
        evidenceDate: '2026-08-01',
        source: 'official-labor-data',
        approved: true,
        reproducible: false,
        evidenceIds: ['101'],
      },
    })).toThrow(/reproducible/i)
  })

  it('rejects market evidence from after the decision date', () => {
    expect(() => buildMarketDifficulty({
      decisionDate: '2026-08-09',
      roleFamily: 'backend',
      seniority: 'senior',
      region: 'moscow',
      observation: {
        level: 'high',
        evidenceDate: '2026-08-10',
        source: 'official-labor-data',
        approved: true,
        reproducible: true,
        evidenceIds: ['101'],
      },
    })).toThrow(/future market evidence/i)
  })
})
