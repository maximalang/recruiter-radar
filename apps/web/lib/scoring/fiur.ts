/**
 * FIUR scoring — explainable prioritisation per docs/product.md §FIUR.
 *
 * Total Score = Fit + Intent + Urgency + Reachability
 *
 * Each component is clamped to [0, 1], so Total ∈ [0, 4].
 * The additive form is the product-contract source of truth (docs/product.md);
 * CLAUDE.md still lists a weighted form (0.30/0.35/0.20/0.15) — discrepancy
 * resolved in favour of product.md per docs/plan.md v2.0 §Риски-1.
 */

import type { EvidenceTier } from '@/lib/db/evidence'
import { detectHiringBurst } from '@/lib/scoring/hiring-burst'
import { summarizeRoleMix } from '@/lib/scoring/role-category'
import { formatReason, type ScoringReason, type FiurComponent } from '@/lib/scoring/scoring-reasons'
export type { EvidenceTier }
export type { ScoringReason, FiurComponent }

/**
 * The minimal evidence shape FIUR scoring reads. Structurally a subset
 * of EvidenceItemInput from lib/db/evidence — callers may pass full
 * evidence records here without adapters.
 */
export interface FiurEvidenceItem {
  tier: EvidenceTier
  source: string
}

export interface FiurVacancy {
  id: string
  title: string
  role: string
  location?: string
  publishedAt: string
  isInternalRecruiter?: boolean
  isHardToFill?: boolean
  sourceTier?: EvidenceTier
}

export interface FiurCompany {
  id: string
  name: string
  industry?: string
  location?: string
  size?: 'startup' | 'small' | 'medium' | 'large' | 'enterprise'
  employeeCount?: number
  hasCareerPage?: boolean
  hasCorporateContactPath?: boolean
}

export interface FiurClientProfile {
  industries: string[]
  roles: string[]
  locations: string[]
  companySizes?: Array<'startup' | 'small' | 'medium' | 'large' | 'enterprise'>
  exclusions?: string[]
}

/**
 * Minimal client-side reweighting overrides derived from badfit history.
 * Filled by the pipeline when 3+ badfits are recorded for a pattern.
 * Stored client-side; not persisted in digest_candidates table.
 */
export interface FiurClientOverrides {
  /**
   * Industry → penalty multiplier (0.3–1.0).
   * e.g. { 'fintech': 0.5 } halves the industry fit contribution.
   */
  industryFitPenalty?: Record<string, number>
}

export interface FiurInput {
  company: FiurCompany
  vacancies: FiurVacancy[]
  clientProfile: FiurClientProfile
  evidence: FiurEvidenceItem[]
  /** Optional clock injection for tests. */
  now?: () => number
  /** Optional reweighting overrides from badfit history. */
  clientOverrides?: FiurClientOverrides
  /** Market context — additive ±0.1 to fit component. */
  marketConditions?: 'boom' | 'bust' | 'neutral'
  /** Count of recent hiring signals (last 7 days). Used for urgency boost. */
  recentSignalCount?: number
}

export interface FiurBreakdown {
  fit: number
  intent: number
  urgency: number
  reachability: number
  total: number
  /** Structured reasons — typed, localisable. Use formatReason() for display. */
  reasons: {
    fit: ScoringReason[]
    intent: ScoringReason[]
    urgency: ScoringReason[]
    reachability: ScoringReason[]
  }
  /** Convenience: all reasons as Russian strings. */
  reasonStrings: {
    fit: string[]
    intent: string[]
    urgency: string[]
    reachability: string[]
  }
}

/** Clamp to [min, 1]. Default min=0 → standard [0, 1] clamp. `min` is used by industry-fit penalty (min 0.3 so industry contribution never fully zeroed). */
const clamp01 = (n: number, min = 0): number => Math.max(min, n < 0 ? 0 : n > 1 ? 1 : n)

const normalize = (s: string): string => s.trim().toLowerCase()

const DAY_MS = 24 * 60 * 60 * 1000

