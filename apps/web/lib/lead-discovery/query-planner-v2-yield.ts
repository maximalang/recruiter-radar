import { hashCanonicalJson } from '@/lib/opportunities/canonical-hash'

import type {
  ProfileScopedQueryPlanV2,
  QueryPlanHistoricalYield,
  QueryPlannerV2Source,
} from './query-planner-v2'

export type QueryPlanOperationalYield = QueryPlanHistoricalYield & {
  executionCount: number | null
  zeroResultExecutions: number | null
  newCompanyEvents: number | null
  qualifiedEpisodes: number | null
  actionableOpportunities: number | null
  staleOpportunities: number | null
  won: number | null
}

export type QueryPlanYieldMap = Readonly<Record<string, QueryPlanOperationalYield>>

export type QueryPlanSupplyDiagnosticCode =
  | 'SUPPLY_SAMPLE_INSUFFICIENT'
  | 'SUPPLY_ZERO_RESULT_HEAVY'
  | 'SUPPLY_DUPLICATE_HEAVY'
  | 'SUPPLY_NO_EPISODES'
  | 'SUPPLY_NO_QUALIFIED_EPISODES'
  | 'SUPPLY_STALE_HEAVY'
  | 'SUPPLY_LOW_ACTIONABILITY'
  | 'SUPPLY_NO_REPLY_CONVERSION'
  | 'SUPPLY_HEALTHY'

const PAGE_ENV_KEY: Readonly<Record<QueryPlannerV2Source, string>> = {
  hh: 'HH_PAGES',
  superjob: 'SUPERJOB_PAGES',
  'habr-career': 'HABR_CAREER_PAGES',
  'rabota-rossii': 'RABOTA_ROSSII_PAGES',
}

const MAX_PAGE_BUDGET = 50
const MIN_SAMPLE_FETCHED = 50
const MIN_SAMPLE_EPISODES = 10

export function queryPlanYieldKey(input: Pick<
  ProfileScopedQueryPlanV2,
  'source' | 'roleFamily' | 'region'
>): string {
  return [
    input.source,
    normalizeKeyPart(input.roleFamily),
    normalizeKeyPart(input.region.canonicalRegion ?? ''),
    normalizeKeyPart(input.region.requestedRegion ?? ''),
  ].join('|')
}

/**
 * Applies the latest metric snapshot for the same source/role/geography plan.
 * Budget changes are deliberately small and bounded. Raw fetched volume never
 * increases a budget by itself; positive downstream commercial yield is
 * required to expand it.
 */
export function applyHistoricalYieldToQueryPlan(
  plan: ProfileScopedQueryPlanV2,
  yieldSnapshot: QueryPlanOperationalYield | null | undefined,
): ProfileScopedQueryPlanV2 {
  if (!yieldSnapshot) return plan

  const normalizedYield = normalizeOperationalYield(yieldSnapshot)
  const budgetAdjustment = resolveBudgetAdjustment(
    plan.pageBudget,
    normalizedYield,
  )
  const supplyDiagnostics = diagnoseQueryPlanSupply(normalizedYield)
  const queryEnv = { ...plan.queryEnv }
  queryEnv[PAGE_ENV_KEY[plan.source]] = String(budgetAdjustment.pageBudget)
  const reasonCodes = uniqueStrings([
    ...plan.reasonCodes,
    ...supplyDiagnostics,
    ...(budgetAdjustment.reasonCode ? [budgetAdjustment.reasonCode] : []),
  ])
  const sharedRequestHash = hashCanonicalJson({
    source: plan.source,
    queryEnv,
    pageBudget: budgetAdjustment.pageBudget,
    frequency: plan.frequency,
  })
  const historicalYield: QueryPlanHistoricalYield = {
    fetchedRecords: normalizedYield.fetchedRecords,
    uniqueEvents: normalizedYield.uniqueEvents,
    uniqueCompanies: normalizedYield.uniqueCompanies,
    episodes: normalizedYield.episodes,
    qualifiedOpportunities: normalizedYield.qualifiedOpportunities,
    accepted: normalizedYield.accepted,
    contacted: normalizedYield.contacted,
    replied: normalizedYield.replied,
    meetings: normalizedYield.meetings,
  }
  const { inputHash: _previousInputHash, ...previousSnapshot } = plan
  const snapshot = {
    ...previousSnapshot,
    pageBudget: budgetAdjustment.pageBudget,
    historicalYield,
    queryEnv,
    reasonCodes,
    sharedRequestHash,
  }
  return {
    ...snapshot,
    inputHash: hashCanonicalJson(snapshot),
  }
}

