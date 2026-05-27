/**
 * Career-page quality scorer.
 *
 * Pure helper that turns career-page signals into a 0..1 quality score with
 * explainable reasons. Quality feeds Reachability and source-tier confidence
 * in FIUR — a rich, fresh page with a real HR contact is much stronger
 * evidence than a stub URL.
 */

import type { ContactPath } from './contact-paths'

export interface CareerPageQualityInput {
  url?: string
  vacancyCount?: number
  contactPaths?: ContactPath[]
  lastModifiedAt?: string | Date | null
  fetchedAt?: string | Date
}

export interface CareerPageQualitySignals {
  hasPage: boolean
  hasVacancies: boolean
  vacancyCount: number
  hasHrContact: boolean
  contactPathCount: number
  freshnessDays: number | null
  isFresh: boolean
}

export interface CareerPageQuality {
  score: number
  signals: CareerPageQualitySignals
  reasons: string[]
}

const FRESH_THRESHOLD_DAYS = 90
const STALE_THRESHOLD_DAYS = 180

const MS_PER_DAY = 86_400_000

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

export function computeCareerPageQuality(input: CareerPageQualityInput): CareerPageQuality {
  const reasons: string[] = []

  const hasPage = typeof input.url === 'string' && input.url.length > 0
  const vacancyCount = Math.max(0, Math.floor(input.vacancyCount ?? 0))
  const hasVacancies = vacancyCount > 0

  const contactPaths = input.contactPaths ?? []
  const contactPathCount = contactPaths.length
  const hasHrContact = contactPaths.some(
    (p) => p.category === 'hr-email' || p.category === 'careers-email'
  )

  const lastModified = toDate(input.lastModifiedAt)
  const fetchedAt = toDate(input.fetchedAt) ?? new Date()
  const freshnessDays =
    lastModified === null
      ? null
      : Math.max(0, Math.floor((fetchedAt.getTime() - lastModified.getTime()) / MS_PER_DAY))
  const isFresh = freshnessDays !== null && freshnessDays <= FRESH_THRESHOLD_DAYS

  let score = 0

  if (hasPage) {
    score += 0.1
    reasons.push('career page exists')
  }

  const vacancyScore = Math.min(0.2, vacancyCount * 0.07)
  if (vacancyScore > 0) {
    score += vacancyScore
    reasons.push(`${vacancyCount} active vacanc${vacancyCount === 1 ? 'y' : 'ies'} listed`)
  }

  if (hasHrContact) {
    score += 0.3
    reasons.push('HR or careers contact path available')
  }

  const pathScore = Math.min(0.2, contactPathCount * 0.07)
  if (pathScore > 0) {
    score += pathScore
    if (contactPathCount >= 2) {
      reasons.push(`${contactPathCount} independent contact paths`)
    }
  }

  if (freshnessDays !== null) {
    if (freshnessDays <= 30) {
      score += 0.2
      reasons.push(`updated ${freshnessDays} days ago (fresh)`)
    } else if (freshnessDays <= FRESH_THRESHOLD_DAYS) {
      score += 0.15
      reasons.push(`updated ${freshnessDays} days ago (fresh)`)
    } else if (freshnessDays <= STALE_THRESHOLD_DAYS) {
      score += 0.1
      reasons.push(`updated ${freshnessDays} days ago`)
    } else if (freshnessDays <= 365) {
      score += 0.05
      reasons.push(`stale: ${freshnessDays} days since last update`)
    } else {
      reasons.push(`stale: ${freshnessDays} days since last update`)
    }
  }

  return {
    score: clamp01(score),
    signals: {
      hasPage,
      hasVacancies,
      vacancyCount,
      hasHrContact,
      contactPathCount,
      freshnessDays,
      isFresh,
    },
    reasons,
  }
}
