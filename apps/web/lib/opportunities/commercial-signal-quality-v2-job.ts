import {
  isCommercialSignalQualityV2Enabled,
} from './config'
import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  buildCommercialSignalQualityEngineV2,
  type CommercialSignalQualityEngineV2Result,
  type CommercialSignalQualityStatus,
} from './commercial-signal-quality-engine-v2'
import {
  persistCommercialSignalQualityV2,
  type CommercialSignalQualityV2Db,
} from './commercial-signal-quality-v2-repository'
import {
  buildCommercialSignalQualityV2Input,
  type CommercialSignalQualityV2InputBuilderDb,
} from './commercial-signal-quality-v2-input-builder'

export const COMMERCIAL_SIGNAL_QUALITY_V2_SHADOW_LIMITS = {
  defaultBatchSize: 25,
  maximumBatchSize: 100,
  statementTimeoutMs: 5_000,
} as const

export type CommercialSignalQualityV2ShadowOptions = {
  workspaceId?: string | number | null
  clientProfileId?: string | number | null
  organizationId?: string | number | null
  afterLineageId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export type CommercialSignalQualityV2ShadowStats = {
  enabled: boolean
  dryRun: boolean
  scanned: number
  built: number
  qualifiedActionable: number
  qualifiedNeedsEnrichment: number
  review: number
  blocked: number
  expired: number
  dismissed: number
  persisted: number
  replayed: number
  failed: number
  nextCursor: string | null
  telemetry: CommercialSignalQualityV2ShadowTelemetry
}

export type CommercialSignalQualityV2ShadowTelemetry = {
  v3ToV2: { promoted: number; demoted: number; unchanged: number }
  qualityCoverage: DistributionBuckets
  qualityConfidence: DistributionBuckets
  missingCriticalDimensions: Record<string, number>
  frictionLevels: Record<string, number>
  archetypes: Record<string, number>
  convergenceStatuses: Record<string, number>
  negativeActions: Record<string, number>
  independentOriginRatio: DistributionBuckets
}

type DistributionBuckets = { low: number; medium: number; high: number }

export class CommercialSignalQualityV2ApplyScopeRequiredError extends Error {
  constructor() {
    super(
      'Commercial Signal Quality v2 apply requires exact workspace, profile, and organization.',
    )
    this.name = 'CommercialSignalQualityV2ApplyScopeRequiredError'
  }
}

export class CommercialSignalQualityV2ShadowScopeRequiredError extends Error {
  constructor() {
    super('Commercial Signal Quality v2 shadow requires exact workspace and profile.')
    this.name = 'CommercialSignalQualityV2ShadowScopeRequiredError'
  }
}

export async function runCommercialSignalQualityV2ShadowPipeline(
  options: CommercialSignalQualityV2ShadowOptions = {},
  providedDb: CommercialSignalQualityV2Db | null = null,
): Promise<CommercialSignalQualityV2ShadowStats> {
  const enabled = isCommercialSignalQualityV2Enabled(options.env)
  const dryRun = options.dryRun !== false
  const stats = emptyStats(enabled, dryRun)
  if (!enabled) return stats
  if (options.workspaceId == null || options.clientProfileId == null) {
    throw new CommercialSignalQualityV2ShadowScopeRequiredError()
  }
  if (!dryRun && options.organizationId == null) {
    throw new CommercialSignalQualityV2ApplyScopeRequiredError()
  }
  const workspaceId = positiveId(String(options.workspaceId), 'workspace id')
  const clientProfileId = positiveId(
    String(options.clientProfileId),
    'client profile id',
  )
  const organizationId = options.organizationId == null
    ? null
    : positiveId(String(options.organizationId), 'organization id')
  const afterLineageId = options.afterLineageId == null
    ? null
    : positiveId(String(options.afterLineageId), 'after lineage id')
  const batchSize = boundedBatchSize(options.batchSize)
  const database = (providedDb ?? getPool()) as CommercialSignalQualityV2Db | null
  if (!database) throw new Error('DATABASE_URL is not set.')
  const ownsClient = Boolean(database.connect) && !('release' in database)
  const db = ownsClient && database.connect
    ? await database.connect()
    : database
  try {
    await db.query(`SELECT set_config('statement_timeout', $1, false)`, [
      `${COMMERCIAL_SIGNAL_QUALITY_V2_SHADOW_LIMITS.statementTimeoutMs}ms`,
    ])
    const lineages = await loadEligibleLineages({
      workspaceId,
      clientProfileId,
      organizationId,
      afterLineageId,
      batchSize,
    }, db)
    for (const lineage of lineages) {
      stats.scanned += 1
      stats.nextCursor = lineage.opportunityLineageId
      try {
        const built = await buildCommercialSignalQualityV2Input(
          lineage.opportunityLineageId,
          { workspaceId, clientProfileId, organizationId },
          db as CommercialSignalQualityV2InputBuilderDb,
        )
        if (
          built.workspaceId !== workspaceId ||
          built.clientProfileId !== clientProfileId ||
          (organizationId !== null && built.organizationId !== organizationId)
        ) {
          throw new Error('QUALITY_LINEAGE_BUILDER_SCOPE_MISMATCH')
        }
        const result = buildCommercialSignalQualityEngineV2(built.input)
        stats.built += 1
        countStatus(stats, result.status)
        countTelemetry(stats.telemetry, built, result)
        if (dryRun) continue
        const persisted = await persistCommercialSignalQualityV2({
          opportunityLineageId: built.opportunityLineageId,
          candidateId: built.candidateId,
          organizationId: built.organizationId,
          workspaceId: built.workspaceId,
          clientProfileId: built.clientProfileId,
          validUntil: built.validUntil,
          engineInput: built.input,
          result,
          evidence: built.input.evidence,
        }, db as CommercialSignalQualityV2Db)
        if (persisted.inserted) stats.persisted += 1
        else stats.replayed += 1
      } catch (error) {
        stats.failed += 1
        logError('commercial_signal_quality_v2.lineage_failed', error, {
          reasonCode: error instanceof Error ? error.message : 'unknown',
        })
      }
    }
    logEvent('commercial_signal_quality_v2.shadow_completed', {
      ...stats,
      workspaceScoped: true,
      profileScoped: true,
      organizationScoped: organizationId !== null,
    })
    return stats
  } finally {
    await db.query('RESET statement_timeout').catch((error) => {
      logError('commercial_signal_quality_v2.statement_timeout_reset_failed', error)
    })
    if (ownsClient && 'release' in db && typeof db.release === 'function') {
      db.release()
    }
  }
}

async function loadEligibleLineages(
  input: {
    workspaceId: string
    clientProfileId: string
    organizationId: string | null
    afterLineageId: string | null
    batchSize: number
  },
  db: CommercialSignalQualityV2Db,
): Promise<Array<{ opportunityLineageId: string }>> {
  const result = await db.query<{ opportunityLineageId: string }>(
    `SELECT lineage.id::TEXT AS "opportunityLineageId"
     FROM commercial_signal_opportunity_lineage lineage
     JOIN opportunity_candidates candidate
       ON candidate.id = lineage.candidate_id
      AND candidate.organization_id = lineage.organization_id
      AND candidate.workspace_id = lineage.workspace_id
      AND candidate.client_profile_id = lineage.client_profile_id
      AND candidate.candidate_generation = lineage.candidate_generation
      AND candidate.candidate_identity = lineage.candidate_identity
     WHERE lineage.workspace_id = $1
       AND lineage.client_profile_id = $2
       AND ($3::BIGINT IS NULL OR lineage.organization_id = $3)
       AND lineage.score_version = 'opportunity-v3'
       AND candidate.valid_until >= lineage.created_at
       AND lineage.id > COALESCE($4::BIGINT, 0)
       AND NOT EXISTS (
         SELECT 1
         FROM commercial_signal_quality_opportunity_lineage quality_lineage
         WHERE quality_lineage.opportunity_lineage_id = lineage.id
       )
     ORDER BY lineage.id
     LIMIT $5`,
    [
      input.workspaceId,
      input.clientProfileId,
      input.organizationId,
      input.afterLineageId,
      input.batchSize,
    ],
  )
  return result.rows.map((row) => ({
    opportunityLineageId: positiveId(
      row.opportunityLineageId,
      'opportunity lineage id',
    ),
  }))
}

function boundedBatchSize(value: number | undefined): number {
  const normalized = value ??
    COMMERCIAL_SIGNAL_QUALITY_V2_SHADOW_LIMITS.defaultBatchSize
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error('quality batch size must be a positive integer')
  }
  return Math.min(
    normalized,
    COMMERCIAL_SIGNAL_QUALITY_V2_SHADOW_LIMITS.maximumBatchSize,
  )
}

