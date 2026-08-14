import { getSourceConfig, type SourceId } from '@/lib/sources/source-registry'
import {
  getSourceSchedule,
  type SourceSchedule,
} from '@/lib/sources/source-schedules'
import type { IngestResult } from './source-ingest'

type SchedulerDb = {
  query: (...args: any[]) => Promise<any>
}

interface SchedulerStateRow {
  sourceId: SourceId
  nextEligibleRunAt: string | Date
  cooldownUntil: string | Date | null
  consecutiveFailures: number
}

export interface SupportingSourceSchedulerOptions {
  sources: readonly SourceId[]
  run: (source: SourceId) => Promise<IngestResult>
  db?: SchedulerDb | null
  env?: Readonly<Record<string, string | undefined>>
  inheritedEnv?: Readonly<Record<string, string | undefined>>
  now?: Date
  globalConcurrency?: number
  scheduleOverrides?: Partial<Record<SourceId, Partial<SourceSchedule>>>
}

class Semaphore {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
    this.active += 1
    return () => {
      this.active -= 1
      this.waiting.shift()?.()
    }
  }
}

function schedulerResult(source: SourceId, outcome: IngestResult['outcome']): IngestResult {
  return { source, success: true, outcome, fetchedCount: 0, upsertedCount: 0 }
}

function isRateLimited(result: IngestResult): boolean {
  const detail = `${result.error ?? ''}\n${result.log ?? ''}`
  return /(?:\b429\b|rate[-_ ]?limit|retry-after)/i.test(detail)
}

