/**
 * Lead freshness tracker.
 *
 * Pure helper that turns a list of evidence fetchedAt timestamps into a
 * single freshness category and SLA flag. Feeds Urgency in FIUR, dashboard
 * sorting, and TTL-driven re-enrichment decisions.
 *
 * SLA target: per SPEC, A/B leads must be delivered within 2 hours of the
 * triggering signal — `meetsSla` reflects whether the newest evidence is
 * still inside that window.
 */

export interface FreshnessInput {
  fetchedAt: string | Date
}

export interface FreshnessOptions {
  now?: Date | (() => number)
}

export type FreshnessStatus = 'fresh' | 'aging' | 'stale' | 'expired'

export interface FreshnessResult {
  newestAgeHours: number | null
  oldestAgeHours: number | null
  status: FreshnessStatus
  meetsSla: boolean
}

const MS_PER_HOUR = 3_600_000
const SLA_HOURS = 2
const FRESH_HOURS = 2
const AGING_HOURS = 24
const STALE_HOURS = 24 * 7

function resolveNow(now: FreshnessOptions['now']): number {
  if (now instanceof Date) return now.getTime()
  if (typeof now === 'function') return now()
  return Date.now()
}

function toMillis(value: string | Date): number | null {
  const d = value instanceof Date ? value : new Date(value)
  const t = d.getTime()
  return Number.isNaN(t) ? null : t
}

function classify(ageHours: number): FreshnessStatus {
  if (ageHours <= FRESH_HOURS) return 'fresh'
  if (ageHours <= AGING_HOURS) return 'aging'
  if (ageHours <= STALE_HOURS) return 'stale'
  return 'expired'
}

export function computeLeadFreshness(
  items: FreshnessInput[],
  options: FreshnessOptions = {}
): FreshnessResult {
  const nowMs = resolveNow(options.now)

  const ages: number[] = []
  for (const item of items) {
    const ms = toMillis(item.fetchedAt)
    if (ms === null) continue
    ages.push(Math.max(0, (nowMs - ms) / MS_PER_HOUR))
  }

  if (ages.length === 0) {
    return {
      newestAgeHours: null,
      oldestAgeHours: null,
      status: 'expired',
      meetsSla: false,
    }
  }

  const newestAgeHours = Math.min(...ages)
  const oldestAgeHours = Math.max(...ages)
  const status = classify(newestAgeHours)
  const meetsSla = newestAgeHours <= SLA_HOURS

  return { newestAgeHours, oldestAgeHours, status, meetsSla }
}