/**
 * Explains why one tenant/profile/source/role/geography plan is under-supplying
 * usable opportunities. Diagnostics are deterministic and use only persisted
 * downstream yield; they never infer missing causes from model text.
 */
export function diagnoseQueryPlanSupply(
  rawYield: QueryPlanOperationalYield,
): QueryPlanSupplyDiagnosticCode[] {
  const value = normalizeOperationalYield(rawYield)
  const fetched = value.fetchedRecords ?? 0
  const uniqueEvents = value.uniqueEvents ?? 0
  const episodes = value.episodes ?? 0
  const qualifiedEpisodes = value.qualifiedEpisodes ?? 0
  const qualified = value.qualifiedOpportunities ?? 0
  const actionable = value.actionableOpportunities ?? 0
  const stale = value.staleOpportunities ?? 0
  const executionCount = value.executionCount ?? 0
  const zeroResults = value.zeroResultExecutions ?? 0
  const contacted = value.contacted ?? 0
  const replied = value.replied ?? 0

  const sampleReady = fetched >= MIN_SAMPLE_FETCHED ||
    episodes >= MIN_SAMPLE_EPISODES || executionCount >= 5
  if (!sampleReady) return ['SUPPLY_SAMPLE_INSUFFICIENT']

  const diagnostics: QueryPlanSupplyDiagnosticCode[] = []
  const zeroResultRate = executionCount > 0 ? zeroResults / executionCount : 0
  const duplicateRate = fetched > 0
    ? Math.max(0, fetched - uniqueEvents) / fetched
    : 0
  const staleRate = qualified > 0 ? stale / qualified : 0
  const actionabilityRate = qualified > 0 ? actionable / qualified : 0

  if (zeroResultRate >= 0.6) diagnostics.push('SUPPLY_ZERO_RESULT_HEAVY')
  if (fetched >= MIN_SAMPLE_FETCHED && duplicateRate >= 0.7) {
    diagnostics.push('SUPPLY_DUPLICATE_HEAVY')
  }
  if (episodes === 0) diagnostics.push('SUPPLY_NO_EPISODES')
  if (episodes >= MIN_SAMPLE_EPISODES && qualifiedEpisodes === 0) {
    diagnostics.push('SUPPLY_NO_QUALIFIED_EPISODES')
  }
  if (qualified >= 5 && staleRate >= 0.6) diagnostics.push('SUPPLY_STALE_HEAVY')
  if (qualified >= 5 && actionabilityRate < 0.2) {
    diagnostics.push('SUPPLY_LOW_ACTIONABILITY')
  }
  if (contacted >= 5 && replied === 0) diagnostics.push('SUPPLY_NO_REPLY_CONVERSION')

  return diagnostics.length > 0 ? diagnostics : ['SUPPLY_HEALTHY']
}

