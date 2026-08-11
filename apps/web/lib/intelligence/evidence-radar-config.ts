import { isOpportunityEngineV1EnabledForContext } from '@/lib/opportunities/config'

export const EVIDENCE_RADAR_V1_FEATURE_FLAG = 'EVIDENCE_RADAR_V1_ENABLED' as const
export const EVIDENCE_RADAR_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG =
  'EVIDENCE_RADAR_V1_CANARY_WORKSPACE_IDS' as const

type EvidenceRadarFeatureContext = {
  dataOwnerId: string | number | null | undefined
  workspaceId: string | number | null | undefined
}

export function isEvidenceRadarV1Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[EVIDENCE_RADAR_V1_FEATURE_FLAG] === 'true'
}

export function isEvidenceRadarV1EnabledForContext(
  context: EvidenceRadarFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (context.workspaceId == null) return false
  if (!hasEvidenceRadarV1PrerequisitesForContext(context, env)) return false
  if (isEvidenceRadarV1Enabled(env)) return true
  return parseCanaryWorkspaceIds(
    env[EVIDENCE_RADAR_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
  ).has(String(context.workspaceId))
}

function hasEvidenceRadarV1PrerequisitesForContext(
  context: EvidenceRadarFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return context.workspaceId != null &&
    isOpportunityEngineV1EnabledForContext(context, env)
}

export function parseEvidenceRadarCanaryWorkspaceIds(
  value: string | undefined,
): ReadonlySet<string> {
  return parseCanaryWorkspaceIds(value)
}

function parseCanaryWorkspaceIds(value: string | undefined): Set<string> {
  const result = new Set<string>()
  for (const item of value?.split(',') ?? []) {
    const normalized = item.trim()
    if (/^[1-9]\d*$/.test(normalized)) result.add(normalized)
  }
  return result
}
