export const OPPORTUNITY_ENGINE_FEATURE_FLAG = 'OPPORTUNITY_ENGINE_V1_ENABLED'
export const OPPORTUNITY_OUTCOMES_FEATURE_FLAG = 'OPPORTUNITY_OUTCOMES_ENABLED'
export const OPPORTUNITY_OUTCOMES_UI_FEATURE_FLAG =
  'OPPORTUNITY_OUTCOMES_UI_ENABLED'
export const OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_FEATURE_FLAG =
  'OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED'
export const OPPORTUNITY_CANARY_OWNER_IDS_FEATURE_FLAG =
  'OPPORTUNITY_CANARY_OWNER_IDS'

export const OPPORTUNITY_ENGINE_LIMITS = {
  defaultPageSize: 20,
  maximumPageSize: 100,
  defaultJobBatchSize: 100,
  maximumJobBatchSize: 500,
  opportunityValidityDays: 21,
  defaultSnoozeDays: 7,
  maximumSnoozeDays: 90,
} as const

export function isOpportunityEngineV1Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OPPORTUNITY_ENGINE_FEATURE_FLAG] === 'true'
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

export function isOpportunityEngineV1EnabledForOwner(
  ownerId: string | number | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isOpportunityEngineV1Enabled(env) ||
    isOpportunityCanaryOwner(ownerId, env)
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
  const normalizedOwnerId = ownerId === null || ownerId === undefined
    ? ''
    : String(ownerId)
  if (!/^[1-9]\d*$/.test(normalizedOwnerId)) return false

  const rawCanaryOwnerIds =
    env[OPPORTUNITY_CANARY_OWNER_IDS_FEATURE_FLAG] ?? ''
  if (rawCanaryOwnerIds.trim() === '') return false

  const candidates = rawCanaryOwnerIds
    .split(',')
    .map((candidate) => candidate.trim())

  return candidates.length === 1 &&
    /^[1-9]\d*$/.test(candidates[0]) &&
    candidates[0] === normalizedOwnerId
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

export function clampOpportunitySnoozeDays(value: number | undefined): number {
  if (!Number.isFinite(value)) return OPPORTUNITY_ENGINE_LIMITS.defaultSnoozeDays
  return Math.min(
    Math.max(Math.trunc(value as number), 1),
    OPPORTUNITY_ENGINE_LIMITS.maximumSnoozeDays,
  )
}