function asTimestamp(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

async function loadStates(
  db: SchedulerDb | null | undefined,
  sources: readonly SourceId[],
): Promise<Map<SourceId, SchedulerStateRow>> {
  if (!db || sources.length === 0) return new Map()
  const { rows } = await db.query(`
    SELECT
      source_id AS "sourceId",
      next_eligible_run_at AS "nextEligibleRunAt",
      cooldown_until AS "cooldownUntil",
      consecutive_failures AS "consecutiveFailures"
    FROM source_scheduler_state
    WHERE source_id = ANY($1::TEXT[])
  `, [sources])
  return new Map((rows as SchedulerStateRow[]).map((row) => [row.sourceId, row]))
}

async function persistState(args: {
  db: SchedulerDb | null | undefined
  source: SourceId
  schedule: SourceSchedule
  outcome: 'succeeded' | 'failed' | 'rate_limited' | 'credential_gated'
  attemptedAt: Date | null
  nextEligibleAt: Date
  cooldownUntil: Date | null
  consecutiveFailures: number
  succeeded: boolean
}): Promise<void> {
  if (!args.db) return
  await args.db.query(`
    INSERT INTO source_scheduler_state (
      source_id, host_key, expected_refresh_interval_seconds,
      next_eligible_run_at, cooldown_until, last_scheduler_outcome,
      last_attempt_at, last_success_at, consecutive_failures, updated_at
    ) VALUES ($1, $2, $3, $4::TIMESTAMPTZ, $5::TIMESTAMPTZ, $6,
      $7::TIMESTAMPTZ, CASE WHEN $8 THEN $7::TIMESTAMPTZ ELSE NULL END, $9, NOW())
    ON CONFLICT (source_id) DO UPDATE SET
      host_key = EXCLUDED.host_key,
      expected_refresh_interval_seconds = EXCLUDED.expected_refresh_interval_seconds,
      next_eligible_run_at = EXCLUDED.next_eligible_run_at,
      cooldown_until = EXCLUDED.cooldown_until,
      last_scheduler_outcome = EXCLUDED.last_scheduler_outcome,
      last_attempt_at = COALESCE(EXCLUDED.last_attempt_at, source_scheduler_state.last_attempt_at),
      last_success_at = COALESCE(EXCLUDED.last_success_at, source_scheduler_state.last_success_at),
      consecutive_failures = EXCLUDED.consecutive_failures,
      updated_at = NOW()
  `, [
    args.source,
    args.schedule.hostKey,
    Math.round(args.schedule.expectedRefreshIntervalMs / 1_000),
    args.nextEligibleAt.toISOString(),
    args.cooldownUntil?.toISOString() ?? null,
    args.outcome,
    args.attemptedAt?.toISOString() ?? null,
    args.succeeded,
    args.consecutiveFailures,
  ])
}

/** Run optional/context sources without turning expected skips or 429s into a failed daily pipeline. */
export async function runSupportingSourceScheduler(
  options: SupportingSourceSchedulerOptions,
): Promise<IngestResult[]> {
  const now = options.now ?? new Date()
  const nowMs = now.getTime()
  const inheritedEnv = options.inheritedEnv ?? process.env
  const suppliedEnv = options.env ?? {}
  const states = await loadStates(options.db, options.sources)
  const results = new Array<IngestResult>(options.sources.length)
  const runnable: Array<{ index: number; source: SourceId; schedule: SourceSchedule }> = []

  for (const [index, source] of options.sources.entries()) {
    const baseSchedule = getSourceSchedule(source)
    const schedule = { ...baseSchedule, ...options.scheduleOverrides?.[source] }
    const missingCredentials = getSourceConfig(source).requiredEnvVars.filter(
      (name) => !suppliedEnv[name] && !inheritedEnv[name],
    )
    if (missingCredentials.length > 0) {
      results[index] = schedulerResult(source, 'credential-gated')
      await persistState({
        db: options.db, source, schedule, outcome: 'credential_gated',
        attemptedAt: null, nextEligibleAt: new Date(nowMs + 60 * 60 * 1_000),
        cooldownUntil: null, consecutiveFailures: 0, succeeded: false,
      })
      continue
    }

    const state = states.get(source)
    const eligibleAt = Math.max(
      asTimestamp(state?.nextEligibleRunAt) ?? 0,
      asTimestamp(state?.cooldownUntil) ?? 0,
    )
    if (eligibleAt > nowMs) {
      results[index] = schedulerResult(source, 'deferred')
      continue
    }
    runnable.push({ index, source, schedule })
  }

  const globalSemaphore = new Semaphore(Math.max(1, options.globalConcurrency ?? 3))
  const hostSemaphores = new Map<string, Semaphore>()
  await Promise.all(runnable.map(async ({ index, source, schedule }) => {
    let hostSemaphore = hostSemaphores.get(schedule.hostKey)
    if (!hostSemaphore) {
      hostSemaphore = new Semaphore(Math.max(1, schedule.perHostConcurrency))
      hostSemaphores.set(schedule.hostKey, hostSemaphore)
    }
    const releaseHost = await hostSemaphore.acquire()
    const releaseGlobal = await globalSemaphore.acquire()
    try {
      const rawResult = await options.run(source)
      const previousFailures = states.get(source)?.consecutiveFailures ?? 0
      if (isRateLimited(rawResult)) {
        const cooldownUntil = new Date(nowMs + 6 * 60 * 60 * 1_000)
        results[index] = { ...rawResult, success: true, outcome: 'rate-limited' }
        await persistState({
          db: options.db, source, schedule, outcome: 'rate_limited',
          attemptedAt: now, nextEligibleAt: cooldownUntil, cooldownUntil,
          consecutiveFailures: previousFailures + 1, succeeded: false,
        })
      } else if (rawResult.success) {
        results[index] = rawResult
        await persistState({
          db: options.db, source, schedule, outcome: 'succeeded',
          attemptedAt: now,
          nextEligibleAt: new Date(nowMs + schedule.expectedRefreshIntervalMs),
          cooldownUntil: null, consecutiveFailures: 0, succeeded: true,
        })
      } else {
        const failures = previousFailures + 1
        const retryMs = Math.min(schedule.expectedRefreshIntervalMs, 15 * 60 * 1_000 * (2 ** Math.min(failures - 1, 5)))
        results[index] = rawResult
        await persistState({
          db: options.db, source, schedule, outcome: 'failed',
          attemptedAt: now, nextEligibleAt: new Date(nowMs + retryMs),
          cooldownUntil: null, consecutiveFailures: failures, succeeded: false,
        })
      }
    } finally {
      releaseGlobal()
      releaseHost()
    }
  }))

  return results
}
