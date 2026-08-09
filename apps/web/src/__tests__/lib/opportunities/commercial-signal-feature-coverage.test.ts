import {
  addCommercialSignalFeatureCoverageSample,
  buildCommercialSignalFeatureCoverageSample,
  emptyCommercialSignalFeatureCoverageReport,
} from '@/lib/opportunities/commercial-signal-feature-coverage'

function built(): Parameters<typeof buildCommercialSignalFeatureCoverageSample>[0] {
  return {
    clientProfileId: '402',
    organizationIndustry: 'fintech',
    archetypes: ['regional_expansion'],
    input: {
      evidence: [{ sourceFamily: 'hh' }],
      stateLineage: {
        snapshot: {
          hiringBaseline: { sufficientHistory: true },
          currentHiringVelocity: { baselineDeviation14d: 0.75 },
          roleDistribution: { current: { engineering: 7 } },
          regionDistribution: { current: { Moscow: 7 }, newRegions: ['Kazan'] },
        },
      },
      hiringFriction: {
        observationStates: {
          repost_cycles: 'observed',
          salary_change: 'observed',
          requirements_change: 'unknown',
          vacancy_lifetime: 'observed',
          role_scarcity: 'unknown',
          seniority_complexity: 'observed',
          multi_role_complexity: 'observed',
          regional_difficulty: 'unknown',
          internal_recruiting_capacity: 'unknown',
          hiring_velocity_vs_capacity: 'observed',
        },
      },
      propensity: {
        componentValues: { procurement_barrier: null },
      },
      economics: { componentValue: 0.7 },
      marketDifficulty: { componentValue: null },
      contact: { corporateContactPathAvailable: true },
    },
  }
}

describe('Commercial Signal feature coverage diagnostics', () => {
  it('reports observed, unknown, and explicitly unsupported features truthfully', () => {
    const sample = buildCommercialSignalFeatureCoverageSample(built())

    expect(sample.features).toMatchObject({
      repost_cycles: 'observed',
      vacancy_lifetime: 'observed',
      regional_expansion: 'observed',
      recruiter_pressure: 'observed',
      role_scarcity: 'unknown',
      requirements_change: 'not_supported',
      regional_difficulty: 'not_supported',
      internal_recruiting_capacity: 'not_supported',
      market_difficulty: 'not_supported',
      procurement: 'not_supported',
      external_agency_history: 'not_supported',
      economics: 'observed',
      contact_path: 'observed',
    })
    expect(sample.dimensions).toEqual({
      sources: ['hh'],
      profile: '402',
      industry: 'fintech',
      region: 'moscow',
      roleFamily: 'engineering',
    })
  })

  it('aggregates coverage percentages across all required slices', () => {
    const report = emptyCommercialSignalFeatureCoverageReport()
    addCommercialSignalFeatureCoverageSample(report,
      buildCommercialSignalFeatureCoverageSample(built()))

    expect(report.features.repost_cycles).toEqual({
      observed: 1,
      unknown: 0,
      not_supported: 0,
      not_applicable: 0,
      coverage: 1,
    })
    expect(report.bySource.hh.repost_cycles.observed).toBe(1)
    expect(report.byProfile['402'].repost_cycles.observed).toBe(1)
    expect(report.byIndustry.fintech.repost_cycles.observed).toBe(1)
    expect(report.byRegion.moscow.repost_cycles.observed).toBe(1)
    expect(report.byRoleFamily.engineering.repost_cycles.observed).toBe(1)
  })

  it('does not treat a missing field as a negative observation', () => {
    const sample = buildCommercialSignalFeatureCoverageSample({
      ...built(),
      input: {
        ...built().input,
        hiringFriction: {
          observationStates: {
            ...built().input.hiringFriction.observationStates,
            salary_change: 'unknown',
          },
        },
      },
    })

    expect(sample.features.salary_change).toBe('unknown')
  })
})
