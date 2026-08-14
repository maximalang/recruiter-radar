/**
 * Profile-derived search-query builder.
 *
 * Goal (per the "queries build themselves from the user profile and self-tune
 * via feedback, no manual curation" direction): every source search query is
 * derived from the client profile's ICP fields (roles, industries, exclusions,
 * geography, operator keywords) rather than hand-maintained per-source ENV or a
 * single global keyword. This module is the pure, DB-free core: given a
 * profile and a source, it produces the source-specific search env keys the
 * ingestion scripts already consume.
 *
 * DESIGN CONSTRAINTS
 *
 * - Pure function. No DB, no process.env. Fully deterministic + unit-testable.
 *   All profile fields are read-only inputs. DB/feedback tuning is layered on
 *   top by the caller (a later module writes derived adjustments back into
 *   `user_search_preferences`); this builder only turns a snapshot into env.
 * - Non-destructive. Caller merges the result AFTER operator overrides
 *   (`user_search_preferences` manual rows + ENV) so a human can always pin a
 *   query. The builder is the *default*, never the override.
 * - Russia-first. Role and industry maps use Russian search terms first
 *   (mirrors INDUSTRY_KEYWORDS and ROLE_HABR_KEYWORDS), because every
 *   source we target indexes Russian text.
 * - No source-specific scraping assumptions. Each source's param shape is
 *   encoded once in `SOURCE_SEARCH_PARAM`; adding a source = one entry here +
 *   one keyword map. The builder does not fetch anything.
 * - Does NOT change FIUR scoring, confidence contract, or source promotion
 *   policy. This is upstream of scoring: it changes which records get fetched,
 *   not how they are scored.
 */

import { INDUSTRY_KEYWORDS, VALID_INDUSTRIES, VALID_ROLES } from '@/lib/clientProfiles'
import type { ClientProfile } from '@/lib/clientProfiles'
import type { SourceId } from '@/lib/sources/source-registry'

/**
 * Canonical role → Russian-first search keywords, shared across every
 * job-board source. This generalises `ROLE_HABR_KEYWORDS` (habr-only) to all
 * sources: the terms are deliberately generic role names that every Russian
 * job board indexes. Per-source narrowing (e.g. HH professional_role numeric
 * ids) is handled in `SOURCE_SEARCH_PARAM`, not here — the keyword list is the
 * shared vocabulary.
 *
 * Keys MUST be a subset of VALID_ROLES (asserted below). 'other' has no
 * keywords: an unspecified role must never widen the query blindly.
 */
export const ROLE_SEARCH_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  'it-engineering': ['разработчик', 'программист', 'инженер'],
  data: ['data scientist', 'аналитик данных', 'дата-инженер'],
  product: ['продакт-менеджер', 'product manager'],
  sales: ['менеджер по продажам', 'sales manager'],
  marketing: ['маркетолог', 'marketing'],
  hr: ['рекрутер', 'hr-менеджер'],
  finance: ['финансовый аналитик', 'бухгалтер'],
  operations: ['операционный менеджер', 'project manager'],
  legal: ['юрист'],
  executive: ['директор', 'руководитель'],
  other: [],
}

// Guard: every keyword key must be a known canonical role. A typo here would
// silently drop a role's keywords, narrowing every profile's query.
for (const key of Object.keys(ROLE_SEARCH_KEYWORDS)) {
  if (!VALID_ROLES.has(key)) {
    throw new Error(`ROLE_SEARCH_KEYWORDS has unknown role key: ${key}`)
  }
}

