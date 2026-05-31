/**
 * Hiring burst detection — surfaces a spike of concurrent hiring activity.
 *
 * Burst is a behavioural signal (not a count threshold): a company that
 * posts 3+ real roles inside the last 14 days is actively hiring. Role
 * diversity sharpens the signal — distinct departments hiring at once
 * is a stronger urgency cue than the same team posting the same role.
 *
 * Internal-recruiter vacancies are ignored per product rules: a company
 * hiring its own recruiter is not a hot lead by itself (docs/product.md §FIUR).
 */

export interface BurstVacancy {
  id: string
  role: string
  publishedAt: string
  isInternalRecruiter?: boolean
}

export interface BurstInput {
  vacancies: BurstVacancy[]
  now?: () => number
}

export interface BurstResult {
  isBurst: boolean
  score: number
  recentCount: number
  distinctRoles: number
  reasons: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 14
const BURST_THRESHOLD = 3

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

const normalizeRole = (role: string): string => role.trim().toLowerCase()

function ageDays(publishedAt: string, now: number): number {
  const t = Date.parse(publishedAt)
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY
  return Math.max(0, (now - t) / DAY_MS)
}

export function detectHiringBurst(input: BurstInput): BurstResult {
  const now = (input.now ?? Date.now)()
  const reasons: string[] = []

  if (input.vacancies.length === 0) {
    return {
      isBurst: false,
      score: 0,
      recentCount: 0,
      distinctRoles: 0,
      reasons: ['no vacancies — no burst signal'],
    }
  }

  const realRoles = input.vacancies.filter((v) => !v.isInternalRecruiter)
  if (realRoles.length === 0) {
    return {
      isBurst: false,
      score: 0,
      recentCount: 0,
      distinctRoles: 0,
      reasons: ['only internal-recruiter vacancies — does not count as hiring burst'],
    }
  }

  const recent = realRoles.filter((v) => ageDays(v.publishedAt, now) <= WINDOW_DAYS)
  const recentCount = recent.length

  if (recentCount === 0) {
    return {
      isBurst: false,
      score: 0,
      recentCount: 0,
      distinctRoles: 0,
      reasons: [`no postings inside the ${WINDOW_DAYS}-day window`],
    }
  }

  const distinctRoles = new Set(recent.map((v) => normalizeRole(v.role))).size
  const isBurst = recentCount >= BURST_THRESHOLD

  let score = 0

  if (isBurst) {
    score += 0.4
    reasons.push(`hiring burst — ${recentCount} concurrent postings in the last ${WINDOW_DAYS} days`)
  } else if (recentCount === 2) {
    score += 0.2
    reasons.push(`two concurrent postings in the last ${WINDOW_DAYS} days`)
  } else {
    reasons.push(`single recent posting in the last ${WINDOW_DAYS} days`)
  }

  if (isBurst && distinctRoles >= 3) {
    score += 0.3
    reasons.push(`role diversity — ${distinctRoles} distinct roles suggest cross-department expansion`)
  } else if (isBurst && distinctRoles === 2) {
    score += 0.15
    reasons.push(`two distinct roles being hired`)
  }

  if (isBurst && recentCount >= 6) {
    score += 0.2
    reasons.push(`large-scale hiring — ${recentCount} postings amplifies urgency`)
  }

  return {
    isBurst,
    score: clamp01(score),
    recentCount,
    distinctRoles,
    reasons,
  }
}
