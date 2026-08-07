export const COMMERCIAL_SIGNAL_RUNTIME_MODES = [
  'legacy',
  'shadow',
  'canary',
  'commercial_signal',
] as const

export type CommercialSignalRuntimeMode =
  (typeof COMMERCIAL_SIGNAL_RUNTIME_MODES)[number]

type RuntimeEnv = Readonly<Record<string, string | undefined>>

const REQUIRED_CANARY_FLAGS = [
  'COMPANY_EVENTS_V1_ENABLED',
  'COMPANY_STATE_V1_ENABLED',
  'SIGNAL_EPISODES_V2_ENABLED',
  'COMMERCIAL_THESIS_V1_ENABLED',
  'EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED',
  'AGENCY_DNA_MATCH_V2_ENABLED',
  'OPPORTUNITY_SCORING_V3_ENABLED',
  'QUERY_PLANNER_V2_ENABLED',
] as const

export type CommercialSignalRolloutDecision = {
  requestedMode: CommercialSignalRuntimeMode
  effectiveMode: CommercialSignalRuntimeMode
  workspaceId: string | null
  canaryWorkspaceId: string | null
  prerequisitesReady: boolean
  missingFlags: string[]
  reasonCode:
    | 'legacy_default'
    | 'shadow_enabled'
    | 'canary_workspace_match'
    | 'canary_workspace_mismatch'
    | 'canary_scope_invalid'
    | 'prerequisite_flag_off'
    | 'commercial_signal_enabled'
}

/**
 * Resolve the serving/runtime mode for one workspace.
 *
 * Safety contract:
 * - absent/invalid mode is legacy;
 * - canary accepts exactly one positive workspace id;
 * - all Commercial Signal pipeline flags must be explicitly true before a
 *   canary workspace can become authoritative;
 * - a non-canary workspace always remains legacy while canary mode is active;
 * - no data is deleted when a workspace falls back to legacy.
 */
export function resolveCommercialSignalRollout(
  workspaceId: string | number | null | undefined,
  env: RuntimeEnv = process.env,
): CommercialSignalRolloutDecision {
  const requestedMode = parseMode(env.COMMERCIAL_SIGNAL_RUNTIME_MODE)
  const normalizedWorkspaceId = optionalPositiveId(workspaceId)
  const canaryScope = parseSingleCanaryWorkspace(
    env.COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS,
  )
  const missingFlags = REQUIRED_CANARY_FLAGS.filter(
    (name) => env[name] !== 'true',
  )
  const prerequisitesReady = missingFlags.length === 0

  if (requestedMode === 'legacy') {
    return decision({
      requestedMode,
      effectiveMode: 'legacy',
      workspaceId: normalizedWorkspaceId,
      canaryWorkspaceId: canaryScope.workspaceId,
      prerequisitesReady,
      missingFlags,
      reasonCode: 'legacy_default',
    })
  }

  if (requestedMode === 'shadow') {
    return decision({
      requestedMode,
      effectiveMode: 'shadow',
      workspaceId: normalizedWorkspaceId,
      canaryWorkspaceId: canaryScope.workspaceId,
      prerequisitesReady,
      missingFlags,
      reasonCode: 'shadow_enabled',
    })
  }

  if (!prerequisitesReady) {
    return decision({
      requestedMode,
      effectiveMode: 'legacy',
      workspaceId: normalizedWorkspaceId,
      canaryWorkspaceId: canaryScope.workspaceId,
      prerequisitesReady,
      missingFlags,
      reasonCode: 'prerequisite_flag_off',
    })
  }

  if (requestedMode === 'canary') {
    if (!canaryScope.valid || !canaryScope.workspaceId) {
      return decision({
        requestedMode,
        effectiveMode: 'legacy',
        workspaceId: normalizedWorkspaceId,
        canaryWorkspaceId: null,
        prerequisitesReady,
        missingFlags,
        reasonCode: 'canary_scope_invalid',
      })
    }
    if (normalizedWorkspaceId !== canaryScope.workspaceId) {
      return decision({
        requestedMode,
        effectiveMode: 'legacy',
        workspaceId: normalizedWorkspaceId,
        canaryWorkspaceId: canaryScope.workspaceId,
        prerequisitesReady,
        missingFlags,
        reasonCode: 'canary_workspace_mismatch',
      })
    }
    return decision({
      requestedMode,
      effectiveMode: 'canary',
      workspaceId: normalizedWorkspaceId,
      canaryWorkspaceId: canaryScope.workspaceId,
      prerequisitesReady,
      missingFlags,
      reasonCode: 'canary_workspace_match',
    })
  }

  return decision({
    requestedMode,
    effectiveMode: 'commercial_signal',
    workspaceId: normalizedWorkspaceId,
    canaryWorkspaceId: canaryScope.workspaceId,
    prerequisitesReady,
    missingFlags,
    reasonCode: 'commercial_signal_enabled',
  })
}

export function isCommercialSignalAuthoritativeForWorkspace(
  workspaceId: string | number | null | undefined,
  env: RuntimeEnv = process.env,
): boolean {
  const mode = resolveCommercialSignalRollout(workspaceId, env).effectiveMode
  return mode === 'canary' || mode === 'commercial_signal'
}

export function commercialSignalCandidateRolloutMode(
  workspaceId: string | number | null | undefined,
  env: RuntimeEnv = process.env,
): 'shadow' | 'canary' {
  return isCommercialSignalAuthoritativeForWorkspace(workspaceId, env)
    ? 'canary'
    : 'shadow'
}

export function getCommercialSignalCanaryWorkspaceId(
  env: RuntimeEnv = process.env,
): string | null {
  const scope = parseSingleCanaryWorkspace(
    env.COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS,
  )
  return scope.valid ? scope.workspaceId : null
}

function parseMode(value: string | undefined): CommercialSignalRuntimeMode {
  return (COMMERCIAL_SIGNAL_RUNTIME_MODES as readonly string[]).includes(
    value ?? '',
  )
    ? value as CommercialSignalRuntimeMode
    : 'legacy'
}

function parseSingleCanaryWorkspace(value: string | undefined): {
  valid: boolean
  workspaceId: string | null
} {
  const raw = (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  if (raw.length !== 1) return { valid: false, workspaceId: null }
  const workspaceId = optionalPositiveId(raw[0])
  return workspaceId
    ? { valid: true, workspaceId }
    : { valid: false, workspaceId: null }
}

function optionalPositiveId(
  value: string | number | null | undefined,
): string | null {
  if (value == null) return null
  const normalized = String(value).trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized)) return null
  const bigint = BigInt(normalized)
  if (bigint > BigInt('9223372036854775807')) return null
  return bigint.toString()
}

function decision(
  value: CommercialSignalRolloutDecision,
): CommercialSignalRolloutDecision {
  return {
    ...value,
    missingFlags: [...value.missingFlags],
  }
}
