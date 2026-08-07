export const QUERY_PLANNER_V2_FEATURE_FLAG = 'QUERY_PLANNER_V2_ENABLED'

export const QUERY_PLANNER_V2_LIMITS = {
  defaultProfileBatchSize: 25,
  maximumProfileBatchSize: 100,
  statementTimeoutMs: 15_000,
} as const

export function isQueryPlannerV2Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[QUERY_PLANNER_V2_FEATURE_FLAG] === 'true'
}

export function clampQueryPlannerV2ProfileBatchSize(value: number): number {
  if (!Number.isFinite(value)) {
    return QUERY_PLANNER_V2_LIMITS.defaultProfileBatchSize
  }
  return Math.min(
    Math.max(Math.trunc(value), 1),
    QUERY_PLANNER_V2_LIMITS.maximumProfileBatchSize,
  )
}
