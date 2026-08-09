import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'

import {
  buildProfileScopedQueryPlans,
  groupSharedQueryPlans,
  QUERY_PLANNER_V2_SOURCES,
  type ProfileScopedQueryPlanV2,
  type QueryPlannerV2ProfileInput,
  type QueryPlannerV2Source,
} from './query-planner-v2'
import {
  applyHistoricalYieldToQueryPlan,
  parseQueryPlanYieldMap,
  queryPlanYieldKey,
  type QueryPlanYieldMap,
} from './query-planner-v2-yield'
import {
  clampQueryPlannerV2ProfileBatchSize,
  isQueryPlannerV2Enabled,
  QUERY_PLANNER_V2_LIMITS,
} from './query-planner-v2-config'
import {
  persistProfileScopedQueryPlans,
  type QueryPlannerV2Db,
} from './query-planner-v2-repository'
import type { FeedbackPatternEvent } from './query-feedback-tuning'
import { isCommercialSignalQualityV2PlannerFeedbackEnabled } from '@/lib/opportunities/config'

export type QueryPlannerV2JobDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type QueryPlannerV2JobOptions = {
  workspaceId?: string | number | null
  clientProfileId?: string | number | null
  profileBatchSize?: number
  sources?: readonly QueryPlannerV2Source[]
  dryRun?: boolean
  enabled?: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export type QueryPlannerV2JobStats = {
  enabled: boolean
  dryRun: boolean
  profilesScanned: number
  plansBuilt: number
  ready: number
  review: number
  blocked: number
  sharedRequests: number
  persisted: number
  replayed: number
  sharedRequestsInserted: number
  consumersLinked: number
  failedProfiles: number
}

export class QueryPlannerV2ApplyScopeRequiredError extends Error {
  constructor() {
    super('Query Planner v2 apply requires explicit workspace and client profile.')
    this.name = 'QueryPlannerV2ApplyScopeRequiredError'
  }
}

type ProfileRow = Record<string, unknown>

export async function buildQueryPlansV2Job(
  options: QueryPlannerV2JobOptions = {},
  providedDb: QueryPlannerV2JobDb | null = null,
): Promise<QueryPlannerV2JobStats> {
  const enabled = options.enabled !== false && isQueryPlannerV2Enabled(options.env)
  const stats = emptyStats(enabled, options.dryRun !== false)
  if (!enabled) return stats
  if (!stats.dryRun &&
      (options.workspaceId == null || options.clientProfileId == null)) {
    throw new QueryPlannerV2ApplyScopeRequiredError()
  }

  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')
  const profileBatchSize = clampQueryPlannerV2ProfileBatchSize(
    options.profileBatchSize ?? QUERY_PLANNER_V2_LIMITS.defaultProfileBatchSize,
  )
  const sources = normalizeSources(options.sources)
  const ownsClient = 'connect' in database && !('release' in database)
  const jobDb = ownsClient && 'connect' in database
    ? await database.connect()
    : database
  try {
    await jobDb.query(
      `SELECT set_config('statement_timeout', $1, false)`,
      [`${QUERY_PLANNER_V2_LIMITS.statementTimeoutMs}ms`],
    )
    return await executeJob(options, sources, profileBatchSize, stats, jobDb)
  } finally {
    await jobDb.query('RESET statement_timeout').catch((error) => {
      logError('query_planner_v2.statement_timeout_reset_failed', error)
    })
    if (ownsClient && 'release' in jobDb) jobDb.release()
  }
}

async function executeJob(
  options: QueryPlannerV2JobOptions,
  sources: readonly QueryPlannerV2Source[],
  profileBatchSize: number,
  stats: QueryPlannerV2JobStats,
  database: QueryPlannerV2JobDb,
): Promise<QueryPlannerV2JobStats> {
  const rows = await loadProfiles(options, sources, profileBatchSize, database)
  const plansByProfile: ProfileScopedQueryPlanV2[][] = []
  for (const row of rows) {
    stats.profilesScanned += 1
    try {
      const historicalYieldByPlan = historicalYieldMap(row.historicalYieldRows)
      const plans = buildProfileScopedQueryPlans({
        profiles: [profileFromRow(row)],
        sources,
      }).map((plan) => applyHistoricalYieldToQueryPlan(
        plan,
        historicalYieldByPlan[queryPlanYieldKey(plan)],
        { qualityFeedbackEnabled:
          isCommercialSignalQualityV2PlannerFeedbackEnabled(options.env) },
      ))
      plansByProfile.push(plans)
      stats.plansBuilt += plans.length
      for (const plan of plans) stats[plan.status] += 1
    } catch (error) {
      stats.failedProfiles += 1
      logError('query_planner_v2.profile_build_failed', error, {
        workspaceId: safeText(row.workspaceId),
        clientProfileId: safeText(row.clientProfileId),
      })
    }
  }
  stats.sharedRequests = groupSharedQueryPlans(plansByProfile.flat()).length

  if (!stats.dryRun) {
    for (const plans of plansByProfile) {
      try {
        const result = await persistProfileScopedQueryPlans(
          plans,
          database as QueryPlannerV2Db,
        )
        stats.persisted += result.plans.filter((plan) => plan.inserted).length
        stats.replayed += result.plans.filter((plan) => !plan.inserted).length
        stats.sharedRequestsInserted += result.sharedRequestsInserted
        stats.consumersLinked += result.consumersLinked
      } catch (error) {
        stats.failedProfiles += 1
        const plan = plans[0]
        logError('query_planner_v2.profile_persist_failed', error, {
          workspaceId: plan?.workspaceId,
          clientProfileId: plan?.clientProfileId,
        })
      }
    }
  }
  logEvent('query_planner_v2.build_completed', {
    dryRun: stats.dryRun,
    profilesScanned: stats.profilesScanned,
    plansBuilt: stats.plansBuilt,
    ready: stats.ready,
    review: stats.review,
    blocked: stats.blocked,
    sharedRequests: stats.sharedRequests,
    persisted: stats.persisted,
    replayed: stats.replayed,
    sharedRequestsInserted: stats.sharedRequestsInserted,
    consumersLinked: stats.consumersLinked,
    failedProfiles: stats.failedProfiles,
  })
  return stats
}

async function loadProfiles(
  options: QueryPlannerV2JobOptions,
  sources: readonly QueryPlannerV2Source[],
  profileBatchSize: number,
  database: QueryPlannerV2JobDb,
): Promise<ProfileRow[]> {
  const result = await database.query<ProfileRow>(
    `SELECT
       profile.workspace_id::TEXT AS "workspaceId",
       profile.owner_id::TEXT AS "ownerId",
       profile.id::TEXT AS "clientProfileId",
       ENCODE(
         DIGEST(agency_dna_full_snapshot(profile)::TEXT, 'sha256'),
         'hex'
       ) AS "profileSnapshotHash",
       profile.roles,
       profile.industries,
       profile.excluded_industries AS "excludedIndustries",
       profile.include_keywords AS "includeKeywords",
       profile.exclude_keywords AS "excludeKeywords",
       profile.specialization,
       profile.target_city AS "targetCity",
       profile.preferred_regions AS "preferredRegions",
       profile.excluded_locations AS "excludedLocations",
       profile.target_seniorities AS "targetSeniorities",
       profile.remote_friendly AS "remoteFriendly",
       profile.daily_digest_limit AS "dailyDigestLimit",
       COALESCE((
         SELECT JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'industry', NULLIF(LOWER(BTRIM(org.industry)), ''),
             'role', NULL,
             'sentiment', CASE
               WHEN state.feedback_status IN ('badfit', 'dismissed')
                 THEN 'negative'
               ELSE 'positive'
             END
           )
           ORDER BY state.updated_at, state.org_id
         )
         FROM client_digest_org_state state
         JOIN orgs org ON org.id = state.org_id
         WHERE state.client_profile_id = profile.id
           AND state.feedback_status IN (
             'badfit', 'dismissed', 'contacted', 'replied', 'won'
           )
       ), '[]'::JSONB) AS "feedbackEvents",
       COALESCE((
         SELECT JSONB_OBJECT_AGG(
           preference.source,
           preference.params
           ORDER BY preference.source
         )
         FROM user_search_preferences preference
         WHERE preference.user_id = profile.owner_id
           AND preference.source = ANY($3::TEXT[])
       ), '{}'::JSONB) AS "operatorSearchParams",
       COALESCE((
         SELECT JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'key', latest.metric_key,
             'executionCount', latest.execution_count,
             'zeroResultExecutions', latest.zero_result_executions,
             'fetchedRecords', latest.fetched_records,
             'uniqueEvents', latest.unique_events,
             'uniqueCompanies', latest.unique_companies,
             'newCompanyEvents', latest.new_company_events,
             'independentEvents', latest.independent_events,
             'episodes', latest.episodes,
             'qualifiedEpisodes', latest.qualified_episodes,
             'qualifiedOpportunities', latest.qualified_opportunities,
             'actionableOpportunities', latest.actionable_opportunities,
             'strongReviewedOpportunities', latest.strong_reviewed_opportunities,
             'ordinaryHiringOpportunities', latest.ordinary_hiring_opportunities,
             'staleOpportunities', latest.stale_opportunities,
             'accepted', latest.accepted,
             'contacted', latest.contacted,
             'replied', latest.replied,
             'meetings', latest.meetings,
             'won', latest.won_opportunities
           )
           ORDER BY latest.metric_key
         )
         FROM (
           SELECT DISTINCT ON (
             plan.source,
             plan.role_family,
             COALESCE(plan.region_snapshot->>'canonicalRegion', ''),
             COALESCE(plan.region_snapshot->>'requestedRegion', '')
           )
             LOWER(plan.source) || '|' ||
             LOWER(BTRIM(plan.role_family)) || '|' ||
             LOWER(BTRIM(COALESCE(plan.region_snapshot->>'canonicalRegion', ''))) || '|' ||
             LOWER(BTRIM(COALESCE(plan.region_snapshot->>'requestedRegion', '')))
               AS metric_key,
             metric.execution_count,
             metric.zero_result_executions,
             metric.fetched_records,
             metric.unique_events,
             metric.unique_companies,
             metric.new_company_events,
             metric.independent_events,
             metric.episodes,
             metric.qualified_episodes,
             metric.qualified_opportunities,
             metric.actionable_opportunities,
             metric.strong_reviewed_opportunities,
             metric.ordinary_hiring_opportunities,
             metric.stale_opportunities,
             metric.accepted,
             metric.contacted,
             metric.replied,
             metric.meetings,
             metric.won_opportunities
           FROM query_plan_snapshots plan
           JOIN query_plan_metric_snapshots metric
             ON metric.plan_snapshot_id = plan.id
            AND metric.workspace_id = plan.workspace_id
            AND metric.client_profile_id = plan.client_profile_id
            AND metric.metric_version = 'query-plan-yield-v2'
           WHERE plan.workspace_id = profile.workspace_id
             AND plan.client_profile_id = profile.id
           ORDER BY
             plan.source,
             plan.role_family,
             COALESCE(plan.region_snapshot->>'canonicalRegion', ''),
             COALESCE(plan.region_snapshot->>'requestedRegion', ''),
             metric.measurement_window_end DESC,
             metric.id DESC
         ) latest
       ), '[]'::JSONB) AS "historicalYieldRows"
     FROM client_profiles profile
     WHERE profile.is_active = TRUE
       AND ($1::BIGINT IS NULL OR profile.workspace_id = $1)
       AND ($2::BIGINT IS NULL OR profile.id = $2)
     ORDER BY profile.workspace_id, profile.id
     LIMIT $4`,
    [
      options.workspaceId == null ? null : String(options.workspaceId),
      options.clientProfileId == null ? null : String(options.clientProfileId),
      sources,
      profileBatchSize,
    ],
  )
  return result.rows
}

function profileFromRow(row: ProfileRow): QueryPlannerV2ProfileInput {
  return {
    workspaceId: positiveId(row.workspaceId, 'workspace'),
    ownerId: positiveId(row.ownerId, 'owner'),
    clientProfileId: positiveId(row.clientProfileId, 'client profile'),
    profileSnapshotHash: hash(row.profileSnapshotHash, 'profile snapshot'),
    roles: strings(row.roles),
    industries: strings(row.industries),
    excludedIndustries: strings(row.excludedIndustries),
    includeKeywords: strings(row.includeKeywords),
    excludeKeywords: strings(row.excludeKeywords),
    specialization: nullableText(row.specialization),
    targetCity: nullableText(row.targetCity),
    preferredRegions: strings(row.preferredRegions),
    excludedLocations: strings(row.excludedLocations),
    targetSeniorities: strings(row.targetSeniorities),
    remoteFriendly: row.remoteFriendly === true,
    dailyDigestLimit: positiveInteger(row.dailyDigestLimit, 'daily digest limit'),
    feedbackEvents: feedbackEvents(row.feedbackEvents),
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
    operatorSearchParams: operatorSearchParams(row.operatorSearchParams),
  }
}

function historicalYieldMap(value: unknown): QueryPlanYieldMap {
  if (!Array.isArray(value)) return {}
  const raw: Record<string, unknown> = {}
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const key = nullableText(row.key)
    if (!key) continue
    raw[key] = {
      executionCount: row.executionCount,
      zeroResultExecutions: row.zeroResultExecutions,
      fetchedRecords: row.fetchedRecords,
      uniqueEvents: row.uniqueEvents,
      uniqueCompanies: row.uniqueCompanies,
      newCompanyEvents: row.newCompanyEvents,
      independentEvents: row.independentEvents,
      episodes: row.episodes,
      qualifiedEpisodes: row.qualifiedEpisodes,
      qualifiedOpportunities: row.qualifiedOpportunities,
      actionableOpportunities: row.actionableOpportunities,
      strongReviewedOpportunities: row.strongReviewedOpportunities,
      ordinaryHiringOpportunities: row.ordinaryHiringOpportunities,
      staleOpportunities: row.staleOpportunities,
      accepted: row.accepted,
      contacted: row.contacted,
      replied: row.replied,
      meetings: row.meetings,
      won: row.won,
    }
  }
  return parseQueryPlanYieldMap(raw)
}

