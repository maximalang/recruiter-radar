import {
  buildExternalAgencyPropensity,
  type ExternalAgencyPropensityInput,
} from '@/lib/opportunities/external-agency-propensity-v2'

function component(
  value: number | null,
  evidenceId: string,
  confidence = value === null ? 0 : 0.9,
) {
  return {
    value,
    confidence,
    coverage: value === null ? 0 : 1,
    evidenceIds: value === null ? [] : [evidenceId],
  }
}

function input(
  overrides: Partial<ExternalAgencyPropensityInput> = {},
): ExternalAgencyPropensityInput {
  return {
    hiringNeed: component(0.9, '101'),
    hiringFriction: component(0.85, '102'),
    externalSupportPlausibility: component(0.85, '103'),
    timing: component(0.8, '104'),
    agencyDna: component(0.8, '105'),
    previousAgencyRelationship: component(null, '106'),
    internalRecruitingCapacity: component(0.2, '107'),
    timeToFillPressure: component(0.75, '108'),
    procurementBarrier: component(0.1, '109'),
    doNotContact: { value: false, evidenceIds: ['110'] },
    conflict: { value: false, evidenceIds: ['111'] },
    archetypes: [archetype('hard_to_fill', '102')],
    evidenceOriginGroups: originGroups(),
    convergenceIndependentGroupCount: 3,
    ...overrides,
  }
}

