import {
  isCommercialSignalQualityV2Enabled,
} from './config'
import {
  buildCommercialSignalQualityEngineV2,
  type CommercialSignalQualityEngineV2Input,
} from './commercial-signal-quality-engine-v2'
import {
  persistCommercialSignalQualityV2,
  type CommercialSignalQualityV2Db,
} from './commercial-signal-quality-v2-repository'

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
  organizationId?: string | number | null
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
    super('Commercial Signal Quality v2 apply requires exact workspace and organization.')
    this.name = 'CommercialSignalQualityV2ApplyScopeRequiredError'
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
