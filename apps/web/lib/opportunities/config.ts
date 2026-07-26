export const OPPORTUNITY_ENGINE_FEATURE_FLAG = 'OPPORTUNITY_ENGINE_V1_ENABLED'

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
