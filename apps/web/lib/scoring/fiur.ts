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
  /**
   * Free-text ICP terms the agency specialises in (e.g. "IT, разработка").
   * Comma-separated; matched against company + vacancy text in computeFit.
   * Mirrors the public preview engine (lib/preview-relevance.ts).
   */
  specialization?: string
  /** Extra ICP keywords (industries / niches) matched as free text in computeFit. */
  includeKeywords?: string[]
  /**
   * Contact policy — gates Reachability. When restrictive (corporate_only /
   * no_personal) and the company exposes no corporate surface, the only
   * remaining paths are personal and the lead is effectively unreachable for
   * this agency, so Reachability is capped.
   */
  contactPolicy?: 'corporate_only' | 'no_personal' | 'unrestricted'
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

/**
 * Split a comma-separated free-text ICP field into normalised terms.
 * Mirrors lib/preview-relevance.ts splitTerms so the production scorer and
 * the public preview agree on how specialization / keywords are tokenised.
 */
function splitTerms(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim().toLocaleLowerCase('ru-RU'))
    .filter((item) => item !== '')
}

/** Normalise an array of keyword strings into non-empty lowercased terms. */
function normalizeTerms(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return []
  return values
    .map((v) => v.trim().toLocaleLowerCase('ru-RU'))
    .filter((v) => v !== '')
}

function anyTermMatches(haystack: string, terms: string[]): boolean {
  return terms.some((term) => haystack.includes(term))
}

/**
 * Build the lowercased free-text haystack for ICP term matching: company name,
 * industry, and every vacancy title/role. This is what specialization and
 * includeKeywords are matched against (the structured industry/role keys are
 * matched separately against the canonical taxonomy).
 */
function buildIcpHaystack(company: FiurCompany, vacancies: FiurVacancy[]): string {
  const parts: string[] = [company.name, company.industry ?? '']
  for (const v of vacancies) {
    parts.push(v.title, v.role)
  }
  return parts.join(' ').toLocaleLowerCase('ru-RU')
}

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

/**
 * Baseline exclusions applied to every profile regardless of its own list.
 *
 * Recruitment / staffing agencies are structural competitors: a recruitment
 * agency should never be handed *another* recruitment agency as a client lead.
 * These terms are normalised (lowercased) the same way profile exclusions are,
 * and matched as substrings against company name + industry.
 */
export const DEFAULT_COMPETITOR_EXCLUSIONS: readonly string[] = [
  'recruitment agency',
  'staffing agency',
  'staffing firm',
  'кадровое агентство',
  'рекрутинговое агентство',
  'агентство по подбору персонала',
  'аутстаффинг',
  'кадровое агенство', // common misspelling seen in the wild
]

type ExclusionHit =
  | { excluded: false }
  | { excluded: true; scope: 'profile' | 'competitor'; term: string }

