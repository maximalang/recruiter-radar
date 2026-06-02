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
export type { EvidenceTier }

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
  reasons: {
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

function computeFit(
  company: FiurCompany,
  vacancies: FiurVacancy[],
  profile: FiurClientProfile,
  overrides?: FiurClientOverrides,
  marketConditions?: 'boom' | 'bust' | 'neutral'
): { score: number; reasons: string[] } {
  const reasons: string[] = []

  if (isExcluded(company, profile)) {
    return {
      score: 0,
      reasons: [`company industry "${company.industry ?? ''}" is excluded by ICP`],
    }
  }

  let score = 0

  const industries = profile.industries.map(normalize)
  const companyIndustryKey = company.industry ? normalize(company.industry) : ''
  if (companyIndustryKey && industries.length > 0) {
    if (industries.includes(companyIndustryKey)) {
      // Apply industry penalty if override exists (3+ badfits recorded)
      // Penalty clamped to min 0.3 so industry never fully zeroed out
      const rawPenalty = overrides?.industryFitPenalty?.[companyIndustryKey]
      const penalty = rawPenalty != null ? clamp01(rawPenalty, 0.3) : 1.0
      const industryScore = penalty < 1
        ? clamp01(0.35 * penalty)
        : 0.35
      score += industryScore
      if (penalty != null && penalty < 1) {
        reasons.push(`industry "${company.industry}" matches ICP (reweighted by ${Math.round((1 - penalty) * 100)}% badfit history)`)
      } else {
        reasons.push(`industry "${company.industry}" matches ICP`)
      }
    } else {
      reasons.push(`industry "${company.industry}" outside ICP`)
    }
  }

  const profileRoles = profile.roles.map(normalize)
  if (profileRoles.length > 0 && vacancies.length > 0) {
    const matched = vacancies.filter((v) => profileRoles.includes(normalize(v.role)))
    if (matched.length > 0) {
      score += 0.3
      reasons.push(`${matched.length} vacancy/role match ICP`)
    } else {
      reasons.push('no role match between vacancies and ICP')
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
      reasons.push('location matches ICP')
    } else {
      reasons.push(`region "${company.location ?? '-'}" outside ICP`)
    }
  }

  if (profile.companySizes && profile.companySizes.length > 0 && company.size) {
    if (profile.companySizes.includes(company.size)) {
      score += 0.15
      reasons.push(`company size "${company.size}" matches ICP`)
    }
  } else if (isSmbSweetSpot(company)) {
    score += 0.1
    const detail = typeof company.employeeCount === 'number'
      ? `${company.employeeCount} employees`
      : `size "${company.size}"`
    reasons.push(
      `SMB sweet spot (${detail}, 50–500 employees) — optimal agency budget`
    )
  }

  // Market context — additive ±0.1 adjustment to fit
  if (marketConditions === 'boom') {
    score += 0.1
    reasons.push('high market demand increases lead fit value')
  } else if (marketConditions === 'bust') {
    score -= 0.1
    reasons.push('low market demand reduces lead fit value')
  }

  return { score: clamp01(score), reasons }
}

function computeIntent(
  vacancies: FiurVacancy[],
  evidence: FiurEvidenceItem[],
  now: number
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  if (vacancies.length === 0) {
    return { score: 0, reasons: ['no vacancies — no hiring intent'] }
  }

  const realRoles = vacancies.filter((v) => !v.isInternalRecruiter)
  const internalOnly = realRoles.length === 0

  if (internalOnly) {
    reasons.push(
      'only internal recruiter vacancies — does not count as hiring intent per product rules'
    )
    return { score: 0.05, reasons }
  }

  let score = 0

  const freshness =
    realRoles.reduce((acc, v) => acc + freshnessWeight(ageDays(v.publishedAt, now)), 0) /
    realRoles.length
  if (freshness > 0.6) {
    score += 0.3
    reasons.push('fresh hiring signals (≤ a few weeks old)')
  } else if (freshness > 0.2) {
    score += 0.15
    reasons.push('partially fresh hiring signals')
  } else {
    reasons.push('hiring signals are stale (older than ~60 days)')
  }

  const directVac = realRoles.some((v) => v.sourceTier === 'direct')
  if (directVac) {
    score += 0.25
    reasons.push('direct company surface confirms vacancy')
  }

  const directEvidence = evidence.filter((e) => e.tier === 'direct').length
  const corroboration = evidence.filter((e) => e.tier === 'corroboration').length
  if (directEvidence >= 1 && corroboration >= 1) {
    score += 0.3
    reasons.push('direct evidence corroborated by independent source')
  } else if (directEvidence >= 1) {
    score += 0.2
    reasons.push('direct evidence present')
  } else if (corroboration >= 2) {
    score += 0.15
    reasons.push('multiple corroborating sources')
  }

  if (realRoles.length >= 3) {
    score += 0.15
    reasons.push(`multiple open roles (${realRoles.length}) suggest active hiring`)
  }

  if (realRoles.length >= 2) {
    const mix = summarizeRoleMix(realRoles.map((v) => v.role))
    if (mix.nonTechCount >= 2 && mix.nonTechShare >= 0.5) {
      score += 0.1
      reasons.push(
        `non-tech role mix (${mix.nonTechCount}/${mix.total}) — outsourcing-likely roles strengthen the lead`
      )
    }
  }

  // Source diversity — independent sources boost confidence in hiring intent
  const uniqueSources = new Set(evidence.map(e => e.source))
  if (uniqueSources.size >= 3) {
    score += 0.1
    reasons.push(`${uniqueSources.size} independent sources increase intent confidence`)
  } else if (uniqueSources.size >= 2) {
    score += 0.05
    reasons.push('2 independent sources strengthen intent')
  }

  return { score: clamp01(score), reasons }
}

function computeUrgency(
  vacancies: FiurVacancy[],
  now: number,
  recentSignalCount?: number
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  if (vacancies.length === 0) {
    return { score: 0, reasons: ['no vacancies — no urgency signal'] }
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
    for (const reason of burst.reasons) reasons.push(reason)
  }

  const hardToFill = realRoles.filter((v) => v.isHardToFill).length
  if (hardToFill > 0) {
    score += 0.3
    reasons.push(`${hardToFill} hard-to-fill role(s) raise urgency`)
  }

  if (!burst.isBurst) {
    const freshHits = realRoles.filter((v) => ageDays(v.publishedAt, now) <= 14).length
    if (freshHits >= 2) {
      score += 0.2
      reasons.push('multiple fresh postings within 14 days')
    }
  }

  // Recent signal burst — high recent activity boosts urgency
  if (recentSignalCount != null && recentSignalCount >= 3) {
    score += 0.15
    reasons.push(`${recentSignalCount} recent hiring signals (last 7 days) indicate active urgency`)
  }

  return { score: clamp01(score), reasons }
}

function computeReachability(
  company: FiurCompany,
  evidence: FiurEvidenceItem[]
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  if (company.hasCareerPage) {
    score += 0.4
    reasons.push('career page available — direct hiring contact path')
  }
  if (company.hasCorporateContactPath) {
    score += 0.4
    reasons.push('corporate HR/contact path available')
  }
  const directEvidence = evidence.some((e) => e.tier === 'direct')
  if (directEvidence) {
    score += 0.2
    reasons.push('direct company surface in evidence')
  }
  if (score === 0) {
    reasons.push('no safe contact path found yet')
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
  }
}
