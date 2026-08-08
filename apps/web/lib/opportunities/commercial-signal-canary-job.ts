import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import {
  buildQueryPlansV2Job,
  type QueryPlannerV2JobStats,
} from '@/lib/lead-discovery/query-planner-v2-job'
import {
  executeQueryPlannerV2Sources,
  type QueryPlannerV2ExecutionStats,
} from '@/lib/lead-discovery/query-planner-v2-executor'
import { logError, logEvent } from '@/lib/runtime'
import {
  buildAgencyDnaMatchJob,
  type AgencyDnaMatchJobStats,
} from './agency-dna-match-job'
import {
  buildCommercialThesesJob,
  type CommercialThesisJobStats,
} from './commercial-thesis-job'
import {
  normalizeCompanyEventsJob,
  type CompanyEventJobStats,
} from './company-event-job'
import {
  buildCompanyStateJob,
  type CompanyStateJobStats,
} from './company-state-job'
import {
  buildExternalAgencyPropensityJob,
  type ExternalAgencyPropensityJobStats,
} from './external-agency-propensity-job'
import {
  buildOpportunityScoringV3Job,
  type OpportunityScoringV3JobStats,
} from './opportunity-scoring-v3-job'
import {
  writeCommercialSignalOpportunities,
  type CommercialSignalOpportunityWriterStats,
} from './commercial-signal-opportunity-writer'
import {
  getCommercialSignalCanaryWorkspaceId,
  resolveCommercialSignalRollout,
} from './commercial-signal-rollout'
import {
  buildSignalEpisodesJob,
  type SignalEpisodesJobStats,
} from './signal-episode-job'

export type CommercialSignalCanaryDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type CommercialSignalCanaryOptions = {
  batchSize?: number
  now?: Date
  env?: Readonly<Record<string, string | undefined>>
}

export type CommercialSignalCanaryOrganizationResult = {
  organizationId: string
  success: boolean
  failedStage: string | null
  companyEvents: CompanyEventJobStats | null
  companyState: CompanyStateJobStats | null
  signalEpisodes: SignalEpisodesJobStats | null
  commercialThesis: CommercialThesisJobStats | null
  propensity: ExternalAgencyPropensityJobStats | null
  agencyDna: AgencyDnaMatchJobStats | null
  scoring: OpportunityScoringV3JobStats | null
}

export type CommercialSignalCanaryStats = {
  workspaceId: string
  profileIds: string[]
  queryPlanner: QueryPlannerV2JobStats[]
  sourceExecution: QueryPlannerV2ExecutionStats
  touchedOrganizationIds: string[]
  organizations: CommercialSignalCanaryOrganizationResult[]
  writer: CommercialSignalOpportunityWriterStats | null
  completed: boolean
  failedStage: string | null
}

export class CommercialSignalCanaryScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommercialSignalCanaryScopeError'
  }
}

export class CommercialSignalCanaryStageError extends Error {
  constructor(
    readonly stage: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`Commercial Signal canary failed closed at ${stage}.`)
    this.name = 'CommercialSignalCanaryStageError'
  }
}

/**
 * Runs the complete production canary for exactly one configured workspace.
 * It intentionally has no workspace argument: the operator can select the
 * canary only through COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS, and rollout
 * resolution itself requires exactly one id.
 */
