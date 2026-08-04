import {
  AGENCY_DNA_MATCH_FEATURE_VERSION,
  buildAgencyDnaMatch,
  type AgencyDnaMatchInput,
} from '@/lib/opportunities/agency-dna-match'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

function input(
  overrides: Partial<AgencyDnaMatchInput> = {},
): AgencyDnaMatchInput {
  return {
    organizationId: '10',
    workspaceId: '20',
    ownerId: '30',
    clientProfileId: '40',
    propensitySnapshotId: '50',
    propensityGeneration: 2,
    propensityIdentity: HASH_A,
    propensityInputHash: HASH_B,
    propensityEvidenceHash: HASH_C,
    propensityFeatureVersion: 'external-agency-propensity-v1',
    propensityScore: 0.82,
    propensityLevel: 'high',
    episodeStage: 'active',
    evidenceSourceFamilyCount: 2,
    evidenceIds: ['102', '101'],
    roleFamilies: ['data', 'it-engineering'],
    seniorityDistribution: { senior: 2, middle: 1 },
    episodeRegions: ['Moscow'],
    organizationIndustry: 'fintech',
    organizationCity: 'Moscow',
    organizationCountry: 'RU',
    evidencedTechnologyQualificationTags: ['python'],
    evidencedServiceTypes: ['permanent'],
    evidencedEngagementTypes: [],
    remoteStatus: null,
    companySizeBucket: null,
    estimatedFeeMinor: null,
    estimatedOpportunityValueMinor: null,
    agencyDnaVersion: 7,
    agencyDnaSnapshotHash: HASH_A,
    agencyDnaSourceSnapshot: {
      profile: { roles: ['data'] },
      accountRestrictions: [],
    },
    specialization: 'Data; fintech',
    roles: ['data'],
    technologyQualificationTags: ['python', 'sql'],
    industries: ['fintech'],
    targetCity: 'Moscow',
    preferredRegions: ['Moscow'],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: true,
    serviceTypes: ['permanent', 'executive'],
    targetSeniorities: ['senior'],
    minimumFeeMinor: 250_000,
    averageFeeMinor: 400_000,
    minimumOpportunityValueMinor: 600_000,
    preferredEngagementTypes: ['success_fee'],
    companySizes: ['medium'],
    hiringMode: 'specialist',
    undesirableHiringTypes: ['volume'],
    currentCapacity: 'normal',
    caseStudies: [{
      roleFamilies: ['data'],
      industries: ['fintech'],
      companySizeBucket: null,
      region: 'Moscow',
      hiringModes: ['specialist'],
      measurableResult: 'Closed a senior data team.',
      publicSafeDescription: null,
    }],
    accountRestriction: null,
    ...overrides,
  }
}