function ageDays(publishedAt: string, now: number): number {
  const t = Date.parse(publishedAt)
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY
  return Math.max(0, (now - t) / DAY_MS)
}

function freshnessWeight(days: number): number {
  if (days <= 7) return 1
  if (days >= 60) return 0
  // linear decay between 7 and 60 days
  return 1 - (days - 7) / (60 - 7)
}

function isExcluded(company: FiurCompany, profile: FiurClientProfile): boolean {
  if (!profile.exclusions || profile.exclusions.length === 0) return false
  const haystacks: string[] = [company.industry, company.name]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(normalize)
  return profile.exclusions.some((ex) => {
    const n = normalize(ex)
    return haystacks.some((h) => h.includes(n))
  })
}

const SMB_MIN_EMPLOYEES = 50
const SMB_MAX_EMPLOYEES = 500

function isSmbSweetSpot(company: FiurCompany): boolean {
  if (typeof company.employeeCount === 'number') {
    return company.employeeCount >= SMB_MIN_EMPLOYEES && company.employeeCount <= SMB_MAX_EMPLOYEES
  }
  return company.size === 'small' || company.size === 'medium'
}

type ComponentResult = { score: number; reasons: ScoringReason[] }

function r(component: FiurComponent, key: string, params?: Record<string, string | number>): ScoringReason {
  return { component, key, params }
}

function computeFit(
  company: FiurCompany,
  vacancies: FiurVacancy[],
  profile: FiurClientProfile,
  overrides?: FiurClientOverrides,
  marketConditions?: 'boom' | 'bust' | 'neutral'
): ComponentResult {
  const reasons: ScoringReason[] = []

  if (isExcluded(company, profile)) {
    return {
      score: 0,
      reasons: [r('fit', 'fit.industry.excluded', { industry: company.industry ?? '' })],
    }
  }

  let score = 0

  const industries = profile.industries.map(normalize)
  const companyIndustryKey = company.industry ? normalize(company.industry) : ''
  if (companyIndustryKey && industries.length > 0) {
    if (industries.includes(companyIndustryKey)) {
      const rawPenalty = overrides?.industryFitPenalty?.[companyIndustryKey]
      const penalty = rawPenalty != null ? clamp01(rawPenalty, 0.3) : 1.0
      const industryScore = penalty < 1
        ? clamp01(0.35 * penalty)
        : 0.35
      score += industryScore
      if (penalty != null && penalty < 1) {
        reasons.push(r('fit', 'fit.industry.match.reweighted', {
          industry: company.industry ?? '',
          penaltyPercent: Math.round((1 - penalty) * 100),
        }))
      } else {
        reasons.push(r('fit', 'fit.industry.match', { industry: company.industry ?? '' }))
      }
    } else {
      reasons.push(r('fit', 'fit.industry.outside', { industry: company.industry ?? '-' }))
    }
  }

  const profileRoles = profile.roles.map(normalize)
  if (profileRoles.length > 0 && vacancies.length > 0) {
    const matched = vacancies.filter((v) => profileRoles.includes(normalize(v.role)))
    if (matched.length > 0) {
      score += 0.3
      reasons.push(r('fit', 'fit.role.match', { count: matched.length }))
    } else {
      reasons.push(r('fit', 'fit.role.no-match'))
    }
  }

  const profileLocations = profile.locations.map(normalize)
  if (profileLocations.length > 0) {
    const companyLoc = company.location ? normalize(company.location) : ''
    const anyVacancyMatches = vacancies.some(
      (v) => v.location && profileLocations.includes(normalize(v.location))
    )
    const companyMatches = companyLoc && profileLocations.includes(companyLoc)
    if (companyMatches || anyVacancyMatches) {
      score += 0.2
      reasons.push(r('fit', 'fit.location.match'))
    } else {
      reasons.push(r('fit', 'fit.location.outside', { location: company.location ?? '-' }))
    }
  }

  if (profile.companySizes && profile.companySizes.length > 0 && company.size) {
    if (profile.companySizes.includes(company.size)) {
      score += 0.15
      reasons.push(r('fit', 'fit.size.match', { size: company.size }))
    }
  } else if (isSmbSweetSpot(company)) {
    score += 0.1
    const detail = typeof company.employeeCount === 'number'
      ? `${company.employeeCount} employees`
      : `size "${company.size}"`
    reasons.push(r('fit', 'fit.size.smb-sweet-spot', { detail }))
  }

  if (marketConditions === 'boom') {
    score += 0.1
    reasons.push(r('fit', 'fit.market.boom'))
  } else if (marketConditions === 'bust') {
    score -= 0.1
    reasons.push(r('fit', 'fit.market.bust'))
  }

  return { score: clamp01(score), reasons }
}