export function resolveYieldAdjustedPageBudget(
  currentBudget: number,
  rawYield: QueryPlanOperationalYield,
): { pageBudget: number; reasonCode: string | null } {
  const yieldSnapshot = normalizeOperationalYield(rawYield)
  const sampleReady =
    (yieldSnapshot.fetchedRecords ?? 0) >= MIN_SAMPLE_FETCHED ||
    (yieldSnapshot.episodes ?? 0) >= MIN_SAMPLE_EPISODES ||
    (yieldSnapshot.executionCount ?? 0) >= 5
  if (!sampleReady) {
    return { pageBudget: currentBudget, reasonCode: 'YIELD_SAMPLE_INSUFFICIENT' }
  }

  const fetchedRecords = yieldSnapshot.fetchedRecords ?? 0
  const uniqueEvents = yieldSnapshot.uniqueEvents ?? 0
  const episodes = yieldSnapshot.episodes ?? 0
  const qualified = yieldSnapshot.qualifiedOpportunities ?? 0
  const actionable = yieldSnapshot.actionableOpportunities ?? 0
  const stale = yieldSnapshot.staleOpportunities ?? 0
  const accepted = yieldSnapshot.accepted ?? 0
  const contacted = yieldSnapshot.contacted ?? 0
  const replied = yieldSnapshot.replied ?? 0
  const meetings = yieldSnapshot.meetings ?? 0
  const won = yieldSnapshot.won ?? 0
  const executionCount = yieldSnapshot.executionCount ?? 0
  const zeroResultExecutions = yieldSnapshot.zeroResultExecutions ?? 0

  const duplicateYield = fetchedRecords > 0 ? uniqueEvents / fetchedRecords : 1
  const zeroResultRate = executionCount > 0
    ? zeroResultExecutions / executionCount
    : 0
  const staleRate = qualified > 0 ? stale / qualified : 0

  if (
    (fetchedRecords >= MIN_SAMPLE_FETCHED && duplicateYield < 0.3) ||
    (episodes >= MIN_SAMPLE_EPISODES && qualified === 0) ||
    (executionCount >= 5 && zeroResultRate >= 0.6)
  ) {
    return {
      pageBudget: clampBudget(currentBudget - 2),
      reasonCode: 'YIELD_BUDGET_REDUCED_WEAK_DOWNSTREAM',
    }
  }

  if (qualified >= 5 && staleRate >= 0.6) {
    return {
      pageBudget: clampBudget(currentBudget - 1),
      reasonCode: 'YIELD_BUDGET_REDUCED_STALE_SUPPLY',
    }
  }

  if (qualified >= 5 && actionable === 0) {
    return {
      pageBudget: clampBudget(currentBudget - 1),
      reasonCode: 'YIELD_BUDGET_REDUCED_LOW_ACTIONABILITY',
    }
  }

  // Expansion requires downstream evidence. Fetched volume or company count
  // alone is intentionally insufficient.
  if (won > 0 || meetings >= 2 || replied >= 3) {
    return {
      pageBudget: clampBudget(currentBudget + 2),
      reasonCode: 'YIELD_BUDGET_EXPANDED_COMMERCIAL_OUTCOME',
    }
  }
  if (
    actionable >= 3 &&
    (accepted >= 2 || contacted >= 3 || replied >= 1 || meetings >= 1)
  ) {
    return {
      pageBudget: clampBudget(currentBudget + 1),
      reasonCode: 'YIELD_BUDGET_EXPANDED_ACTIONABLE_CONVERSION',
    }
  }

  return { pageBudget: currentBudget, reasonCode: 'YIELD_BUDGET_UNCHANGED' }
}

export function parseQueryPlanYieldMap(value: unknown): QueryPlanYieldMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, QueryPlanOperationalYield> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    result[key] = normalizeOperationalYield(raw as Record<string, unknown>)
  }
  return result
}

function normalizeOperationalYield(
  raw: QueryPlanOperationalYield | Record<string, unknown>,
): QueryPlanOperationalYield {
  return {
    executionCount: nullableCount(raw.executionCount),
    zeroResultExecutions: nullableCount(raw.zeroResultExecutions),
    fetchedRecords: nullableCount(raw.fetchedRecords),
    uniqueEvents: nullableCount(raw.uniqueEvents),
    uniqueCompanies: nullableCount(raw.uniqueCompanies),
    newCompanyEvents: nullableCount(raw.newCompanyEvents),
    episodes: nullableCount(raw.episodes),
    qualifiedEpisodes: nullableCount(raw.qualifiedEpisodes),
    qualifiedOpportunities: nullableCount(raw.qualifiedOpportunities),
    actionableOpportunities: nullableCount(raw.actionableOpportunities),
    staleOpportunities: nullableCount(raw.staleOpportunities),
    accepted: nullableCount(raw.accepted),
    contacted: nullableCount(raw.contacted),
    replied: nullableCount(raw.replied),
    meetings: nullableCount(raw.meetings),
    won: nullableCount(raw.won),
  }
}

function resolveBudgetAdjustment(
  currentBudget: number,
  yieldSnapshot: QueryPlanOperationalYield,
) {
  return resolveYieldAdjustedPageBudget(currentBudget, yieldSnapshot)
}

function nullableCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function clampBudget(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_BUDGET)
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/\|/g, ' ')
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
