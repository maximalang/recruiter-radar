import {
  QUERY_PLANNER_VERSION_V2,
  buildProfileScopedQueryPlans,
  buildQueryPlanMetrics,
  groupSharedQueryPlans,
  resolveQueryPlanGeography,
  type QueryPlannerV2ProfileInput,
} from '@/lib/lead-discovery/query-planner-v2'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function profile(
  overrides: Partial<QueryPlannerV2ProfileInput> = {},
): QueryPlannerV2ProfileInput {
  return {
    workspaceId: '10',
    ownerId: '20',
    clientProfileId: '30',
    profileSnapshotHash: HASH_A,
    roles: ['hr'],
    industries: ['it'],
    excludedIndustries: [],
    includeKeywords: [],
    excludeKeywords: [],
    specialization: 'подбор IT-команд',
    targetCity: 'Москва',
    preferredRegions: [],
    excludedLocations: [],
    targetSeniorities: ['senior'],
    remoteFriendly: true,
    dailyDigestLimit: 5,
    feedbackEvents: [],
    historicalYield: {
      fetchedRecords: 40,
      uniqueEvents: 30,
      uniqueCompanies: 20,
      episodes: 8,
      qualifiedOpportunities: 5,
      accepted: 3,
      contacted: 2,
      replied: 1,
      meetings: 1,
    },
    ...overrides,
  }
}

describe('Query Planner v2 geography', () => {
  it('resolves a canonical RF region into source codes, aliases, and remote relation', () => {
    expect(resolveQueryPlanGeography({
      requestedRegion: 'мск',
      excludedRegions: [],
      remoteFriendly: true,
    })).toMatchObject({
      resolution: 'resolved',
      canonicalRegion: 'moscow',
      displayName: 'Москва',
      hhAreaIds: ['1'],
      rabotaRossiiRegionCodes: ['7700000000000'],
      remoteRelation: 'region_or_remote',
    })
  })

  it('fails closed for an unknown region instead of inventing source codes', () => {
    expect(resolveQueryPlanGeography({
      requestedRegion: 'Неизвестный регион',
      excludedRegions: [],
      remoteFriendly: false,
    })).toMatchObject({
      resolution: 'unresolved',
      canonicalRegion: null,
      hhAreaIds: [],
      rabotaRossiiRegionCodes: [],
      remoteRelation: 'region_only',
    })
  })

  it('marks an explicitly excluded region without producing a usable mapping', () => {
    expect(resolveQueryPlanGeography({
      requestedRegion: 'Москва',
      excludedRegions: ['мск'],
      remoteFriendly: false,
    })).toMatchObject({
      resolution: 'excluded',
      canonicalRegion: 'moscow',
      hhAreaIds: [],
      rabotaRossiiRegionCodes: [],
    })
  })
})