function computeIntent(
  vacancies: FiurVacancy[],
  evidence: FiurEvidenceItem[],
  now: number
): ComponentResult {
  const reasons: ScoringReason[] = []
  if (vacancies.length === 0) {
    return { score: 0, reasons: [r('intent', 'intent.no-vacancies')] }
  }

  const realRoles = vacancies.filter((v) => !v.isInternalRecruiter)
  const internalOnly = realRoles.length === 0

  if (internalOnly) {
    reasons.push(r('intent', 'intent.internal-recruiter-only'))
    return { score: 0.05, reasons }
  }

  let score = 0

  const freshness =
    realRoles.reduce((acc, v) => acc + freshnessWeight(ageDays(v.publishedAt, now)), 0) /
    realRoles.length
  if (freshness > 0.6) {
    score += 0.3
    reasons.push(r('intent', 'intent.fresh-signals'))
  } else if (freshness > 0.2) {
    score += 0.15
    reasons.push(r('intent', 'intent.partially-fresh'))
  } else {
    reasons.push(r('intent', 'intent.stale-signals'))
  }

  const directVac = realRoles.some((v) => v.sourceTier === 'direct')
  if (directVac) {
    score += 0.25
    reasons.push(r('intent', 'intent.direct-surface'))
  }

  const directEvidence = evidence.filter((e) => e.tier === 'direct').length
  const corroboration = evidence.filter((e) => e.tier === 'corroboration').length
  if (directEvidence >= 1 && corroboration >= 1) {
    score += 0.3
    reasons.push(r('intent', 'intent.direct-evidence.corroborated'))
  } else if (directEvidence >= 1) {
    score += 0.2
    reasons.push(r('intent', 'intent.direct-evidence.present'))
  } else if (corroboration >= 2) {
    score += 0.15
    reasons.push(r('intent', 'intent.multiple-corroborating'))
  }

  if (realRoles.length >= 3) {
    score += 0.15
    reasons.push(r('intent', 'intent.multiple-roles', { count: realRoles.length }))
  }

  if (realRoles.length >= 2) {
    const mix = summarizeRoleMix(realRoles.map((v) => v.role))
    if (mix.nonTechCount >= 2 && mix.nonTechShare >= 0.5) {
      score += 0.1
      reasons.push(r('intent', 'intent.non-tech-mix', {
        nonTech: mix.nonTechCount,
        total: mix.total,
      }))
    }
  }

  const uniqueSources = new Set(evidence.map(e => e.source))
  if (uniqueSources.size >= 3) {
    score += 0.1
    reasons.push(r('intent', 'intent.source-diversity.high', { count: uniqueSources.size }))
  } else if (uniqueSources.size >= 2) {
    score += 0.05
    reasons.push(r('intent', 'intent.source-diversity.medium'))
  }

  return { score: clamp01(score), reasons }
}

