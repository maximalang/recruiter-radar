import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getExecFile } from '@/lib/lead-discovery/node-exec'
import { logError, logEvent } from '@/lib/runtime'
import {
  buildOpportunityScoringV3Job,
  type OpportunityScoringV3JobStats,
} from './opportunity-scoring-v3-job'
import {
  writeCommercialSignalOpportunities,
  type CommercialSignalOpportunityWriterStats,
} from './commercial-signal-opportunity-writer'
import {
  getCommercialSignalCanaryWorkspaceId,
  isCommercialSignalAuthoritativeForWorkspace,
} from './commercial-signal-rollout'

export type CommercialSignalEnrichmentJobOptions = {
  workspaceId?: string | number | null
  limit?: number
  now?: Date
  env?: Readonly<Record<string, string | undefined>>
}

export type CommercialSignalEnrichmentWorkerStats = {
  workspaceId: string
  scanned: number
  completed: number
  blocked: number
  retried: number
  careerPagesFound: number
  contactPathsFound: number
  evidenceWritten: number
  organizationIds: string[]
  rescoringOrganizationIds: string[]
  failures: Array<{
    queueId: string
    organizationId: string
    reasonCode: string
  }>
}

export type CommercialSignalEnrichmentJobStats = {
  workspaceId: string
  worker: CommercialSignalEnrichmentWorkerStats
  rescoring: Array<{
    organizationId: string
    stats: OpportunityScoringV3JobStats
  }>
  writer: CommercialSignalOpportunityWriterStats
  failedRescores: number
}

export class CommercialSignalEnrichmentScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommercialSignalEnrichmentScopeError'
  }
}

export class CommercialSignalEnrichmentExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommercialSignalEnrichmentExecutionError'
  }
}

let cachedScriptPath: string | null = null

/**
 * Processes only the exact-lineage enrichment queue. The worker visits company
 * owned http(s) surfaces through the repository's network-policy-aware crawler,
 * records only generic corporate contact paths/career pages, then reruns v3
 * scoring so a newly proven career surface can satisfy Actionability. It never
 * searches for or persists personal contacts.
 */
export async function runCommercialSignalEnrichmentJob(
  options: CommercialSignalEnrichmentJobOptions = {},
): Promise<CommercialSignalEnrichmentJobStats> {
  const env = options.env ?? process.env
  const configuredCanary = getCommercialSignalCanaryWorkspaceId(env)
  const workspaceId = options.workspaceId == null
    ? configuredCanary
    : positiveId(options.workspaceId, 'workspace')
  if (!workspaceId || workspaceId !== configuredCanary) {
    throw new CommercialSignalEnrichmentScopeError(
      'Enrichment is restricted to the single configured canary workspace.',
    )
  }
  if (!isCommercialSignalAuthoritativeForWorkspace(workspaceId, env)) {
    throw new CommercialSignalEnrichmentScopeError(
      'Commercial Signal enrichment requires an authoritative canary workspace.',
    )
  }

  const limit = boundedInteger(options.limit ?? 10, 1, 30, 'limit')
  const now = validDate(options.now ?? new Date())
  const worker = await runWorker({ workspaceId, limit, env })
  const rescoring: CommercialSignalEnrichmentJobStats['rescoring'] = []
  let failedRescores = 0

  for (const organizationId of worker.rescoringOrganizationIds) {
    try {
      const stats = await buildOpportunityScoringV3Job({
        enabled: true,
        workspaceId,
        organizationId,
        batchSize: 100,
        dryRun: false,
        now,
        rolloutMode: 'canary',
        env,
      })
      rescoring.push({ organizationId, stats })
      if (stats.failed > 0) failedRescores += 1
    } catch (error) {
      failedRescores += 1
      logError('commercial_signal.enrichment_rescore_failed', error, {
        workspaceId,
        organizationId,
      })
    }
  }

  if (failedRescores > 0) {
    throw new CommercialSignalEnrichmentExecutionError(
      `Commercial Signal enrichment rescoring failed for ${failedRescores} organization(s).`,
    )
  }

  const writer = await writeCommercialSignalOpportunities({
    workspaceId,
    batchSize: Math.min(Math.max(worker.rescoringOrganizationIds.length * 4, 20), 100),
    now,
    env,
  })
  if (writer.failed > 0) {
    throw new CommercialSignalEnrichmentExecutionError(
      `Commercial Signal enrichment writer failed for ${writer.failed} candidate(s).`,
    )
  }

  const result: CommercialSignalEnrichmentJobStats = {
    workspaceId,
    worker,
    rescoring,
    writer,
    failedRescores,
  }
  logEvent('commercial_signal.enrichment_completed', {
    workspaceId,
    scanned: worker.scanned,
    completed: worker.completed,
    blocked: worker.blocked,
    retried: worker.retried,
    careerPagesFound: worker.careerPagesFound,
    contactPathsFound: worker.contactPathsFound,
    evidenceWritten: worker.evidenceWritten,
    rescored: rescoring.length,
    materialized: writer.written,
  })
  return result
}