export async function runCommercialSignalCanary(
  options: CommercialSignalCanaryOptions = {},
  providedDb: CommercialSignalCanaryDb | null = null,
): Promise<CommercialSignalCanaryStats> {
  const env = options.env ?? process.env
  const workspaceId = getCommercialSignalCanaryWorkspaceId(env)
  if (!workspaceId) {
    throw new CommercialSignalCanaryScopeError(
      'Exactly one Commercial Signal canary workspace must be configured.',
    )
  }
  const rollout = resolveCommercialSignalRollout(workspaceId, env)
  if (rollout.requestedMode !== 'canary' || rollout.effectiveMode !== 'canary') {
    throw new CommercialSignalCanaryScopeError(
      `Canary workspace is not authoritative: ${rollout.reasonCode}.`,
    )
  }
  const batchSize = boundedInteger(options.batchSize ?? 25, 1, 100, 'batchSize')
  const now = validDate(options.now ?? new Date())
  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')

  const stats: CommercialSignalCanaryStats = {
    workspaceId,
    profileIds: [],
    queryPlanner: [],
    sourceExecution: emptySourceExecution(workspaceId),
    touchedOrganizationIds: [],
    organizations: [],
    writer: null,
    completed: false,
    failedStage: null,
  }

  try {
    stats.profileIds = await loadActiveProfileIds(workspaceId, database)
    if (stats.profileIds.length === 0) {
      throw new CommercialSignalCanaryStageError('active_profiles', {
        workspaceId,
      })
    }

    for (const profileId of stats.profileIds) {
      const planner = await buildQueryPlansV2Job({
        enabled: true,
        workspaceId,
        clientProfileId: profileId,
        profileBatchSize: 1,
        dryRun: false,
        env,
      }, database)
      stats.queryPlanner.push(planner)
      if (planner.failedProfiles > 0 || planner.profilesScanned !== 1) {
        throw new CommercialSignalCanaryStageError('query_planner_v2', {
          workspaceId,
          clientProfileId: profileId,
          failedProfiles: planner.failedProfiles,
          profilesScanned: planner.profilesScanned,
        })
      }
    }

    stats.sourceExecution = await executeQueryPlannerV2Sources({
      workspaceId,
      limit: Math.min(batchSize, 50),
      env,
    })
    if (stats.sourceExecution.requestsFailed > 0) {
      throw new CommercialSignalCanaryStageError('source_execution', {
        failedRequests: stats.sourceExecution.requestsFailed,
      })
    }

    stats.touchedOrganizationIds =
      await loadCommercialSignalCanaryTouchedOrganizationIds(
        stats.sourceExecution.executionIds,
        database,
      )

    for (const organizationId of stats.touchedOrganizationIds) {
      const result = emptyOrganizationResult(organizationId)
      stats.organizations.push(result)
      try {
        result.companyEvents = await normalizeCompanyEventsJob({
          enabled: true,
          organizationId,
          batchSize: 1,
          dryRun: false,
          now,
          env,
        }, database)
        assertStageHealthy('company_events', result.companyEvents)

        result.companyState = await buildCompanyStateJob({
          enabled: true,
          organizationId,
          batchSize: 1,
          dryRun: false,
          now,
          env,
        }, database)
        assertStageHealthy('company_state', result.companyState)

        result.signalEpisodes = await buildSignalEpisodesJob({
          enabled: true,
          organizationId,
          batchSize: 1,
          dryRun: false,
          now,
          env,
        }, database)
        assertStageHealthy('signal_episodes', result.signalEpisodes)

        result.commercialThesis = await buildCommercialThesesJob({
          enabled: true,
          organizationId,
          batchSize: 1,
          dryRun: false,
          now,
          env,
        }, database)
        assertStageHealthy('commercial_thesis', result.commercialThesis)

        result.propensity = await buildExternalAgencyPropensityJob({
          enabled: true,
          workspaceId,
          organizationId,
          batchSize,
          dryRun: false,
          now,
          env,
        }, database)
        assertStageHealthy('external_agency_propensity', result.propensity)

        result.agencyDna = await buildAgencyDnaMatchJob({
          enabled: true,
          workspaceId,
          organizationId,
          batchSize,
          dryRun: false,
          env,
        }, database)
        assertStageHealthy('agency_dna_match', result.agencyDna)

        result.scoring = await buildOpportunityScoringV3Job({
          enabled: true,
          workspaceId,
          organizationId,
          batchSize,
          dryRun: false,
          now,
          rolloutMode: 'canary',
          env,
        }, database)
        assertStageHealthy('opportunity_scoring_v3', result.scoring)

        result.success = true
      } catch (error) {
        result.failedStage = error instanceof CommercialSignalCanaryStageError
          ? error.stage
          : 'organization_pipeline'
        logError('commercial_signal.canary_organization_failed', error, {
          workspaceId,
          organizationId,
          failedStage: result.failedStage,
        })
        throw error
      }
    }

    // Even if discovery yielded zero new organizations, the writer is safe to
    // replay: it only materializes exact current candidates with complete query
    // execution lineage and therefore cannot resurrect a fuzzy/legacy lead.
    stats.writer = await writeCommercialSignalOpportunities({
      workspaceId,
      batchSize,
      now,
      env,
    }, database)
    if (stats.writer.failed > 0) {
      throw new CommercialSignalCanaryStageError('opportunity_writer', {
        failed: stats.writer.failed,
      })
    }

    stats.completed = true
    logEvent('commercial_signal.canary_completed', {
      workspaceId,
      profiles: stats.profileIds.length,
      sourceRequests: stats.sourceExecution.requestsExecuted,
      sourceRequestsBlocked: stats.sourceExecution.requestsBlocked,
      touchedOrganizations: stats.touchedOrganizationIds.length,
      materialized: stats.writer.written,
      enrichmentQueued: stats.writer.enrichmentQueued,
    })
    return stats
  } catch (error) {
    stats.failedStage = error instanceof CommercialSignalCanaryStageError
      ? error.stage
      : 'canary_runtime'
    logError('commercial_signal.canary_failed', error, {
      workspaceId,
      failedStage: stats.failedStage,
    })
    throw error
  }
}

