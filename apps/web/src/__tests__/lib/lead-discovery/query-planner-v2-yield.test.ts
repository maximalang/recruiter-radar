import {
  applyHistoricalYieldToQueryPlan,
  queryPlanYieldKey,
  resolveYieldAdjustedPageBudget,
  type QueryPlanOperationalYield,
} from '@/lib/lead-discovery/query-planner-v2-yield'
import type { ProfileScopedQueryPlanV2 } from '@/lib/lead-discovery/query-planner-v2'

const emptyYield: QueryPlanOperationalYield = {
  executionCount: null,
  zeroResultExecutions: null,
  fetchedRecords: null,
  uniqueEvents: null,
  uniqueCompanies: null,
  newCompanyEvents: null,
  episodes: null,
  qualifiedOpportunities: null,
  actionableOpportunities: null,
  accepted: null,
  contacted: null,
  replied: null,
  meetings: null,
  won: null,
}

describe('Query Planner v2 downstream yield tuning', () => {
  it('never expands a budget because fetched volume alone is high', () => {
    expect(resolveYieldAdjustedPageBudget(5, {
      ...emptyYield,
      executionCount: 8,
      fetchedRecords: 500,
      uniqueEvents: 420,
      uniqueCompanies: 300,
      episodes: 0,
      qualifiedOpportunities: 0,
      actionableOpportunities: 0,
    })).toEqual({
      pageBudget: 5,
      reasonCode: 'YIELD_BUDGET_UNCHANGED',
    })
  })

  it('reduces plans dominated by duplicates or zero downstream quality', () => {
    expect(resolveYieldAdjustedPageBudget(5, {
      ...emptyYield,
      executionCount: 10,
      zeroResultExecutions: 1,
      fetchedRecords: 200,
      uniqueEvents: 30,
      episodes: 20,
      qualifiedOpportunities: 0,
      actionableOpportunities: 0,
    })).toEqual({
      pageBudget: 3,
      reasonCode: 'YIELD_BUDGET_REDUCED_WEAK_DOWNSTREAM',
    })
  })

  it('reduces qualified plans that never become actionable', () => {
    expect(resolveYieldAdjustedPageBudget(4, {
      ...emptyYield,
      executionCount: 6,
      fetchedRecords: 80,
      uniqueEvents: 60,
      episodes: 15,
      qualifiedOpportunities: 8,
      actionableOpportunities: 0,
    })).toEqual({
      pageBudget: 3,
      reasonCode: 'YIELD_BUDGET_REDUCED_LOW_ACTIONABILITY',
    })
  })

  it('expands only when actionable opportunities convert downstream', () => {
    expect(resolveYieldAdjustedPageBudget(5, {
      ...emptyYield,
      executionCount: 10,
      fetchedRecords: 200,
      uniqueEvents: 140,
      episodes: 20,
      qualifiedOpportunities: 9,
      actionableOpportunities: 5,
      accepted: 4,
      contacted: 4,
      replied: 3,
      meetings: 2,
      won: 0,
    })).toEqual({
      pageBudget: 7,
      reasonCode: 'YIELD_BUDGET_EXPANDED_COMMERCIAL_OUTCOME',
    })
  })

  it('recomputes shared request and plan input hashes after budget tuning', () => {
    const plan = basePlan()
    const tuned = applyHistoricalYieldToQueryPlan(plan, {
      ...emptyYield,
      executionCount: 10,
      fetchedRecords: 200,
      uniqueEvents: 140,
      episodes: 20,
      qualifiedOpportunities: 8,
      actionableOpportunities: 4,
      accepted: 3,
      contacted: 3,
      replied: 1,
    })

    expect(queryPlanYieldKey(plan)).toBe('rabota-rossii|backend|moscow|москва')
    expect(tuned.pageBudget).toBe(6)
    expect(tuned.queryEnv.RABOTA_ROSSII_PAGES).toBe('6')
    expect(tuned.sharedRequestHash).not.toBe(plan.sharedRequestHash)
    expect(tuned.inputHash).not.toBe(plan.inputHash)
    expect(tuned.historicalYield.qualifiedOpportunities).toBe(8)
    expect(tuned.reasonCodes).toContain(
      'YIELD_BUDGET_EXPANDED_ACTIONABLE_CONVERSION',
    )
  })
})

function basePlan(): ProfileScopedQueryPlanV2 {
  return {
    plannerVersion: 'query-planner-v2',
    geographyVersion: 'rf-source-geography-v2-2026-08-04',
    workspaceId: '1',
    ownerId: '2',
    clientProfileId: '3',
    profileSnapshotHash: 'a'.repeat(64),
    source: 'rabota-rossii',
    roleFamily: 'backend',
    roleSynonyms: ['backend developer'],
    specializations: ['it'],
    region: {
      resolution: 'resolved',
      requestedRegion: 'Москва',
      canonicalRegion: 'moscow',
      displayName: 'Москва',
      hhAreaIds: ['1'],
      rabotaRossiiRegionCodes: ['7700000000000'],
      aliases: ['москва'],
      remoteRelation: 'region_only',
      mappingVersion: 'rf-source-geography-v2-2026-08-04',
    },
    seniorities: ['senior'],
    keywordCluster: ['backend'],
    negativeTerms: [],
    pageBudget: 5,
    frequency: 'daily',
    profileConsumers: ['3'],
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
    feedbackAdjustments: {
      positiveIndustryBoosts: [],
      positiveRoleBoosts: [],
      negativeIndustryBoosts: [],
      negativeRoleBoosts: [],
    } as never,
    queryEnv: {
      RABOTA_ROSSII_SEARCH_TEXT: 'backend',
      RABOTA_ROSSII_PAGES: '5',
      RABOTA_ROSSII_REGION_CODES: '7700000000000',
    },
    status: 'ready',
    reasonCodes: [],
    feedbackHash: 'b'.repeat(64),
    planIdentity: 'c'.repeat(64),
    inputHash: 'd'.repeat(64),
    sharedRequestHash: 'e'.repeat(64),
  }
}
