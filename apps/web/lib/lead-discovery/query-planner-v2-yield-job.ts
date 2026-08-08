import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getExecFile } from './node-exec'
import {
  getCommercialSignalCanaryWorkspaceId,
  isCommercialSignalAuthoritativeForWorkspace,
} from '@/lib/opportunities/commercial-signal-rollout'

export type QueryPlannerV2YieldJobOptions = {
  workspaceId?: string | number | null
  clientProfileId?: string | number | null
  windowDays?: number
  limit?: number
  env?: Readonly<Record<string, string | undefined>>
}

export type QueryPlannerV2YieldJobStats = {
  workspaceId: string
  clientProfileId: string | null
  measurementWindowStart: string
  measurementWindowEnd: string
  plansScanned: number
  snapshotsInserted: number
  snapshotsReplayed: number
  failures: Array<{
    planSnapshotId: string
    reasonCode: string
  }>
}

export class QueryPlannerV2YieldScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryPlannerV2YieldScopeError'
  }
}

export class QueryPlannerV2YieldExecutionError extends Error {
  readonly stats: QueryPlannerV2YieldJobStats | null

  constructor(message: string, stats: QueryPlannerV2YieldJobStats | null = null) {
    super(message)
    this.name = 'QueryPlannerV2YieldExecutionError'
    this.stats = stats
  }
}

let cachedScriptPath: string | null = null

export async function materializeQueryPlannerV2YieldJob(
  options: QueryPlannerV2YieldJobOptions = {},
): Promise<QueryPlannerV2YieldJobStats> {
  const env = options.env ?? process.env
  const canaryWorkspaceId = getCommercialSignalCanaryWorkspaceId(env)
  const workspaceId = options.workspaceId == null
    ? canaryWorkspaceId
    : positiveId(options.workspaceId, 'workspace')
  if (!workspaceId || workspaceId !== canaryWorkspaceId) {
    throw new QueryPlannerV2YieldScopeError(
      'Query-plan yield materialization is restricted to the configured canary workspace.',
    )
  }
  if (!isCommercialSignalAuthoritativeForWorkspace(workspaceId, env)) {
    throw new QueryPlannerV2YieldScopeError(
      'Query-plan yield materialization requires an authoritative Commercial Signal workspace.',
    )
  }
  const clientProfileId = options.clientProfileId == null
    ? null
    : positiveId(options.clientProfileId, 'client profile')
  const windowDays = integerBetween(options.windowDays ?? 30, 1, 180, 'windowDays')
  const limit = integerBetween(options.limit ?? 200, 1, 1000, 'limit')
  const args = [
    getScriptPath(),
    '--workspace-id', workspaceId,
    '--window-days', String(windowDays),
    '--limit', String(limit),
  ]
  if (clientProfileId) args.push('--client-profile-id', clientProfileId)

  const executionEnv: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') executionEnv[key] = value
  }
  const execFile = getExecFile()
  return await new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      args,
      { env: executionEnv, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const stats = parseStats(stdout)
        if (error || !stats || stats.failures.length > 0) {
          reject(new QueryPlannerV2YieldExecutionError(
            sanitizeError(
              stderr || error?.message || 'Query-plan yield materialization failed.',
            ),
            stats,
          ))
          return
        }
        resolvePromise(stats)
      },
    )
  })
}

function getScriptPath(): string {
  if (cachedScriptPath) return cachedScriptPath
  if (import.meta.url.startsWith('file:')) {
    cachedScriptPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/db/scripts/materialize-query-plan-yield-v2.mjs',
    )
  } else {
    cachedScriptPath = resolve(
      process.cwd(),
      '../../packages/db/scripts/materialize-query-plan-yield-v2.mjs',
    )
  }
  return cachedScriptPath
}

function parseStats(stdout: string): QueryPlannerV2YieldJobStats | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const row = record(JSON.parse(lines[index]) as unknown)
      if (!Array.isArray(row.failures)) continue
      return {
        workspaceId: positiveId(row.workspaceId, 'workspace'),
        clientProfileId: row.clientProfileId == null
          ? null
          : positiveId(row.clientProfileId, 'client profile'),
        measurementWindowStart: timestamp(row.measurementWindowStart),
        measurementWindowEnd: timestamp(row.measurementWindowEnd),
        plansScanned: count(row.plansScanned),
        snapshotsInserted: count(row.snapshotsInserted),
        snapshotsReplayed: count(row.snapshotsReplayed),
        failures: row.failures.map((failure) => {
          const item = record(failure)
          return {
            planSnapshotId: positiveId(item.planSnapshotId, 'plan snapshot'),
            reasonCode: reasonCode(item.reasonCode),
          }
        }),
      }
    } catch {
      // Ignore diagnostics before the final JSON line.
    }
  }
  return null
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new QueryPlannerV2YieldScopeError(`Invalid ${label} identifier.`)
  }
  return BigInt(normalized).toString()
}

function integerBetween(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new QueryPlannerV2YieldScopeError(
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    )
  }
  return value
}

function count(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function timestamp(value: unknown): string {
  const date = new Date(String(value ?? ''))
  if (!Number.isFinite(date.getTime())) {
    throw new QueryPlannerV2YieldExecutionError('Invalid metric timestamp.')
  }
  return date.toISOString()
}

function reasonCode(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]{0,119}$/.test(normalized)
    ? normalized
    : 'METRIC_MATERIALIZATION_FAILED'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sanitizeError(value: string): string {
  return value.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url]').trim().slice(0, 1000)
}