describe('Query Planner v2 profile isolation', () => {
  it('builds profile-scoped plans with the required provenance fields', () => {
    const [plan] = buildProfileScopedQueryPlans({
      profiles: [profile()],
      sources: ['hh'],
    })

    expect(plan).toMatchObject({
      plannerVersion: QUERY_PLANNER_VERSION_V2,
      workspaceId: '10',
      ownerId: '20',
      clientProfileId: '30',
      source: 'hh',
      roleFamily: 'hr',
      roleSynonyms: expect.arrayContaining(['рекрутер', 'hr-менеджер']),
      specializations: ['подбор it-команд', 'it'],
      region: expect.objectContaining({ canonicalRegion: 'moscow' }),
      seniorities: ['senior'],
      keywordCluster: expect.arrayContaining(['рекрутер', 'айти']),
      pageBudget: 3,
      frequency: 'daily',
      profileConsumers: ['30'],
      historicalYield: expect.objectContaining({
        qualifiedOpportunities: 5,
        meetings: 1,
      }),
      queryEnv: expect.objectContaining({
        HH_AREA: '1',
        HH_PAGES: '3',
      }),
      profileSnapshotHash: HASH_A,
    })
    expect(plan.planIdentity).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.sharedRequestHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not union one profile exclusions or feedback into another profile', () => {
    const plans = buildProfileScopedQueryPlans({
      profiles: [
        profile({
          clientProfileId: '30',
          industries: ['finance'],
          excludedIndustries: ['it'],
          excludeKeywords: ['стажер'],
          feedbackEvents: [
            { industry: 'finance', role: null, sentiment: 'negative' },
            { industry: 'finance', role: null, sentiment: 'negative' },
            { industry: 'finance', role: null, sentiment: 'negative' },
          ],
        }),
        profile({
          clientProfileId: '31',
          profileSnapshotHash: HASH_B,
          industries: ['it'],
          excludedIndustries: [],
          excludeKeywords: [],
          feedbackEvents: [],
        }),
      ],
      sources: ['hh'],
    })

    const first = plans.find((item) => item.clientProfileId === '30')!
    const second = plans.find((item) => item.clientProfileId === '31')!
    expect(first.negativeTerms).toEqual(expect.arrayContaining([
      'стажер', 'айти', 'информационные технологии',
    ]))
    expect(first.feedbackAdjustments.demote).toEqual([
      expect.objectContaining({ axis: 'industry', value: 'finance' }),
    ])
    expect(second.negativeTerms).not.toContain('стажер')
    expect(second.negativeTerms).not.toContain('айти')
    expect(second.feedbackAdjustments.demote).toEqual([])
    expect(second.keywordCluster).toContain('айти')
  })

  it('keeps unknown geography as an auditable rejected plan', () => {
    const [plan] = buildProfileScopedQueryPlans({
      profiles: [profile({ targetCity: 'Неизвестный регион' })],
      sources: ['rabota-rossii'],
    })
    expect(plan.status).toBe('review')
    expect(plan.reasonCodes).toContain('GEOGRAPHY_UNRESOLVED')
    expect(plan.queryEnv.RABOTA_ROSSII_REGION_CODES).toBeUndefined()
  })

  it('keeps the plan hash deterministic when DB feedback row order changes', () => {
    const feedback = [
      { industry: 'it', role: null, sentiment: 'positive' as const },
      { industry: 'finance', role: null, sentiment: 'negative' as const },
      { industry: 'it', role: null, sentiment: 'positive' as const },
    ]
    const [first] = buildProfileScopedQueryPlans({
      profiles: [profile({ feedbackEvents: feedback })],
      sources: ['hh'],
    })
    const [second] = buildProfileScopedQueryPlans({
      profiles: [profile({ feedbackEvents: [...feedback].reverse() })],
      sources: ['hh'],
    })
    expect(second.feedbackHash).toBe(first.feedbackHash)
    expect(second.inputHash).toBe(first.inputHash)
  })

  it('records the effective bounded page budget after an operator override', () => {
    const [plan] = buildProfileScopedQueryPlans({
      profiles: [profile({
        operatorSearchParams: { hh: { HH_PAGES: '7' } },
      })],
      sources: ['hh'],
    })
    expect(plan.pageBudget).toBe(7)
    expect(plan.queryEnv.HH_PAGES).toBe('7')
  })

  it('preserves unavailable historical yield as null instead of inferred zero', () => {
    const [plan] = buildProfileScopedQueryPlans({
      profiles: [profile({
        historicalYield: {
          fetchedRecords: null,
          uniqueEvents: null,
          uniqueCompanies: null,
          episodes: null,
          qualifiedOpportunities: null,
          accepted: null,
          contacted: null,
          replied: null,
          meetings: null,
        },
      })],
      sources: ['hh'],
    })
    expect(plan.historicalYield).toEqual({
      fetchedRecords: null,
      uniqueEvents: null,
      uniqueCompanies: null,
      episodes: null,
      qualifiedOpportunities: null,
      accepted: null,
      contacted: null,
      replied: null,
      meetings: null,
    })
  })
})

describe('Query Planner v2 shared execution and metrics', () => {
  it('groups an identical source request once while preserving profile consumers', () => {
    const plans = buildProfileScopedQueryPlans({
      profiles: [
        profile({ clientProfileId: '30' }),
        profile({ clientProfileId: '31', profileSnapshotHash: HASH_B }),
      ],
      sources: ['hh'],
    })
    const groups = groupSharedQueryPlans(plans)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      source: 'hh',
      profileConsumers: ['30', '31'],
      planIdentities: expect.arrayContaining([
        plans[0].planIdentity,
        plans[1].planIdentity,
      ]),
    })
  })

  it('does not share requests whose profile-scoped query differs', () => {
    const plans = buildProfileScopedQueryPlans({
      profiles: [
        profile({ clientProfileId: '30', roles: ['hr'] }),
        profile({ clientProfileId: '31', profileSnapshotHash: HASH_B, roles: ['sales'] }),
      ],
      sources: ['hh'],
    })
    expect(groupSharedQueryPlans(plans)).toHaveLength(2)
  })

  it('calculates query-plan yield without inventing unavailable denominators', () => {
    expect(buildQueryPlanMetrics({
      executionCount: 4,
      zeroResultExecutions: 1,
      fetchedRecords: 100,
      uniqueEvents: 70,
      uniqueCompanies: 40,
      episodes: 12,
      qualifiedOpportunities: 6,
      accepted: 4,
      contacted: 3,
      replied: 2,
      meetings: 1,
    })).toMatchObject({
      duplicateRate: 0.3,
      zeroResultRate: 0.25,
      qualifiedRate: 0.5,
      acceptedRate: 0.66667,
      contactedRate: 0.75,
      replyRate: 0.66667,
      meetingRate: 0.5,
    })

    expect(buildQueryPlanMetrics({
      executionCount: 0,
      zeroResultExecutions: 0,
      fetchedRecords: 0,
      uniqueEvents: 0,
      uniqueCompanies: 0,
      episodes: 0,
      qualifiedOpportunities: 0,
      accepted: 0,
      contacted: 0,
      replied: 0,
      meetings: 0,
    })).toMatchObject({
      duplicateRate: null,
      zeroResultRate: null,
      qualifiedRate: null,
    })
  })
})