function countStatus(
  stats: CommercialSignalQualityV2ShadowStats,
  status: ReturnType<typeof buildCommercialSignalQualityEngineV2>['status'],
): void {
  if (status === 'qualified_actionable') stats.qualifiedActionable += 1
  else if (status === 'qualified_needs_enrichment') {
    stats.qualifiedNeedsEnrichment += 1
  } else stats[status] += 1
}

function emptyStats(
  enabled: boolean,
  dryRun: boolean,
): CommercialSignalQualityV2ShadowStats {
  return {
    enabled,
    dryRun,
    scanned: 0,
    built: 0,
    qualifiedActionable: 0,
    qualifiedNeedsEnrichment: 0,
    review: 0,
    blocked: 0,
    expired: 0,
    dismissed: 0,
    persisted: 0,
    replayed: 0,
    failed: 0,
    nextCursor: null,
    telemetry: {
      v3ToV2: { promoted: 0, demoted: 0, unchanged: 0 },
      qualityCoverage: emptyDistribution(),
      qualityConfidence: emptyDistribution(),
      missingCriticalDimensions: {},
      frictionLevels: {},
      archetypes: {},
      convergenceStatuses: {},
      negativeActions: {},
      independentOriginRatio: emptyDistribution(),
    },
  }
}

const CRITICAL_COMPONENTS = [
  'hiring_need',
  'hiring_friction',
  'agency_fit',
  'external_agency_propensity',
  'signal_convergence',
] as const