async function loadActiveProfileIds(
  workspaceId: string,
  db: CommercialSignalCanaryDb,
): Promise<string[]> {
  const result = await db.query<{ clientProfileId: string }>(
    `SELECT id::TEXT AS "clientProfileId"
     FROM client_profiles
     WHERE workspace_id = $1
       AND is_active = TRUE
     ORDER BY id`,
    [workspaceId],
  )
  return result.rows.map((row) => positiveId(row.clientProfileId, 'client profile'))
}

export async function loadCommercialSignalCanaryTouchedOrganizationIds(
  executionIds: readonly string[],
  db: CommercialSignalCanaryDb,
): Promise<string[]> {
  if (executionIds.length === 0) return []
  const result = await db.query<{ organizationId: string }>(
    `SELECT DISTINCT execution_signal.organization_id AS "organizationId"
     FROM query_plan_source_execution_signals execution_signal
     WHERE execution_signal.execution_id = ANY($1::BIGINT[])
     ORDER BY execution_signal.organization_id`,
    [executionIds],
  )
  return result.rows.map((row) => positiveId(row.organizationId, 'organization'))
}

function assertStageHealthy(
  stage: string,
  value: Record<string, unknown>,
): void {
  const failures = Number(value.failed ?? value.failedProfiles ?? 0)
  if (!Number.isFinite(failures) || failures > 0) {
    throw new CommercialSignalCanaryStageError(stage, { failures })
  }
}

function emptyOrganizationResult(
  organizationId: string,
): CommercialSignalCanaryOrganizationResult {
  return {
    organizationId,
    success: false,
    failedStage: null,
    companyEvents: null,
    companyState: null,
    signalEpisodes: null,
    commercialThesis: null,
    propensity: null,
    agencyDna: null,
    scoring: null,
  }
}

function emptySourceExecution(
  workspaceId: string,
): QueryPlannerV2ExecutionStats {
  return {
    workspaceId,
    clientProfileId: null,
    dryRun: false,
    requestsScanned: 0,
    requestsExecuted: 0,
    requestsBlocked: 0,
    requestsFailed: 0,
    staleExecutionsReconciled: 0,
    fetchedRecords: 0,
    uniqueCompanies: 0,
    signalUpserts: 0,
    evidenceWrites: 0,
    executionIds: [],
    blocked: [],
    failures: [],
  }
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new CommercialSignalCanaryScopeError(`Invalid ${label} identifier.`)
  }
  return BigInt(normalized).toString()
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new CommercialSignalCanaryScopeError(
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    )
  }
  return value
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new CommercialSignalCanaryScopeError('now must be a valid Date.')
  }
  return value
}
