/**
 * ICP-relevance scoring for the public landing preview.
 *
 * WHY this is NOT computeFiur(): the public preview operates on aggregated,
 * already-scored `HhDigestItem`s — they carry no structured vacancy roles,
 * per-vacancy publish dates, evidence tiers, or company industry/size. Running
 * the real FIUR engine here would require fabricating those inputs, producing
 * confident-looking but invented numbers. Instead we compute an honest
 * ICP-relevance signal from the fields the digest item actually exposes
 * (employer name, locations, source families, evidence titles, vacancy counts,
 * latest publish date) and map it onto the four FIUR axes for an explainable,
 * non-misleading breakdown. The public copy must say "оценка релевантности
 * вашему ICP", never "FIUR из движка".
 *
 * Mapping of preview input → ICP criteria:
 *   specialization  → roles / function the agency closes  (drives Fit + Intent)
 *   targetCity      → target geography                     (drives Fit)
 *   includeKeywords → industries / extra ICP terms         (drives Fit)
 *   excludeKeywords → hard exclusions                      (zeroes Fit, drops item)
 */

import type { HhDigestItem } from "./hhDigest"
import type { PublicPreviewInput } from "./publicProduct"
import { tryRecordProductEvent } from "./telemetry"

const DAY_MS = 24 * 60 * 60 * 1000

/** Per-axis relevance in [0, 1]; mirrors the FIUR axes for explainability. */
export type PreviewRelevanceSignals = {
  fit: number
  intent: number
  urgency: number
  reachability: number
}

export type PreviewRelevance = {
  /** Total ∈ [0, 4] — sum of the four axes. Used for ranking. */
  total: number
  signals: PreviewRelevanceSignals
  /** True when the item matched at least one include term (exact ICP hit). */
  isExactMatch: boolean
  /** True when an exclude term matched — item must be dropped entirely. */
  isExcluded: boolean
}

function splitTerms(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLocaleLowerCase("ru-RU"))
    .filter((item) => item !== "")
}

function buildHaystack(item: HhDigestItem): string {
  return [
    item.employer_name,
    ...item.reasons,
    item.opener,
    ...item.source_families,
    ...item.evidence_titles,
    ...item.location_names,
  ]
    .join(" ")
    .toLocaleLowerCase("ru-RU")
}

function anyTermMatches(haystack: string, terms: string[]): boolean {
  return terms.some((term) => haystack.includes(term))
}

/**
 * Fit — how well the company matches the agency ICP terms.
 * Each criterion the agency provided contributes a clamped share; an item that
 * hits every provided dimension reaches 1.0. We only divide by the criteria the
 * agency actually filled, so a sparse input is not unfairly penalised.
 */
function computeFitSignal(
  haystack: string,
  locationHaystack: string,
  specializationTerms: string[],
  cityTerms: string[],
  includeTerms: string[]
): number {
  const dimensions: number[] = []

  if (specializationTerms.length > 0) {
    dimensions.push(anyTermMatches(haystack, specializationTerms) ? 1 : 0)
  }
  if (cityTerms.length > 0) {
    // City is matched against location names first, falling back to the full
    // haystack (some samples mention the city only in evidence titles).
    const cityHit =
      anyTermMatches(locationHaystack, cityTerms) || anyTermMatches(haystack, cityTerms)
    dimensions.push(cityHit ? 1 : 0)
  }
  if (includeTerms.length > 0) {
    dimensions.push(anyTermMatches(haystack, includeTerms) ? 1 : 0)
  }

  if (dimensions.length === 0) return 0
  return dimensions.reduce((a, b) => a + b, 0) / dimensions.length
}

/**
 * Intent — relevant, fresh hiring activity. Approximated from vacancy volume,
 * role diversity, and how recently the latest signal was published. These are
 * real digest fields, not fabricated per-vacancy tiers.
 */
function computeIntentSignal(item: HhDigestItem, now: number): number {
  let score = 0

  if (item.vacancies_count >= 3) score += 0.35
  else if (item.vacancies_count >= 1) score += 0.2

  if (item.distinct_vacancy_names_count >= 3) score += 0.25
  else if (item.distinct_vacancy_names_count >= 2) score += 0.15

  const ageDays = freshnessDays(item.latest_published_at, now)
  if (ageDays <= 7) score += 0.4
  else if (ageDays <= 21) score += 0.2
  else if (ageDays <= 45) score += 0.1

  return clamp01(score)
}

/**
 * Urgency — burst / pressure proxy. A high vacancy-to-distinct-name ratio means
 * the same roles are being re-posted (repeated, hard-to-fill), and very recent
 * activity adds pressure.
 */