function countTelemetry(
  telemetry: CommercialSignalQualityV2ShadowTelemetry,
  built: Awaited<ReturnType<typeof buildCommercialSignalQualityV2Input>>,
  result: CommercialSignalQualityEngineV2Result,
): void {
  const comparison = statusRank(result.status) - statusRank(built.v3Status)
  telemetry.v3ToV2[comparison > 0
    ? 'promoted' : comparison < 0 ? 'demoted' : 'unchanged'] += 1
  countDistribution(telemetry.qualityCoverage, result.quality.qualityCoverage)
  countDistribution(telemetry.qualityConfidence, result.quality.qualityConfidence)
  countDistribution(
    telemetry.independentOriginRatio,
    result.actionabilityIndependence.coverage,
  )
  for (const key of CRITICAL_COMPONENTS) {
    const component = result.components[key]
    if (!component || component.value === null || component.coverage === 0) {
      increment(telemetry.missingCriticalDimensions, key)
    }
  }
  increment(telemetry.frictionLevels, built.input.hiringFriction.frictionLevel)
  for (const archetype of built.archetypes) increment(telemetry.archetypes, archetype)
  increment(telemetry.convergenceStatuses, built.input.convergence.status)
  increment(telemetry.negativeActions, built.input.negativeEvidence.action)
}

function statusRank(status: CommercialSignalQualityStatus): number {
  return {
    qualified_actionable: 5,
    qualified_needs_enrichment: 4,
    review: 3,
    blocked: 2,
    expired: 1,
    dismissed: 0,
  }[status]
}

function emptyDistribution(): DistributionBuckets {
  return { low: 0, medium: 0, high: 0 }
}

function countDistribution(target: DistributionBuckets, value: number): void {
  target[value >= 0.75 ? 'high' : value >= 0.5 ? 'medium' : 'low'] += 1
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1
}

function positiveId(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`)
  return value
}
