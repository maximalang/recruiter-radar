export const OPPORTUNITY_ENGINE_FEATURE_FLAG = 'OPPORTUNITY_ENGINE_V1_ENABLED'
export const OPPORTUNITY_OUTCOMES_FEATURE_FLAG = 'OPPORTUNITY_OUTCOMES_ENABLED'
export const OPPORTUNITY_OUTCOMES_UI_FEATURE_FLAG =
  'OPPORTUNITY_OUTCOMES_UI_ENABLED'
export const OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_FEATURE_FLAG =
  'OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED'
export const OPPORTUNITY_CANARY_OWNER_IDS_FEATURE_FLAG =
  'OPPORTUNITY_CANARY_OWNER_IDS'
export const OPPORTUNITY_CANARY_WORKSPACE_IDS_FEATURE_FLAG =
  'OPPORTUNITY_CANARY_WORKSPACE_IDS'
export const OPPORTUNITY_WORKSPACE_CONTEXT_FEATURE_FLAG =
  'OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED'
export const AGENCY_DNA_V1_FEATURE_FLAG = 'AGENCY_DNA_V1_ENABLED'
export const AGENCY_DNA_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG =
  'AGENCY_DNA_V1_CANARY_WORKSPACE_IDS'
export const OPPORTUNITY_SCORING_V2_FEATURE_FLAG =
  'OPPORTUNITY_SCORING_V2_ENABLED'
export const OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS_FEATURE_FLAG =
  'OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS'
export const OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS_FEATURE_FLAG =
  'OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS'
export const OPPORTUNITY_STRATEGIST_V1_FEATURE_FLAG =
  'OPPORTUNITY_STRATEGIST_V1_ENABLED'
export const OPPORTUNITY_STRATEGIST_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG =
  'OPPORTUNITY_STRATEGIST_V1_CANARY_WORKSPACE_IDS'
export const OPPORTUNITY_WORKFLOW_V1_FEATURE_FLAG =
  'OPPORTUNITY_WORKFLOW_V1_ENABLED'
export const OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG =
  'OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS'
export const OPPORTUNITY_CRM_BRIDGE_FEATURE_FLAG =
  'OPPORTUNITY_CRM_BRIDGE_ENABLED'
export const OPPORTUNITY_ANALYTICS_V2_FEATURE_FLAG =
  'OPPORTUNITY_ANALYTICS_V2_ENABLED'
export const COMPANY_EVENTS_V1_FEATURE_FLAG = 'COMPANY_EVENTS_V1_ENABLED'
export const COMPANY_STATE_V1_FEATURE_FLAG = 'COMPANY_STATE_V1_ENABLED'
export const SIGNAL_EPISODES_V2_FEATURE_FLAG = 'SIGNAL_EPISODES_V2_ENABLED'

export type OpportunityFeatureContext = {
  dataOwnerId: string | number | null | undefined
  workspaceId: string | number | null | undefined
}

export const OPPORTUNITY_ENGINE_LIMITS = {
  defaultPageSize: 20,
  maximumPageSize: 100,
  defaultJobBatchSize: 100,
  maximumJobBatchSize: 500,
  opportunityValidityDays: 21,
  defaultSnoozeDays: 7,
  maximumSnoozeDays: 90,
} as const

export const COMPANY_EVENTS_V1_LIMITS = {
  defaultJobBatchSize: 10,
  maximumJobBatchSize: 25,
  maximumSourceRecordsPerOrganization: 5_000,
  statementTimeoutMs: 15_000,
} as const

export const COMPANY_STATE_V1_LIMITS = {
  defaultJobBatchSize: 10,
  maximumJobBatchSize: 25,
  maximumEventsPerOrganization: 5_000,
  historyWindowDays: 180,
  statementTimeoutMs: 15_000,
} as const

export const SIGNAL_EPISODES_V2_LIMITS = {
  defaultJobBatchSize: 10,
  maximumJobBatchSize: 25,
  maximumStateChangesPerOrganization: 1_000,
  maximumEventsPerOrganization: 5_000,
  inputHistoryWindowDays: 120,
  episodeLookbackDays: 90,
  contextWindowDays: 30,
  statementTimeoutMs: 15_000,
} as const

export function isOpportunityEngineV1Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OPPORTUNITY_ENGINE_FEATURE_FLAG] === 'true'
}

export function isCompanyEventsV1Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[COMPANY_EVENTS_V1_FEATURE_FLAG] === 'true'
}

export function isCompanyStateV1Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[COMPANY_STATE_V1_FEATURE_FLAG] === 'true'
}

export function isSignalEpisodesV2Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[SIGNAL_EPISODES_V2_FEATURE_FLAG] === 'true'
}

export function isOpportunityOutcomesEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OPPORTUNITY_OUTCOMES_FEATURE_FLAG] === 'true'
}

export function isOpportunityOutcomesUiEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isOpportunityOutcomesEnabled(env) &&
    env[OPPORTUNITY_OUTCOMES_UI_FEATURE_FLAG] === 'true'
}

export function isOpportunityWorkspaceContextEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OPPORTUNITY_WORKSPACE_CONTEXT_FEATURE_FLAG] === 'true'
}

export function isAgencyDnaV1Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[AGENCY_DNA_V1_FEATURE_FLAG] === 'true'
}

export function isAgencyDnaV1EnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!hasOpportunityIntelligencePrerequisitesForContext(context, env)) {
    return false
  }
  return isAgencyDnaV1Enabled(env) || matchesSingleCanaryId(
    context.workspaceId,
    env[AGENCY_DNA_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
  )
}

export function isOpportunityScoringV2Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OPPORTUNITY_SCORING_V2_FEATURE_FLAG] === 'true'
}

export function isOpportunityScoringV2EnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!isAgencyDnaV1EnabledForContext(context, env)) return false
  return isOpportunityScoringV2Enabled(env) || matchesSingleCanaryId(
    context.workspaceId,
    env[OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
  )
}

export function isOpportunityScoringV2ShadowEnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!isAgencyDnaV1EnabledForContext(context, env)) return false
  return matchesSingleCanaryId(
    context.workspaceId,
    env[OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
  )
}

export function isOpportunityStrategistV1Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OPPORTUNITY_STRATEGIST_V1_FEATURE_FLAG] === 'true'
}

export function isOpportunityStrategistV1EnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!isAgencyDnaV1EnabledForContext(context, env)) return false
  return isOpportunityStrategistV1Enabled(env) || matchesSingleCanaryId(
    context.workspaceId,
    env[OPPORTUNITY_STRATEGIST_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
  )
}

export function isOpportunityEngineV1EnabledForOwner(
  ownerId: string | number | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isOpportunityEngineV1Enabled(env) ||
    isOpportunityCanaryOwner(ownerId, env)
}

export function isOpportunityEngineV1EnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isOpportunityEngineV1Enabled(env) ||
    isOpportunityCanaryOwner(context.dataOwnerId, env) ||
    isOpportunityCanaryWorkspace(context.workspaceId, env)
}

export function isOpportunityOutcomesEnabledForOwner(
  ownerId: string | number | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isOpportunityEngineV1EnabledForOwner(ownerId, env) &&
    (
      isOpportunityOutcomesEnabled(env) ||
      isOpportunityCanaryOwner(ownerId, env)
    )
}

export function isOpportunityOutcomesEnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isOpportunityEngineV1EnabledForContext(context, env) &&
    (
      isOpportunityOutcomesEnabled(env) ||
      isOpportunityCanaryOwner(context.dataOwnerId, env) ||
      isOpportunityCanaryWorkspace(context.workspaceId, env)
    )
}

export function isOpportunityOutcomesUiEnabledForOwner(
  ownerId: string | number | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isOpportunityOutcomesEnabledForOwner(ownerId, env) &&
    (
      env[OPPORTUNITY_OUTCOMES_UI_FEATURE_FLAG] === 'true' ||
      isOpportunityCanaryOwner(ownerId, env)
    )
}

export function isOpportunityOutcomesUiEnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isOpportunityOutcomesEnabledForContext(context, env) &&
    (
      env[OPPORTUNITY_OUTCOMES_UI_FEATURE_FLAG] === 'true' ||
      isOpportunityCanaryOwner(context.dataOwnerId, env) ||
      isOpportunityCanaryWorkspace(context.workspaceId, env)
    )
}

export function isOpportunityWorkspaceContextEnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isOpportunityWorkspaceContextEnabled(env) ||
    isOpportunityCanaryWorkspace(context.workspaceId, env)
}

export function isOpportunityWorkflowV1Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OPPORTUNITY_WORKFLOW_V1_FEATURE_FLAG] === 'true'
}

export function isOpportunityWorkflowV1EnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (context.workspaceId == null) return false
  if (!isOpportunityEngineV1EnabledForContext(context, env)) return false
  if (!isOpportunityOutcomesEnabledForContext(context, env)) return false
  if (!isOpportunityWorkspaceContextEnabledForContext(context, env)) return false

  return isOpportunityWorkflowV1Enabled(env) || matchesSingleCanaryId(
    context.workspaceId,
    env[OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
  )
}

export function isOpportunityCrmBridgeEnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (context.workspaceId == null) return false
  if (!isOpportunityOutcomesEnabledForContext(context, env)) return false
  if (!isOpportunityWorkspaceContextEnabledForContext(context, env)) return false
  return env[OPPORTUNITY_CRM_BRIDGE_FEATURE_FLAG] === 'true'
}

export function isOpportunityCrmBridgePublicCallbackEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (env[OPPORTUNITY_CRM_BRIDGE_FEATURE_FLAG] !== 'true') return false
  const globalPrerequisites = isOpportunityEngineV1Enabled(env) &&
    isOpportunityOutcomesEnabled(env) &&
    isOpportunityWorkspaceContextEnabled(env)
  if (globalPrerequisites) return true
  if (hasAmbiguousCanaryConfiguration(env)) return false
  return parseSingleCanaryId(
    env[OPPORTUNITY_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
  ) !== null
}

