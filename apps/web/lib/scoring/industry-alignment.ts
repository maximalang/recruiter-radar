/**
 * Industry alignment scorer.
 *
 * Pure helper that compares a client agency's targeted industries against a
 * company's declared industries and returns a 0..1 alignment score with
 * explainable reasons. Feeds Fit in FIUR for ICP Match scoring.
 *
 * Scoring:
 *   exact    — at least one industry matches → 1.0
 *   related  — at least one industry sits in the adjacency map → 0.6
 *   excluded — company touches a profile-excluded industry → 0.0 (hard zero)
 *   none     — no overlap → 0.0
 */

export interface IndustryAlignmentInput {
  targetIndustries: string[]
  excludedIndustries?: string[]
  companyIndustries: string[]
}

export type IndustryMatch = 'exact' | 'related' | 'partial' | 'none' | 'excluded'

export interface IndustryAlignmentResult {
  score: number
  match: IndustryMatch
  reasons: string[]
}

const RELATED_GROUPS: string[][] = [
  ['fintech', 'finance', 'banking', 'lending', 'payments', 'insurance', 'insurtech'],
  ['saas', 'software', 'tech', 'it', 'developer-tools'],
  ['edtech', 'education', 'e-learning'],
  ['ecommerce', 'retail', 'marketplace'],
  ['logistics', 'supply-chain', 'transport', 'delivery'],
  ['healthtech', 'health', 'medical', 'pharma', 'biotech'],
  ['hr-tech', 'recruiting', 'staffing'],
  ['martech', 'marketing', 'advertising', 'adtech'],
  ['real-estate', 'proptech', 'construction'],
  ['media', 'entertainment', 'gaming'],
  ['energy', 'utilities', 'oil-gas'],
  ['consulting', 'professional-services'],
]

const ADJACENCY = buildAdjacencyMap(RELATED_GROUPS)

function buildAdjacencyMap(groups: string[][]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const group of groups) {
    const set = new Set(group)
    for (const item of group) map.set(item, set)
  }
  return map
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeAll(values: string[]): string[] {
  return values.map(normalize).filter((v) => v.length > 0)
}

function isRelated(target: string, candidate: string): boolean {
  if (target === candidate) return true
  const set = ADJACENCY.get(target)
  if (!set) return false
  return set.has(candidate)
}

export function computeIndustryAlignment(
  input: IndustryAlignmentInput
): IndustryAlignmentResult {
  const targets = normalizeAll(input.targetIndustries)
  const excluded = normalizeAll(input.excludedIndustries ?? [])
  const companies = normalizeAll(input.companyIndustries)

  const reasons: string[] = []

  for (const c of companies) {
    if (excluded.includes(c)) {
      reasons.push(`industry "${c}" is excluded by client profile`)
      return { score: 0, match: 'excluded', reasons }
    }
  }

  if (targets.length === 0 || companies.length === 0) {
    return { score: 0, match: 'none', reasons }
  }

  for (const t of targets) {
    if (companies.includes(t)) {
      reasons.push(`industry "${t}" matches client target exactly`)
      return { score: 1, match: 'exact', reasons }
    }
  }

  for (const t of targets) {
    for (const c of companies) {
      if (isRelated(t, c)) {
        reasons.push(`industry "${c}" is related to target "${t}"`)
        return { score: 0.6, match: 'related', reasons }
      }
    }
  }

  return { score: 0, match: 'none', reasons }
}