async function runWorker(input: {
  workspaceId: string
  limit: number
  env: Readonly<Record<string, string | undefined>>
}): Promise<CommercialSignalEnrichmentWorkerStats> {
  const execFile = getExecFile()
  const args = [
    getWorkerScriptPath(),
    '--workspace-id',
    input.workspaceId,
    '--limit',
    String(input.limit),
  ]
  const executionEnv: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(input.env)) {
    if (typeof value === 'string') executionEnv[key] = value
  }

  return await new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      args,
      {
        env: executionEnv,
        maxBuffer: 5 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const parsed = parseWorkerStats(stdout)
        if (error || !parsed) {
          reject(new CommercialSignalEnrichmentExecutionError(
            sanitizeError(stderr || error?.message || 'Enrichment worker failed.'),
          ))
          return
        }
        resolvePromise(parsed)
      },
    )
  })
}

function getWorkerScriptPath(): string {
  if (cachedScriptPath) return cachedScriptPath
  if (import.meta.url.startsWith('file:')) {
    cachedScriptPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/db/scripts/process-commercial-signal-enrichment.mjs',
    )
  } else {
    cachedScriptPath = resolve(
      process.cwd(),
      '../../packages/db/scripts/process-commercial-signal-enrichment.mjs',
    )
  }
  return cachedScriptPath
}

function parseWorkerStats(stdout: string): CommercialSignalEnrichmentWorkerStats | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]) as unknown
      const row = record(value)
      if (!Array.isArray(row.organizationIds) ||
          !Array.isArray(row.rescoringOrganizationIds) ||
          !Array.isArray(row.failures)) continue
      return {
        workspaceId: positiveId(row.workspaceId, 'workspace'),
        scanned: count(row.scanned),
        completed: count(row.completed),
        blocked: count(row.blocked),
        retried: count(row.retried),
        careerPagesFound: count(row.careerPagesFound),
        contactPathsFound: count(row.contactPathsFound),
        evidenceWritten: count(row.evidenceWritten),
        organizationIds: uniqueIds(row.organizationIds),
        rescoringOrganizationIds: uniqueIds(row.rescoringOrganizationIds),
        failures: row.failures.map((failure) => {
          const item = record(failure)
          return {
            queueId: positiveId(item.queueId, 'queue'),
            organizationId: positiveId(item.organizationId, 'organization'),
            reasonCode: safeReasonCode(item.reasonCode),
          }
        }),
      }
    } catch {
      // Ignore crawler diagnostics before the final JSON line.
    }
  }
  return null
}

function uniqueIds(values: unknown[]): string[] {
  return [...new Set(values.map((value) => positiveId(value, 'identifier')))]
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1)
}

function safeReasonCode(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]{0,119}$/.test(normalized)
    ? normalized
    : 'ENRICHMENT_FAILED'
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new CommercialSignalEnrichmentScopeError(
      `Invalid ${label} identifier.`,
    )
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
    throw new CommercialSignalEnrichmentScopeError(
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    )
  }
  return value
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new CommercialSignalEnrichmentScopeError('Invalid enrichment time.')
  }
  return new Date(value.getTime())
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