describe('External Agency Propensity v2', () => {
  it('requires complementary need, plausibility, timing and friction evidence for high', () => {
    const result = buildExternalAgencyPropensity(input())

    expect(result.propensityLevel).toBe('high')
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'HIRING_NEED_EVIDENCED',
      'HIRING_FRICTION_EVIDENCED',
      'EXTERNAL_SUPPORT_PLAUSIBLE',
      'TIMING_WINDOW_ACTIVE',
    ]))
    expect(result.evidenceIds).toEqual(expect.arrayContaining([
      '101', '102', '103', '104',
    ]))
    expect(result).not.toHaveProperty('probability')
    expect(result).not.toHaveProperty('dealProbability')
  })

  it('does not infer high propensity from an archetype alone', () => {
    const result = buildExternalAgencyPropensity(input({
      hiringNeed: component(null, '201'),
      hiringFriction: component(null, '202'),
      externalSupportPlausibility: component(null, '203'),
      timing: component(null, '204'),
      agencyDna: component(null, '205'),
      internalRecruitingCapacity: component(null, '206'),
      timeToFillPressure: component(null, '207'),
      procurementBarrier: component(null, '208'),
      archetypes: [archetype('expansion', '209')],
      convergenceIndependentGroupCount: 0,
    }))

    expect(result.propensityLevel).toBe('unknown')
    expect(result.propensityScore).toBeNull()
    expect(result.confidence).toBe(0)
  })

  it('does not add unknown components to the score or coverage', () => {
    const result = buildExternalAgencyPropensity(input({
      agencyDna: component(null, '201'),
      previousAgencyRelationship: component(null, '202'),
      timeToFillPressure: component(null, '203'),
    }))

    expect(result.componentValues.agency_dna).toBeNull()
    expect(result.componentValues.previous_agency_relationship).toBeNull()
    expect(result.coverage).toBeLessThan(1)
  })

  it('uses evidenced agency DNA and friction as complementary support', () => {
    const withoutAgencyDna = buildExternalAgencyPropensity(input({
      agencyDna: component(0.1, '201'),
      previousAgencyRelationship: component(null, '202'),
    }))
    const withAgencyDna = buildExternalAgencyPropensity(input({
      agencyDna: component(0.95, '203'),
      previousAgencyRelationship: component(null, '204'),
    }))

    expect(withAgencyDna.propensityScore).toBeGreaterThan(
      withoutAgencyDna.propensityScore ?? 0,
    )
    expect(withAgencyDna.reasonCodes).toContain('AGENCY_DNA_EVIDENCED')
  })

  it('blocks confirmed no-agencies or procurement barriers', () => {
    const noAgencies = buildExternalAgencyPropensity(input({
      externalSupportPlausibility: component(0, '201', 1),
    }))
    const procurement = buildExternalAgencyPropensity(input({
      procurementBarrier: component(0.95, '202', 1),
    }))

    expect(noAgencies.propensityLevel).toBe('blocked')
    expect(noAgencies.reasonCodes).toContain('EXPLICIT_NO_AGENCIES')
    expect(procurement.propensityLevel).toBe('blocked')
    expect(procurement.reasonCodes).toContain('PROCUREMENT_BARRIER')
  })

  it('reduces propensity when internal recruiting capacity is strong', () => {
    const lowCapacity = buildExternalAgencyPropensity(input({
      internalRecruitingCapacity: component(0.1, '201'),
    }))
    const highCapacity = buildExternalAgencyPropensity(input({
      internalRecruitingCapacity: component(0.95, '202'),
    }))

    expect(highCapacity.propensityScore).toBeLessThan(
      lowCapacity.propensityScore ?? 0,
    )
    expect(highCapacity.reasonCodes).toContain('INTERNAL_TA_CAPACITY_HIGH')
  })

  it('blocks DNC and conflict independently of the commercial score', () => {
    expect(buildExternalAgencyPropensity(input({
      doNotContact: { value: true, evidenceIds: ['201'] },
    }))).toMatchObject({ propensityLevel: 'blocked', actionability: 'blocked' })
    expect(buildExternalAgencyPropensity(input({
      conflict: { value: true, evidenceIds: ['202'] },
    }))).toMatchObject({ propensityLevel: 'blocked', actionability: 'blocked' })
  })

  it('is deterministic for reordered archetypes and evidence ids', () => {
    const left = buildExternalAgencyPropensity(input({
      archetypes: [
        archetype('hard_to_fill', '102'),
        archetype('recruiting_capacity_gap', '103'),
      ],
      hiringNeed: {
        ...component(0.9, '101'),
        evidenceIds: ['301', '101'],
      },
    }))
    const right = buildExternalAgencyPropensity(input({
      archetypes: [
        archetype('recruiting_capacity_gap', '103'),
        archetype('hard_to_fill', '102'),
      ],
      hiringNeed: {
        ...component(0.9, '101'),
        evidenceIds: ['101', '301'],
      },
    }))

    expect(right).toEqual(left)
  })

  it('uses an evidenced hard-to-fill archetype as bounded commercial support', () => {
    const without = buildExternalAgencyPropensity(input({ archetypes: [] }))
    const withArchetype = buildExternalAgencyPropensity(input({
      archetypes: [archetype('hard_to_fill', '112')],
    }))

    expect(withArchetype.propensityScore).toBeGreaterThan(
      without.propensityScore ?? 0,
    )
    expect(withArchetype.reasonCodes).toContain('ARCHETYPE_HARD_TO_FILL_SUPPORT')
    expect(withArchetype.contributionProvenance).toEqual(expect.arrayContaining([
      expect.objectContaining({
        semanticFeatureFamily: 'hiring_problem_archetype',
        reasonCode: 'ARCHETYPE_HARD_TO_FILL_SUPPORT',
        derivedFrom: ['evidence:112'],
      }),
    ]))
  })

  it.each(['evergreen_hiring', 'freeze_or_slowdown'])(
    'lets %s demote rather than promote propensity',
    (archetypeName) => {
      const baseline = buildExternalAgencyPropensity(input({ archetypes: [] }))
      const demoted = buildExternalAgencyPropensity(input({
        archetypes: [archetype(archetypeName, '112')],
      }))

      expect(demoted.propensityScore).toBeLessThan(
        baseline.propensityScore ?? 1,
      )
      expect(demoted.propensityLevel).not.toBe('high')
    },
  )

  it('does not interpret replacement turnover as expansion', () => {
    const result = buildExternalAgencyPropensity(input({
      archetypes: [archetype('replacement_turnover', '112')],
    }))

    expect(result.reasonCodes).toContain('ARCHETYPE_REPLACEMENT_TURNOVER_DISTINCT')
    expect(result.reasonCodes).not.toContain('ARCHETYPE_EXPANSION_SUPPORT')
  })

  it('diminishes repeated derived contributions from one evidence origin', () => {
    const sameOrigin = buildExternalAgencyPropensity(input({
      archetypes: [archetype('hard_to_fill', '102')],
      evidenceOriginGroups: {
        ...originGroups(),
        '101': 'origin-a',
        '102': 'origin-a',
        '103': 'origin-a',
        '104': 'origin-a',
      },
      convergenceIndependentGroupCount: 1,
    }))
    const independent = buildExternalAgencyPropensity(input({
      archetypes: [archetype('hard_to_fill', '112')],
      evidenceOriginGroups: originGroups(),
    }))

    const sameOriginSupport = sameOrigin.contributionProvenance
      .filter((item) => item.evidenceOriginGroup === 'origin-a')
      .reduce((sum, item) => sum + Math.max(0, item.contribution), 0)
    const independentSupport = independent.contributionProvenance
      .reduce((sum, item) => sum + Math.max(0, item.contribution), 0)
    expect(sameOriginSupport).toBeLessThan(independentSupport)
  })
})

function archetype(archetype: string, evidenceId: string) {
  return {
    archetype,
    confidence: 0.9,
    evidenceIds: [evidenceId],
    eventIds: ['501'],
  }
}

function originGroups(): Record<string, string> {
  return Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
    const id = String(101 + index)
    return [id, `origin-${id}`]
  }))
}