describe('Agency DNA Match v2 contract', () => {
  it('builds a deterministic evidence-bound match and normalizes unordered input', () => {
    const first = buildAgencyDnaMatch(input())
    const second = buildAgencyDnaMatch(input({
      evidenceIds: ['101', '102', '101'],
      roleFamilies: ['IT-Engineering', 'data'],
      episodeRegions: ['moscow', 'Moscow'],
      technologyQualificationTags: ['SQL', 'python'],
      roles: ['DATA', 'data'],
    }))

    expect(first.featureVersion).toBe(AGENCY_DNA_MATCH_FEATURE_VERSION)
    expect(first.inputHash).toBe(second.inputHash)
    expect(first.matchIdentity).toBe(second.matchIdentity)
    expect(first.evidenceIds).toEqual(['101', '102'])
    expect(first.dimensions.role_family.outcome).toBe('match')
    expect(first.dimensions.industry.outcome).toBe('match')
    expect(first.dimensions.technology_qualification.outcome).toBe('match')
    expect(first.level).toBe('strong')
    expect(first.modes.find.status).toBe('qualifies')
    expect(first.modes.grow.status).toBe('not_applicable')
    expect(first.modes.reactivate.status).toBe('not_applicable')
  })

  it.each([
    ['existing_client', 'grow'],
    ['former_client', 'reactivate'],
    [null, 'find'],
  ] as const)('calculates %s account scope separately for %s', (restriction, mode) => {
    const match = buildAgencyDnaMatch(input({ accountRestriction: restriction }))

    expect(match.modes[mode].applicable).toBe(true)
    expect(match.modes[mode].status).toBe('qualifies')
    for (const other of ['find', 'grow', 'reactivate'] as const) {
      if (other !== mode) expect(match.modes[other].status).toBe('not_applicable')
    }
  })

  it.each(['do_not_contact', 'conflict'] as const)(
    'blocks every mode for the %s account policy',
    (accountRestriction) => {
      const match = buildAgencyDnaMatch(input({ accountRestriction }))

      expect(match.level).toBe('blocked')
      expect(Object.values(match.modes).map((mode) => mode.status))
        .toEqual(['blocked', 'blocked', 'blocked'])
      expect(match.reasons).toEqual(expect.arrayContaining([
        expect.objectContaining({ basis: 'policy', contribution: -1 }),
      ]))
    },
  )

  it('raises quality and reduces quantity at low capacity', () => {
    const low = buildAgencyDnaMatch(input({ currentCapacity: 'low' }))
    const normal = buildAgencyDnaMatch(input({ currentCapacity: 'normal' }))
    const high = buildAgencyDnaMatch(input({ currentCapacity: 'high' }))

    expect(low.selectionPolicy).toEqual({
      capacity: 'low',
      minimumFitScore: 0.75,
      minimumCoverage: 0.5,
      minimumPropensityLevel: 'medium',
      quotaMultiplier: 0.5,
      adjacentMatchesAllowed: false,
    })
    expect(normal.selectionPolicy.quotaMultiplier).toBe(1)
    expect(high.selectionPolicy.quotaMultiplier).toBe(1.5)
    expect(high.selectionPolicy.minimumFitScore)
      .toBe(normal.selectionPolicy.minimumFitScore)
    expect(high.selectionPolicy.minimumPropensityLevel)
      .toBe(normal.selectionPolicy.minimumPropensityLevel)
    expect(high.selectionPolicy.adjacentMatchesAllowed).toBe(true)
  })

  it('never lets high capacity weaken the upstream evidence gate', () => {
    const match = buildAgencyDnaMatch(input({
      currentCapacity: 'high',
      propensityLevel: 'low',
      propensityScore: 0.3,
    }))

    expect(match.level).toBe('insufficient_evidence')
    expect(match.modes.find.status).toBe('insufficient_evidence')
    expect(match.selectionPolicy.quotaMultiplier).toBe(1.5)
    expect(match.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROPENSITY_BELOW_EVIDENCE_FLOOR' }),
    ]))
  })

  it('keeps unavailable engagement, company-size, remote, and economics facts unknown', () => {
    const match = buildAgencyDnaMatch(input())

    expect(match.dimensions.engagement_type.outcome).toBe('unknown')
    expect(match.dimensions.company_size.outcome).toBe('unknown')
    expect(match.dimensions.remote.outcome).toBe('unknown')
    expect(match.dimensions.economics.outcome).toBe('unknown')
    expect(match.dimensions.economics.contribution).toBe(0)
    expect(match.unknownDimensions).toEqual(expect.arrayContaining([
      'engagement_type',
      'company_size',
      'remote',
      'economics',
    ]))
  })

  it('treats an evidenced undesirable hiring type as a hard policy block', () => {
    const match = buildAgencyDnaMatch(input({
      evidencedServiceTypes: ['volume'],
      undesirableHiringTypes: ['volume'],
    }))

    expect(match.level).toBe('blocked')
    expect(match.dimensions.undesirable_hiring_type.outcome).toBe('blocked')
    expect(match.modes.find.status).toBe('blocked')
  })

  it('rejects invalid source hashes and missing evidence', () => {
    expect(() => buildAgencyDnaMatch(input({ propensityInputHash: 'bad' })))
      .toThrow('propensity input hash')
    expect(() => buildAgencyDnaMatch(input({ evidenceIds: [] })))
      .toThrow('at least one evidence id')
  })
})