function computeUrgency(
  vacancies: FiurVacancy[],
  now: number,
  recentSignalCount?: number
): ComponentResult {
  const reasons: ScoringReason[] = []
  if (vacancies.length === 0) {
    return { score: 0, reasons: [r('urgency', 'urgency.no-vacancies')] }
  }

  const realRoles = vacancies.filter((v) => !v.isInternalRecruiter)
  let score = 0

  const burst = detectHiringBurst({
    vacancies: vacancies.map((v) => ({
      id: v.id,
      role: v.role,
      publishedAt: v.publishedAt,
      isInternalRecruiter: v.isInternalRecruiter,
    })),
    now: () => now,
  })
  if (burst.score > 0) {
    score += burst.score * 0.6
    // Burst reasons come from hiring-burst detector — wrap as urgency reasons
    for (const reason of burst.reasons) {
      reasons.push(r('urgency', 'urgency.burst', { details: reason }))
    }
  }

  const hardToFill = realRoles.filter((v) => v.isHardToFill).length
  if (hardToFill > 0) {
    score += 0.3
    reasons.push(r('urgency', 'urgency.hard-to-fill', { count: hardToFill }))
  }

  if (!burst.isBurst) {
    const freshHits = realRoles.filter((v) => ageDays(v.publishedAt, now) <= 14).length
    if (freshHits >= 2) {
      score += 0.2
      reasons.push(r('urgency', 'urgency.fresh-postings'))
    }
  }

  // Stale role penalty
  const roleGroups = new Map<string, FiurVacancy[]>()
  for (const v of realRoles) {
    const key = normalize(v.role)
    if (!roleGroups.has(key)) roleGroups.set(key, [])
    roleGroups.get(key)!.push(v)
  }

  let staleRoleCount = 0
  for (const [, group] of roleGroups) {
    if (group.length < 2) continue
    const newest = group.reduce((a, b) =>
      ageDays(a.publishedAt, now) < ageDays(b.publishedAt, now) ? a : b
    )
    if (ageDays(newest.publishedAt, now) > 30) {
      staleRoleCount++
    }
  }

  if (staleRoleCount >= 2) {
    const penalty = Math.min(staleRoleCount * 0.1, 0.3)
    score -= penalty
    reasons.push(r('urgency', 'urgency.stale-role-repeated', { count: staleRoleCount }))
  } else if (staleRoleCount === 1) {
    score -= 0.05
    reasons.push(r('urgency', 'urgency.stale-role-single'))
  }

  if (recentSignalCount != null && recentSignalCount >= 3) {
    score += 0.15
    reasons.push(r('urgency', 'urgency.recent-signal-burst', { count: recentSignalCount }))
  }

  return { score: clamp01(score), reasons }
}

function computeReachability(
  company: FiurCompany,
  evidence: FiurEvidenceItem[]
): ComponentResult {
  const reasons: ScoringReason[] = []
  let score = 0

  if (company.hasCareerPage) {
    score += 0.4
    reasons.push(r('reachability', 'reachability.career-page'))
  }
  if (company.hasCorporateContactPath) {
    score += 0.4
    reasons.push(r('reachability', 'reachability.corporate-contact'))
  }
  const directEvidence = evidence.some((e) => e.tier === 'direct')
  if (directEvidence) {
    score += 0.2
    reasons.push(r('reachability', 'reachability.direct-surface'))
  }
  if (score === 0) {
    reasons.push(r('reachability', 'reachability.no-path'))
  }
  return { score: clamp01(score), reasons }
}

export function computeFiur(input: FiurInput): FiurBreakdown {
  const now = (input.now ?? Date.now)()
  const fit = computeFit(input.company, input.vacancies, input.clientProfile, input.clientOverrides, input.marketConditions)
  const intent = computeIntent(input.vacancies, input.evidence, now)
  const urgency = computeUrgency(input.vacancies, now, input.recentSignalCount)
  const reachability = computeReachability(input.company, input.evidence)

  return {
    fit: fit.score,
    intent: intent.score,
    urgency: urgency.score,
    reachability: reachability.score,
    total: fit.score + intent.score + urgency.score + reachability.score,
    reasons: {
      fit: fit.reasons,
      intent: intent.reasons,
      urgency: urgency.reasons,
      reachability: reachability.reasons,
    },
    reasonStrings: {
      fit: fit.reasons.map(formatReason),
      intent: intent.reasons.map(formatReason),
      urgency: urgency.reasons.map(formatReason),
      reachability: reachability.reasons.map(formatReason),
    },
  }
}
