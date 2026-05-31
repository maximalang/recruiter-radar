/**
 * Geographic fit scorer.
 *
 * Pure helper that compares a client agency's targeted geographies against a
 * company's declared locations and returns a 0..1 fit score with reasons.
 * Feeds Fit in FIUR for ICP Match scoring.
 *
 * Tiers (best wins):
 *   excluded → 0.0 (hard zero, takes precedence)
 *   anywhere → 1.0 (profile says "any" or remoteFriendly + company has any location)
 *   city     → 1.0 (exact city/region label match)
 *   region   → 0.6 (broader-region containment, e.g. profile "Россия", company "Москва")
 *   none     → 0.0
 */

export interface GeographicFitInput {
  targetGeographies: string[]
  excludedGeographies?: string[]
  companyLocations: string[]
  remoteFriendly?: boolean
}

export type GeographicMatch = 'city' | 'region' | 'anywhere' | 'excluded' | 'none'

export interface GeographicFitResult {
  score: number
  match: GeographicMatch
  reasons: string[]
}

const ANYWHERE_TOKENS = new Set([
  'anywhere',
  'any',
  'remote',
  'global',
  'worldwide',
  'любая',
  'удалённо',
  'удаленно',
])

const REGION_GROUPS: string[][] = [
  [
    'россия',
    'russia',
    'rf',
    'рф',
    'москва',
    'санкт-петербург',
    'спб',
    'новосибирск',
    'екатеринбург',
    'казань',
    'нижний новгород',
    'самара',
    'ростов-на-дону',
    'краснодар',
    'воронеж',
    'уфа',
    'пермь',
    'красноярск',
    'челябинск',
    'омск',
    'волгоград',
    'krasnodar',
  ],
  ['беларусь', 'belarus', 'минск', 'minsk'],
  ['казахстан', 'kazakhstan', 'алматы', 'almaty', 'астана', 'astana', 'нур-султан'],
  ['украина', 'ukraine', 'киев', 'kyiv', 'kiev'],
  ['eu', 'europe', 'germany', 'berlin', 'munich', 'france', 'paris', 'spain', 'madrid'],
  ['us', 'usa', 'united states', 'new york', 'san francisco', 'sf', 'la', 'los angeles'],
  ['cis', 'снг'],
]

const REGION_INDEX = buildRegionIndex(REGION_GROUPS)

function buildRegionIndex(groups: string[][]): Map<string, Set<string>> {
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

function shareRegion(a: string, b: string): boolean {
  const set = REGION_INDEX.get(a)
  if (!set) return false
  return set.has(b)
}

export function computeGeographicFit(input: GeographicFitInput): GeographicFitResult {
  const targets = normalizeAll(input.targetGeographies)
  const excluded = normalizeAll(input.excludedGeographies ?? [])
  const companies = normalizeAll(input.companyLocations)

  const reasons: string[] = []

  for (const c of companies) {
    if (excluded.includes(c)) {
      reasons.push(`location "${c}" is excluded by client profile`)
      return { score: 0, match: 'excluded', reasons }
    }
  }

  const hasAnywhereTarget = targets.some((t) => ANYWHERE_TOKENS.has(t))
  if ((hasAnywhereTarget || input.remoteFriendly) && companies.length > 0) {
    reasons.push('client accepts any location or company is remote-friendly')
    return { score: 1, match: 'anywhere', reasons }
  }

  if (targets.length === 0 || companies.length === 0) {
    return { score: 0, match: 'none', reasons }
  }

  for (const t of targets) {
    if (companies.includes(t)) {
      reasons.push(`location "${t}" matches client target exactly`)
      return { score: 1, match: 'city', reasons }
    }
  }

  for (const t of targets) {
    for (const c of companies) {
      if (shareRegion(t, c)) {
        reasons.push(`location "${c}" is within client target region "${t}"`)
        return { score: 0.6, match: 'region', reasons }
      }
    }
  }

  return { score: 0, match: 'none', reasons }
}