/**
 * The search params each source's ingestion script consumes (see
 * packages/db/scripts/adapters/*.mjs). Kept in sync with the TS registry's
 * `searchEnvVars`. The builder emits exactly these keys for the sources it
 * supports; unsupported sources yield an empty env (their scripts keep their
 * own defaults).
 *
 * - `text` → a free-text query (HH_SEARCH_TEXT / SUPERJOB_KEYWORD /
 *   HABR_CAREER_KEYWORD / RABOTA_ROSSII_SEARCH_TEXT).
 * - `roleKeywords` → comma-joined multi-keyword list for sources whose API
 *   takes a keyword list (HABR_CAREER_KEYWORDS, SUPERJOB_KEYWORD).
 * - `region` → region/area identifier (RABOTA_ROSSII_REGION for trudvsem;
 *   HH_AREA is left to the operator for now because area codes are numeric
 *   ids, not derivable from a free-text targetCity without a lookup table).
 */
interface SourceSearchParams {
  /** Free-text query env var name, or null if the source has no free-text param. */
  text: string | null
  /** Multi-keyword env var name (comma-joined), or null. */
  roleKeywords: string | null
  /** Region env var name, or null. */
  region: string | null
}

const SOURCE_SEARCH_PARAM: Readonly<Record<string, SourceSearchParams>> = {
  hh: { text: 'HH_SEARCH_TEXT', roleKeywords: null, region: null },
  superjob: { text: 'SUPERJOB_KEYWORD', roleKeywords: 'SUPERJOB_KEYWORD', region: null },
  'rabota-rossii': { text: 'RABOTA_ROSSII_SEARCH_TEXT', roleKeywords: null, region: 'RABOTA_ROSSII_REGION' },
  'career-pages': { text: null, roleKeywords: null, region: null },
}

/** A reduced, serialisable view of ClientProfile the builder needs. */
export interface ProfileSearchInput {
  roles: readonly string[]
  industries: readonly string[]
  excludedIndustries: readonly string[]
  /** Operator-supplied manual keywords; merged first so derived terms widen, not replace. */
  includeKeywords: readonly string[]
  /** Operator-supplied exclusions; applied to the keyword list. */
  excludeKeywords: readonly string[]
  /** Free-text city/region the agency targets (best-effort; not all sources use it). */
  targetCity: string | null
}

/**
 * Project a ClientProfile into the minimal shape the builder reads. Kept
 * separate so the builder stays a pure function of a small input and so tests
 * can construct inputs without a full ClientProfile.
 */
export function profileToSearchInput(profile: ClientProfile): ProfileSearchInput {
  return {
    roles: profile.roles ?? [],
    industries: profile.industries ?? [],
    excludedIndustries: profile.excludedIndustries ?? [],
    includeKeywords: profile.includeKeywords ?? [],
    excludeKeywords: profile.excludeKeywords ?? [],
    targetCity: profile.targetCity ?? null,
  }
}

/**
 * Build the ordered, deduped keyword list for a profile.
 *
 * Composition order (deliberate): operator includeKeywords FIRST, then role
 * keywords, then industry keywords. Operator terms lead because a human-pinned
 * keyword is the strongest signal; roles are the primary ICP axis; industries
 * widen recall to companies that may use non-standard role titles.
 *
 * Exclusions (excludeKeywords + excluded-industry terms) are subtracted AFTER
 * composition. Dedup is case-insensitive, first-seen casing preserved, so
 * 'sales manager' via two paths yields one entry. Order is deterministic for
 * cache-friendly source URLs.
 *
 * Feedback tuning (optional, `demoteTerms`): a lowercase set of ICP terms the
 * feedback loop flagged as poor-fit. These terms are NOT removed — the effect
 * is bounded to re-ordering: demoted terms are pushed to the END of the list so
 * they only fill the query after the well-performing terms. This keeps the
 * query inside the operator's declared ICP (scope unchanged) while letting
 * feedback shift emphasis. Operator-pinned includeKeywords are never demoted
 * (a human pin is the strongest signal and overrides the loop).
 */