function findExclusion(company: FiurCompany, profile: FiurClientProfile): ExclusionHit {
  const haystacks: string[] = [company.industry, company.name]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(normalize)
  if (haystacks.length === 0) return { excluded: false }

  // Profile-defined exclusions take precedence in reporting — they reflect an
  // explicit client decision and map to the established fit.industry.excluded key.
  for (const ex of profile.exclusions ?? []) {
    const n = normalize(ex)
    if (n.length > 0 && haystacks.some((h) => h.includes(n))) {
      return { excluded: true, scope: 'profile', term: ex }
    }
  }

  for (const ex of DEFAULT_COMPETITOR_EXCLUSIONS) {
    if (haystacks.some((h) => h.includes(ex))) {
      return { excluded: true, scope: 'competitor', term: ex }
    }
  }

  return { excluded: false }
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

  const exclusion = findExclusion(company, profile)
  if (exclusion.excluded) {
    const reasonKey =
      exclusion.scope === 'competitor' ? 'fit.competitor.excluded' : 'fit.industry.excluded'
    return {
      score: 0,
      reasons: [
        r('fit', reasonKey, {
          industry: company.industry ?? '',
          term: exclusion.term,
        }),
      ],
    }
  }

  let score = 0

  const industries = profile.industries.map(normalize)
  const companyIndustryKey = company.industry ? normalize(company.industry) : ''
  if (companyIndustryKey && industries.length > 0) {
    // Industry match supports partial (substring) overlap, not just exact key
    // equality — "fintech" in profile should match company industry
    // "fintech / payments". Exact match scores full weight; partial scores 60%.
    const exactMatch = industries.includes(companyIndustryKey)
    const partialMatch = !exactMatch && industries.some(
      (ind) => companyIndustryKey.includes(ind) || ind.includes(companyIndustryKey)
    )
    if (exactMatch || partialMatch) {
      const baseWeight = exactMatch ? 0.35 : 0.21 // 0.35 * 0.6 ≈ 0.21 for partial
      const rawPenalty = overrides?.industryFitPenalty?.[companyIndustryKey]
      const penalty = rawPenalty != null ? clamp01(rawPenalty, 0.3) : 1.0
      const industryScore = penalty < 1
        ? clamp01(baseWeight * penalty)
        : baseWeight
      score += industryScore
      if (penalty != null && penalty < 1) {
        reasons.push(r('fit', 'fit.industry.match.reweighted', {
          industry: company.industry ?? '',
          penaltyPercent: Math.round((1 - penalty) * 100),
        }))
      } else if (partialMatch) {
        reasons.push(r('fit', 'fit.industry.partial', { industry: company.industry ?? '' }))
      } else {
        reasons.push(r('fit', 'fit.industry.match', { industry: company.industry ?? '' }))
      }
    } else {
      reasons.push(r('fit', 'fit.industry.outside', { industry: company.industry ?? '-' }))
    }
  }

  const profileRoles = profile.roles.map(normalize)
  if (profileRoles.length > 0 && vacancies.length > 0) {
    // Weighted by the SHARE of vacancies that match the agency's roles, not a
    // binary has/hasn't. A company where every open role fits the agency is a
    // stronger lead than one with a single matching role among ten.
    const matched = vacancies.filter((v) => profileRoles.includes(normalize(v.role)))
    if (matched.length > 0) {
      const share = matched.length / vacancies.length
      score += 0.3 * share
      reasons.push(r('fit', 'fit.role.match', { count: matched.length }))
    } else {
      reasons.push(r('fit', 'fit.role.no-match'))
    }
  }

  // ICP free-text terms (specialization + includeKeywords) — the most
  // agency-specific signal. Matched against company + vacancy text, mirroring
  // the public preview engine (lib/preview-relevance.ts). Contributes up to
  // 0.2, split between the two dimensions the agency actually filled.
  const specializationTerms = splitTerms(profile.specialization)
  const includeTerms = normalizeTerms(profile.includeKeywords)
  if (specializationTerms.length > 0 || includeTerms.length > 0) {
    const haystack = buildIcpHaystack(company, vacancies)
    const dimensions: number[] = []
    if (specializationTerms.length > 0) {
      dimensions.push(anyTermMatches(haystack, specializationTerms) ? 1 : 0)
    }
    if (includeTerms.length > 0) {
      dimensions.push(anyTermMatches(haystack, includeTerms) ? 1 : 0)
    }
    const icpShare = dimensions.reduce((a, b) => a + b, 0) / dimensions.length
    if (icpShare > 0) {
      score += 0.2 * icpShare
      reasons.push(r('fit', 'fit.icp.match'))
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

/** Restrictive policies require a non-personal corporate surface to be reachable. */
const POLICY_REACH_CAP = 0.15

function computeReachability(
  company: FiurCompany,
  evidence: FiurEvidenceItem[],
  contactPolicy?: 'corporate_only' | 'no_personal' | 'unrestricted'
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

  // Contact-policy gate: a corporate_only / no_personal agency cannot use
  // personal routes. Without a corporate surface (career page or corporate HR
  // contact) the lead is effectively unreachable for them — cap Reachability so
  // it can never clear a confidence gate on a personal-only path.
  const restrictive = contactPolicy === 'corporate_only' || contactPolicy === 'no_personal'
  const hasCorporateSurface = Boolean(company.hasCareerPage || company.hasCorporateContactPath)
  if (restrictive && !hasCorporateSurface && score > POLICY_REACH_CAP) {
    score = POLICY_REACH_CAP
    reasons.push(r('reachability', 'reachability.policy-no-corporate', {
      policy: contactPolicy as string,
    }))
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
  const reachability = computeReachability(input.company, input.evidence, input.clientProfile.contactPolicy)

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
