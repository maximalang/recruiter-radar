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
  freshCount: number
  reasons: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 14
const BURST_THRESHOLD = 3
// Postings inside this sub-window are "fresh" — a burst made of brand-new
// roles is a stronger urgency cue than one trailing the 14-day window.
const FRESH_DAYS = 3

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
      freshCount: 0,
      reasons: ['нет вакансий — нет всплеска найма'],
    }
  }

  const realRoles = input.vacancies.filter((v) => !v.isInternalRecruiter)
  if (realRoles.length === 0) {
    return {
      isBurst: false,
      score: 0,
      recentCount: 0,
      distinctRoles: 0,
      freshCount: 0,
      reasons: ['только вакансии внутреннего рекрутера — не считается всплеском найма'],
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
      freshCount: 0,
      reasons: [`нет публикаций за последние ${WINDOW_DAYS} дней`],
    }
  }

  const distinctRoles = new Set(recent.map((v) => normalizeRole(v.role))).size
  const freshCount = recent.filter((v) => ageDays(v.publishedAt, now) <= FRESH_DAYS).length
  const isBurst = recentCount >= BURST_THRESHOLD

  let score = 0

  if (isBurst) {
    score += 0.4
    reasons.push(`всплеск найма — ${recentCount} одновременных публикаций за последние ${WINDOW_DAYS} дней`)
  } else if (recentCount === 2) {
    score += 0.2
    reasons.push(`две одновременные публикации за последние ${WINDOW_DAYS} дней`)
  } else {
    reasons.push(`одна свежая публикация за последние ${WINDOW_DAYS} дней`)
  }

  if (isBurst && distinctRoles >= 3) {
    score += 0.3
    reasons.push(`разные роли — ${distinctRoles} уникальных ролей указывают на расширение нескольких направлений`)
  } else if (isBurst && distinctRoles === 2) {
    score += 0.15
    reasons.push(`нанимают на две разные роли`)
  }

  if (isBurst && recentCount >= 6) {
    score += 0.2
    reasons.push(`масштабный найм — ${recentCount} публикаций усиливают срочность`)
  }

  // Recency amplifier — applies to any multi-posting signal (burst or the
  // two-posting case). The +0.1 bump is calibrated so it can never push a
  // sub-threshold signal across the burst line: the two-posting ceiling is
  // 0.2 + 0.1 = 0.3, still inside [0, 0.4); a burst already starts at 0.4.
  // The [0, 0.4) vs [0.4, 1] non-burst/burst contract is preserved.
  if ((isBurst || recentCount === 2) && freshCount >= 2) {
    score += 0.1
    reasons.push(`${freshCount} публикаций за последние ${FRESH_DAYS} дня — очень свежая активность`)
  }

  return {
    isBurst,
    score: clamp01(score),
    recentCount,
    distinctRoles,
    freshCount,
    reasons,
  }
}