export function buildProfileKeywords(
  input: ProfileSearchInput,
  demoteTerms?: ReadonlySet<string>,
): string[] {
  const excludedIndustries = new Set(
    (input.excludedIndustries ?? [])
      .filter((i): i is string => VALID_INDUSTRIES.has(i))
  )

  const raw: string[] = []

  // 1. Operator-pinned manual keywords (strongest).
  for (const kw of input.includeKeywords ?? []) {
    if (typeof kw === 'string' && kw.trim()) raw.push(kw.trim())
  }
  // 2. Role keywords (primary ICP axis).
  for (const role of input.roles ?? []) {
    const mapped = ROLE_SEARCH_KEYWORDS[role]
    if (!mapped) continue
    for (const kw of mapped) raw.push(kw)
  }
  // 3. Industry keywords (widen recall; excluded industries removed).
  for (const industry of input.industries ?? []) {
    if (!VALID_INDUSTRIES.has(industry)) continue
    if (excludedIndustries.has(industry)) continue
    const terms = INDUSTRY_KEYWORDS.get(industry)
    if (!terms) continue
    for (const kw of terms) raw.push(kw)
  }

  // Subtraction set: explicit excludeKeywords + excluded-industry terms.
  const subtract = new Set<string>()
  for (const kw of input.excludeKeywords ?? []) {
    if (typeof kw === 'string' && kw.trim()) subtract.add(kw.trim().toLowerCase())
  }
  for (const industry of input.excludedIndustries ?? []) {
    if (!VALID_INDUSTRIES.has(industry)) continue
    const terms = INDUSTRY_KEYWORDS.get(industry)
    if (!terms) continue
    for (const kw of terms) subtract.add(kw.toLowerCase())
  }

  // Operator-pinned includeKeywords are never demoted (human pin > feedback
  // loop): build the set of operator term keys once so we can exempt them.
  const operatorTermKeys = new Set<string>()
  for (const kw of input.includeKeywords ?? []) {
    if (typeof kw === 'string' && kw.trim()) operatorTermKeys.add(kw.trim().toLowerCase())
  }
  const demote = demoteTerms ?? new Set<string>()

  // Two-pass de-dup: non-demoted terms first (composition order preserved),
  // then demoted terms (pushed to the back — bounded effect, not removal).
  const seen = new Set<string>()
  const front: string[] = []
  const back: string[] = []
  for (const kw of raw) {
    const key = kw.toLowerCase()
    if (subtract.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    const isDemoted = demote.has(key) && !operatorTermKeys.has(key)
    if (isDemoted) back.push(kw)
    else front.push(kw)
  }
  return [...front, ...back]
}

/**
 * Build the source-specific search env for one (profile, source) pair.
 *
 * `demoteTerms` (optional): a lowercase set of ICP terms the feedback loop
 * flagged as poor-fit; passed through to `buildProfileKeywords` which re-orders
 * them to the back of the query (bounded effect, not removal). When omitted the
 * query is built from the profile alone (Foundation 1 behaviour).
 *
 * Returns an empty object when the source has no supported search params or
 * when the profile yields no keywords — the caller then falls back to the
 * source adapter's built-in default (unchanged from today).
 */
export function buildProfileSearchEnv(
  source: SourceId,
  input: ProfileSearchInput,
  demoteTerms?: ReadonlySet<string>,
): Record<string, string> {
  const params = SOURCE_SEARCH_PARAM[source]
  if (!params) return {}

  const keywords = buildProfileKeywords(input, demoteTerms)
  const env: Record<string, string> = {}

  if (params.text && keywords.length > 0) {
    // Free-text query: join with a space for sources that take a single
    // query string (HH, rabota-rossii). For multi-keyword sources the
    // roleKeywords param (comma-joined) is the preferred shape.
    env[params.text] = keywords.join(' ')
  }
  if (params.roleKeywords && keywords.length > 0) {
    env[params.roleKeywords] = keywords.join(',')
  }
  // Region: only emitted when the profile pins a targetCity AND the source
  // takes a region param. trudvsem expects a federal-subject code, which we
  // cannot derive from a free-text city without a lookup; until that lookup
  // table exists we deliberately emit nothing rather than a wrong code.
  // (HH_AREA is numeric ids — same reason, left to operator ENV.)

  return env
}