function normalizeSources(
  sources: readonly QueryPlannerV2Source[] | undefined,
): QueryPlannerV2Source[] {
  const requested = sources ?? QUERY_PLANNER_V2_SOURCES
  const valid = new Set<QueryPlannerV2Source>()
  for (const source of requested) {
    if ((QUERY_PLANNER_V2_SOURCES as readonly string[]).includes(source)) {
      valid.add(source)
    }
  }
  return [...valid]
}

function feedbackEvents(value: unknown): FeedbackPatternEvent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const event = item as Record<string, unknown>
    if (event.sentiment !== 'negative' && event.sentiment !== 'positive') return []
    return [{
      industry: nullableText(event.industry),
      role: nullableText(event.role),
      sentiment: event.sentiment,
    }]
  })
}

function operatorSearchParams(
  value: unknown,
): QueryPlannerV2ProfileInput['operatorSearchParams'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Partial<Record<QueryPlannerV2Source, Record<string, string>>> = {}
  for (const [source, params] of Object.entries(value)) {
    if (!(QUERY_PLANNER_V2_SOURCES as readonly string[]).includes(source) ||
        !params || typeof params !== 'object' || Array.isArray(params)) continue
    const normalized: Record<string, string> = {}
    for (const [key, raw] of Object.entries(params)) {
      if (typeof raw === 'string' && raw.trim()) normalized[key] = raw.trim()
    }
    result[source as QueryPlannerV2Source] = normalized
  }
  return result
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function nullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function safeText(value: unknown): string | undefined {
  const normalized = nullableText(value)
  return normalized ?? undefined
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized)) throw new TypeError(`Invalid ${label}.`)
  return normalized
}

function hash(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`Invalid ${label}.`)
  return normalized
}

function positiveInteger(value: unknown, label: string): number {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return normalized
}

function emptyStats(enabled: boolean, dryRun: boolean): QueryPlannerV2JobStats {
  return {
    enabled,
    dryRun,
    profilesScanned: 0,
    plansBuilt: 0,
    ready: 0,
    review: 0,
    blocked: 0,
    sharedRequests: 0,
    persisted: 0,
    replayed: 0,
    sharedRequestsInserted: 0,
    consumersLinked: 0,
    failedProfiles: 0,
  }
}