function computeUrgencySignal(item: HhDigestItem, now: number): number {
  let score = 0

  const ageDays = freshnessDays(item.latest_published_at, now)
  if (ageDays <= 14) score += 0.4
  else if (ageDays <= 30) score += 0.2

  if (item.vacancies_count >= 5) score += 0.35
  else if (item.vacancies_count >= 3) score += 0.2

  // Repeated roles: more openings than distinct names → re-posting pressure.
  if (
    item.distinct_vacancy_names_count > 0 &&
    item.vacancies_count >= item.distinct_vacancy_names_count * 2
  ) {
    score += 0.25
  }

  return clamp01(score)
}

/**
 * Reachability — safe contact-path strength. Source families and evidence
 * titles tell us whether a direct corporate / career-page surface exists.
 */
function computeReachabilitySignal(item: HhDigestItem): number {
  const families = item.source_families.map((f) => f.toLocaleLowerCase("ru-RU"))
  let score = 0

  const hasCareer = families.some((f) => f.includes("career") || f.includes("карьер"))
  const hasCorporate = families.some(
    (f) => f.includes("corporate") || f.includes("site") || f.includes("сайт") || f.includes("registry")
  )

  if (hasCareer) score += 0.45
  if (hasCorporate) score += 0.4
  if (item.evidence_titles.length >= 2) score += 0.15
  else if (item.evidence_titles.length >= 1) score += 0.1

  // Any item that surfaced through curated families has at least a weak path.
  if (score === 0 && families.length > 0) score = 0.2

  return clamp01(score)
}

function freshnessDays(publishedAt: string, now: number): number {
  const t = Date.parse(publishedAt)
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY
  return Math.max(0, (now - t) / DAY_MS)
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/**
 * Score one digest item against the agency preview input.
 * `now` is injectable for deterministic tests.
 */
export function scorePreviewRelevance(
  item: HhDigestItem,
  input: PublicPreviewInput,
  now: number = Date.now()
): PreviewRelevance {
  const haystack = buildHaystack(item)
  const locationHaystack = item.location_names.join(" ").toLocaleLowerCase("ru-RU")

  const specializationTerms = splitTerms(input.specialization)
  const cityTerms = splitTerms(input.targetCity)
  const includeKeywordTerms = splitTerms(input.includeKeywords)
  const excludeTerms = splitTerms(input.excludeKeywords)

  const includeTerms = [...specializationTerms, ...cityTerms, ...includeKeywordTerms]
  const isExcluded = excludeTerms.length > 0 && anyTermMatches(haystack, excludeTerms)
  const isExactMatch = includeTerms.length === 0 ? true : anyTermMatches(haystack, includeTerms)

  const fit = isExcluded
    ? 0
    : computeFitSignal(haystack, locationHaystack, specializationTerms, cityTerms, includeKeywordTerms)
  const intent = computeIntentSignal(item, now)
  const urgency = computeUrgencySignal(item, now)
  const reachability = computeReachabilitySignal(item)

  const signals: PreviewRelevanceSignals = { fit, intent, urgency, reachability }
  const total = fit + intent + urgency + reachability

  return { total, signals, isExactMatch, isExcluded }
}

/**
 * Rank digest items by ICP relevance for a given preview input.
 *
 * Behaviour (product decision): include/exclude terms still hard-filter — an
 * excluded item is dropped, and when the agency provides include terms we
 * surface exact ICP matches first. But we NEVER return an empty preview on a
 * niche query: if nothing matches exactly, we fall back to the closest
 * companies by relevance so the conversion screen stays populated. Callers
 * detect that case via `hasExactMatches` to show honest "ближайшие" copy.
 */
export function rankPreviewItems(
  items: HhDigestItem[],
  input: PublicPreviewInput,
  options: { limit: number; now?: number }
): {
  ranked: Array<{ item: HhDigestItem; relevance: PreviewRelevance }>
  hasExactMatches: boolean
} {
  const now = options.now ?? Date.now()

  const scored = items
    .map((item) => ({ item, relevance: scorePreviewRelevance(item, input, now) }))
    .filter((entry) => !entry.relevance.isExcluded)

  const exact = scored.filter((entry) => entry.relevance.isExactMatch)
  const pool = exact.length > 0 ? exact : scored

  const ranked = pool
    .slice()
    .sort((a, b) => b.relevance.total - a.relevance.total)
    .slice(0, options.limit)

  // Best-effort server-side event. Only field-presence booleans and aggregate
  // counts are stored; user-entered specialization, city and keywords are never
  // passed to telemetry. The VDS process is long-lived, and telemetry itself is
  // fail-open, so this side effect cannot block preview rendering.
  void tryRecordProductEvent({
    eventName: "preview_submitted",
    outcome: "ranked",
    metadata: {
      hasSpecialization: input.specialization.trim() !== "",
      hasTargetCity: input.targetCity.trim() !== "",
      hasIncludeTerms: input.includeKeywords.trim() !== "",
      hasExcludeTerms: input.excludeKeywords.trim() !== "",
      requestedLimit: options.limit,
      candidateCount: items.length,
      resultCount: ranked.length,
      hasExactMatches: exact.length > 0,
    },
  })

  return { ranked, hasExactMatches: exact.length > 0 }
}
