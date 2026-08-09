import {
  isCommercialSignalQualityV2Enabled,
} from './config'
import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  buildCommercialSignalQualityEngineV2,
  type CommercialSignalQualityEngineV2Input,
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

export type CommercialSignalQualityV2ShadowItem = {
  candidateId: string
  organizationId: string
  workspaceId: string
  clientProfileId: string
  validUntil: string
  input: CommercialSignalQualityEngineV2Input
}

export type CommercialSignalQualityV2ShadowOptions = {
  workspaceId?: string | number | null
  clientProfileId?: string | number | null
  organizationId?: string | number | null
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
}

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
      batchSize,
    }, db)
    for (const lineage of lineages) {
      stats.scanned += 1
      try {
        const built = await buildCommercialSignalQualityV2Input(
          lineage.opportunityLineageId,
          { workspaceId, clientProfileId, organizationId },
          db as CommercialSignalQualityV2InputBuilderDb,
        )
        const result = buildCommercialSignalQualityEngineV2(built.input)
        stats.built += 1
        countStatus(stats, result.status)
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

export async function runCommercialSignalQualityV2Shadow(
  rawItems: readonly CommercialSignalQualityV2ShadowItem[],
  options: CommercialSignalQualityV2ShadowOptions = {},
  db: CommercialSignalQualityV2Db | null = null,
): Promise<CommercialSignalQualityV2ShadowStats> {
  const enabled = isCommercialSignalQualityV2Enabled(options.env)
  const dryRun = options.dryRun !== false
  const stats = emptyStats(enabled, dryRun)
  if (!enabled) return stats
  if (!dryRun &&
    (options.workspaceId == null || options.organizationId == null)) {
    throw new CommercialSignalQualityV2ApplyScopeRequiredError()
  }
  if (!dryRun && db === null) throw new Error('quality persistence database is required')

  const workspaceId = options.workspaceId == null
    ? null
    : positiveId(String(options.workspaceId), 'workspace id')
  const organizationId = options.organizationId == null
    ? null
    : positiveId(String(options.organizationId), 'organization id')
  const items = rawItems.map(normalizeItem)
    .filter((item) => workspaceId === null || item.workspaceId === workspaceId)
    .filter((item) => organizationId === null ||
      item.organizationId === organizationId)
    .sort((left, right) => compareIds(left.candidateId, right.candidateId))

  for (const item of items) {
    stats.scanned += 1
    try {
      const result = buildCommercialSignalQualityEngineV2(item.input)
      stats.built += 1
      countStatus(stats, result.status)
      if (dryRun) continue
      const persisted = await persistCommercialSignalQualityV2({
        candidateId: item.candidateId,
        organizationId: item.organizationId,
        workspaceId: item.workspaceId,
        clientProfileId: item.clientProfileId,
        validUntil: item.validUntil,
        engineInput: item.input,
        result,
        evidence: item.input.evidence,
      }, db as CommercialSignalQualityV2Db)
      if (persisted.inserted) stats.persisted += 1
      else stats.replayed += 1
    } catch {
      stats.failed += 1
    }
  }
  return stats
}

async function loadEligibleLineages(
  input: {
    workspaceId: string
    clientProfileId: string
    organizationId: string | null
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
     ORDER BY lineage.id
     LIMIT $4`,
    [input.workspaceId, input.clientProfileId, input.organizationId, input.batchSize],
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

function normalizeItem(
  input: CommercialSignalQualityV2ShadowItem,
): CommercialSignalQualityV2ShadowItem {
  return {
    ...input,
    candidateId: positiveId(input.candidateId, 'candidate id'),
    organizationId: positiveId(input.organizationId, 'organization id'),
    workspaceId: positiveId(input.workspaceId, 'workspace id'),
    clientProfileId: positiveId(input.clientProfileId, 'client profile id'),
    validUntil: timestamp(input.validUntil, 'valid until'),
  }
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
  }
}

function positiveId(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`)
  return value
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

function compareIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, 'en')
}
