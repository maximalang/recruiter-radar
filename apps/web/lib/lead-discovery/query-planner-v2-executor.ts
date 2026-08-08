import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getExecFile } from './node-exec'
import { isQueryPlannerV2Enabled } from './query-planner-v2-config'
import {
  isCommercialSignalAuthoritativeForWorkspace,
} from '@/lib/opportunities/commercial-signal-rollout'

export type QueryPlannerV2ExecutionOptions = {
  workspaceId: string | number
  clientProfileId?: string | number | null
  limit?: number
  dryRun?: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export type QueryPlannerV2ExecutionStats = {
  workspaceId: string
  clientProfileId: string | null
  dryRun: boolean
  requestsScanned: number
  requestsExecuted: number
  requestsBlocked: number
  requestsFailed: number
  staleExecutionsReconciled: number
  fetchedRecords: number
  uniqueCompanies: number
  signalUpserts: number
  evidenceWrites: number
  executionIds: string[]
  blocked: Array<{
    sharedRequestId: string
    source: string
    reasonCode: string
  }>
  failures: Array<{
    sharedRequestId: string
    source: string
    executionId: string | null
    reasonCode: string
  }>
}

export class QueryPlannerV2ExecutionScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryPlannerV2ExecutionScopeError'
  }
}

export class QueryPlannerV2SourceExecutionError extends Error {
  readonly stats: QueryPlannerV2ExecutionStats | null

  constructor(message: string, stats: QueryPlannerV2ExecutionStats | null = null) {
    super(message)
    this.name = 'QueryPlannerV2SourceExecutionError'
    this.stats = stats
  }
}

let cachedScriptPath: string | null = null

function getExecutorScriptPath(): string {
  if (cachedScriptPath) return cachedScriptPath
  const metaUrl = import.meta.url
  if (metaUrl && metaUrl.startsWith('file:')) {
    cachedScriptPath = resolve(
      dirname(fileURLToPath(metaUrl)),
      '../../../../packages/db/scripts/execute-query-planner-v2.mjs',
    )
  } else {
    cachedScriptPath = resolve(
      process.cwd(),
      '../../packages/db/scripts/execute-query-planner-v2.mjs',
    )
  }
  return cachedScriptPath
}

/**
 * Executes persisted Query Planner v2 shared requests through the source
 * adapter process. The child process owns exact source-execution provenance;
 * this bridge never reconstructs lineage from timestamps or fetched counts.
 */
export async function executeQueryPlannerV2Sources(
  options: QueryPlannerV2ExecutionOptions,
): Promise<QueryPlannerV2ExecutionStats> {
  const env = options.env ?? process.env
  const workspaceId = positiveId(options.workspaceId, 'workspace')
  const clientProfileId = options.clientProfileId == null
    ? null
    : positiveId(options.clientProfileId, 'client profile')
  if (!isQueryPlannerV2Enabled(env)) {
    return emptyStats(workspaceId, clientProfileId, options.dryRun === true)
  }
  if (!isCommercialSignalAuthoritativeForWorkspace(workspaceId, env)) {
    throw new QueryPlannerV2ExecutionScopeError(
      'Query Planner source execution is allowed only for an authoritative Commercial Signal workspace.',
    )
  }
  const limit = boundedInteger(options.limit ?? 20, 1, 50, 'limit')
  const args = [
    getExecutorScriptPath(),
    '--workspace-id',
    workspaceId,
    '--limit',
    String(limit),
  ]
  if (clientProfileId) args.push('--client-profile-id', clientProfileId)
  if (options.dryRun === true) args.push('--dry-run')

  const execFile = getExecFile()
  const executionEnv: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') executionEnv[key] = value
  }

  return await new Promise<QueryPlannerV2ExecutionStats>((resolvePromise, reject) => {
    execFile(
      process.execPath,
      args,
      {
        env: executionEnv,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const stats = parseExecutionStats(stdout)
        if (error || !stats) {
          reject(new QueryPlannerV2SourceExecutionError(
            sanitizeError(stderr || error?.message || 'Query Planner source executor failed.'),
            stats,
          ))
          return
        }
        if (stats.requestsFailed > 0) {
          reject(new QueryPlannerV2SourceExecutionError(
            `Query Planner source executor failed ${stats.requestsFailed} request(s).`,
            stats,
          ))
          return
        }
        resolvePromise(stats)
      },
    )
  })
}

function parseExecutionStats(stdout: string): QueryPlannerV2ExecutionStats | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const row = value as Record<string, unknown>
      if (!Array.isArray(row.executionIds) || !Array.isArray(row.blocked) ||
          !Array.isArray(row.failures)) continue
      return {
        workspaceId: positiveId(row.workspaceId, 'workspace'),
        clientProfileId: row.clientProfileId == null
          ? null
          : positiveId(row.clientProfileId, 'client profile'),
        dryRun: row.dryRun === true,
        requestsScanned: count(row.requestsScanned),
        requestsExecuted: count(row.requestsExecuted),
        requestsBlocked: count(row.requestsBlocked),
        requestsFailed: count(row.requestsFailed),
        staleExecutionsReconciled: count(row.staleExecutionsReconciled),
        fetchedRecords: count(row.fetchedRecords),
        uniqueCompanies: count(row.uniqueCompanies),
        signalUpserts: count(row.signalUpserts),
        evidenceWrites: count(row.evidenceWrites),
        executionIds: row.executionIds.map((id) => positiveId(id, 'execution')),
        blocked: row.blocked.map(parseBlocked),
        failures: row.failures.map(parseFailure),
      }
    } catch {
      // Source adapters may emit diagnostics before the final JSON line.
    }
  }
  return null
}

function parseBlocked(value: unknown): QueryPlannerV2ExecutionStats['blocked'][number] {
  const row = record(value)
  return {
    sharedRequestId: positiveId(row.sharedRequestId, 'shared request'),
    source: String(row.source ?? ''),
    reasonCode: reasonCode(row.reasonCode),
  }
}

function parseFailure(value: unknown): QueryPlannerV2ExecutionStats['failures'][number] {
  const row = record(value)
  return {
    sharedRequestId: positiveId(row.sharedRequestId, 'shared request'),
    source: String(row.source ?? ''),
    executionId: row.executionId == null
      ? null
      : positiveId(row.executionId, 'execution'),
    reasonCode: reasonCode(row.reasonCode),
  }
}

function reasonCode(value: unknown): string {
  const normalized = String(value ?? '').trim()
  if (!/^[A-Z][A-Z0-9_]{0,119}$/.test(normalized)) {
    return 'SOURCE_EXECUTION_FAILED'
  }
  return normalized
}

function emptyStats(
  workspaceId: string,
  clientProfileId: string | null,
  dryRun: boolean,
): QueryPlannerV2ExecutionStats {
  return {
    workspaceId,
    clientProfileId,
    dryRun,
    requestsScanned: 0,
    requestsExecuted: 0,
    requestsBlocked: 0,
    requestsFailed: 0,
    staleExecutionsReconciled: 0,
    fetchedRecords: 0,
    uniqueCompanies: 0,
    signalUpserts: 0,
    evidenceWrites: 0,
    executionIds: [],
    blocked: [],
    failures: [],
  }
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new QueryPlannerV2ExecutionScopeError(`Invalid ${label} identifier.`)
  }
  return BigInt(normalized).toString()
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new QueryPlannerV2ExecutionScopeError(
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    )
  }
  return value
}

function count(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sanitizeError(value: string): string {
  return value.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url]').trim().slice(0, 1000)
}