export function isOpportunityAnalyticsV2Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OPPORTUNITY_ANALYTICS_V2_FEATURE_FLAG] === 'true'
}

export function isOpportunityAnalyticsV2EnabledForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (context.workspaceId == null) return false
  if (!isOpportunityEngineV1EnabledForContext(context, env)) return false
  if (!isOpportunityOutcomesEnabledForContext(context, env)) return false
  if (!isOpportunityWorkspaceContextEnabledForContext(context, env)) return false
  return isOpportunityAnalyticsV2Enabled(env)
}

export function isOpportunityOutcomesExternalIngestEnabled(
  _env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  // A global webhook secret cannot authenticate a tenant. Keep the endpoint
  // fail-closed until tenant-scoped integration identities and rotation exist.
  return false
}

function isOpportunityCanaryOwner(
  ownerId: string | number | null | undefined,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (hasAmbiguousCanaryConfiguration(env)) return false
  return matchesSingleCanaryId(
    ownerId,
    env[OPPORTUNITY_CANARY_OWNER_IDS_FEATURE_FLAG],
  )
}

function isOpportunityCanaryWorkspace(
  workspaceId: string | number | null | undefined,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (hasAmbiguousCanaryConfiguration(env)) return false
  return matchesSingleCanaryId(
    workspaceId,
    env[OPPORTUNITY_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
  )
}

function hasAmbiguousCanaryConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return Boolean(
    env[OPPORTUNITY_CANARY_OWNER_IDS_FEATURE_FLAG]?.trim() &&
    env[OPPORTUNITY_CANARY_WORKSPACE_IDS_FEATURE_FLAG]?.trim(),
  )
}

function matchesSingleCanaryId(
  value: string | number | null | undefined,
  rawAllowlist: string | undefined,
): boolean {
  const normalizedId = value === null || value === undefined
    ? ''
    : String(value)
  if (!/^[1-9]\d*$/.test(normalizedId)) return false
  return parseSingleCanaryId(rawAllowlist) === normalizedId
}

function parseSingleCanaryId(rawAllowlist: string | undefined): string | null {
  if (!rawAllowlist?.trim()) return null
  const candidates = rawAllowlist
    .split(',')
    .map((candidate) => candidate.trim())
  if (candidates.length !== 1 || !/^[1-9]\d{0,18}$/.test(candidates[0])) {
    return null
  }
  return BigInt(candidates[0]) <= BigInt('9223372036854775807')
    ? candidates[0]
    : null
}

function hasOpportunityIntelligencePrerequisitesForContext(
  context: OpportunityFeatureContext,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return isOpportunityEngineV1EnabledForContext(context, env) &&
    isOpportunityOutcomesEnabledForContext(context, env) &&
    isOpportunityWorkspaceContextEnabledForContext(context, env)
}

export function clampOpportunityPageSize(value: number): number {
  if (!Number.isFinite(value)) return OPPORTUNITY_ENGINE_LIMITS.defaultPageSize
  return Math.min(
    Math.max(Math.trunc(value), 1),
    OPPORTUNITY_ENGINE_LIMITS.maximumPageSize,
  )
}

export function clampOpportunityJobBatchSize(value: number): number {
  if (!Number.isFinite(value)) return OPPORTUNITY_ENGINE_LIMITS.defaultJobBatchSize
  return Math.min(
    Math.max(Math.trunc(value), 1),
    OPPORTUNITY_ENGINE_LIMITS.maximumJobBatchSize,
  )
}

export function clampCompanyEventsJobBatchSize(value: number): number {
  if (!Number.isFinite(value)) {
    return COMPANY_EVENTS_V1_LIMITS.defaultJobBatchSize
  }
  return Math.min(
    Math.max(Math.trunc(value), 1),
    COMPANY_EVENTS_V1_LIMITS.maximumJobBatchSize,
  )
}

export function clampCompanyStateJobBatchSize(value: number): number {
  if (!Number.isFinite(value)) {
    return COMPANY_STATE_V1_LIMITS.defaultJobBatchSize
  }
  return Math.min(
    Math.max(Math.trunc(value), 1),
    COMPANY_STATE_V1_LIMITS.maximumJobBatchSize,
  )
}

export function clampSignalEpisodesJobBatchSize(value: number): number {
  if (!Number.isFinite(value)) {
    return SIGNAL_EPISODES_V2_LIMITS.defaultJobBatchSize
  }
  return Math.min(
    Math.max(Math.trunc(value), 1),
    SIGNAL_EPISODES_V2_LIMITS.maximumJobBatchSize,
  )
}

export function clampOpportunitySnoozeDays(value: number | undefined): number {
  if (!Number.isFinite(value)) return OPPORTUNITY_ENGINE_LIMITS.defaultSnoozeDays
  return Math.min(
    Math.max(Math.trunc(value as number), 1),
    OPPORTUNITY_ENGINE_LIMITS.maximumSnoozeDays,
  )
}
