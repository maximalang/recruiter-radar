/**
 * Profile-derived GDELT query builder for funding-business-signals.
 *
 * funding-business-signals has a FREE live-public mode via the GDELT DOC API
 * (`FUNDING_SIGNALS_GDELT_QUERIES` / `_JSON`), but today those queries must be
 * hand-configured as a global ENV string. This module derives GDELT queries
 * from the active client profiles' ICP so the source can run live-public with
 * zero manual curation — same principle as the job-board query builder, but
 * GDELT takes a single free-text query string per request, so the shape is a
 * newline/semicolon-joined list of query strings (consumed by
 * parseGdeltQueries in source-funding-business-signals.mjs).
 *
 * GDELT DOC API query syntax: space-separated terms = full-text search across
 * news articles (verified shape: 'RocketScale Series B hiring' in the smoke
 * fixture). For funding/business context we combine a profile industry term
 * with a context verb (funding/investment/hiring/growth) so the query surfaces
 * corroborating news, not random industry articles.
 *
 * DESIGN CONSTRAINTS
 *
 * - Pure function. No DB, no process.env. Deterministic + unit-testable.
 * - CONTEXT-only source (Gate D): these queries surface news context that
 *   corroborates org identity/urgency, NEVER a lead on its own. The digest SQL
 *   still filters to signal_type='job_posting' for lead candidacy.
 * - Operator overrides win. The caller merges derived queries AFTER any
 *   operator-set FUNDING_SIGNALS_GDELT_QUERIES, so a human pin always wins.
 * - Bounded query count. One query per (industry × context-verb) combination,
 *   capped to MAX_QUERIES to avoid hammering GDELT. Industries outside the
 *   profile's declared ICP are never queried.
 */

import { INDUSTRY_KEYWORDS, VALID_INDUSTRIES } from '@/lib/clientProfiles'
import type { ProfileSearchInput } from './search-query-builder'

/**
 * Context verbs that turn an industry term into a funding/business-signal
 * query. Russian + English because GDELT indexes global news; Russian-first
 * since the product is Russia-first, English to catch international press.
 */
const GDELT_CONTEXT_VERBS = Object.freeze([
  'финансирование',
  'инвестиции',
  'раунд финансирования',
  'найм',
  'расширение',
  'funding',
  'investment',
  'hiring',
] as const)

/**
 * Maximum derived GDELT queries per run. Each query is a GDELT API request, so
 * bounding the count bounds the source's fetch budget and load on the public
 * API. (industry × verb) is capped here, not in the profile, so a profile with
 * many industries does not explode the query count.
 */
export const MAX_GDELT_QUERIES = 8

/**
 * Build the GDELT query list for one profile's ICP.
 *
 * For each profile industry, pair its first (primary) INDUSTRY_KEYWORDS term
 * with each context verb, producing one query string per pair. Dedup
 * case-insensitively (an industry+verb can repeat across profiles in the
 * union). Capped to MAX_GDELT_QUERIES; overflow drops the weakest signals
 * (later verbs) first.
 *
 * Returns the list as a single newline-joined string ready for
 * FUNDING_SIGNALS_GDELT_QUERIES (parseGdeltQueries splits on \n|;). Empty
 * string when the profile declares no mappable industry — caller then leaves
 * the env unset and the source falls back to file/provider/no-input.
 */
export function buildProfileGdeltQueries(input: ProfileSearchInput): string {
  const excludedIndustries = new Set(
    (input.excludedIndustries ?? []).filter((i): i is string => VALID_INDUSTRIES.has(i)),
  )

  const queries: string[] = []
  const seen = new Set<string>()

  for (const industry of input.industries ?? []) {
    if (!VALID_INDUSTRIES.has(industry)) continue
    if (excludedIndustries.has(industry)) continue
    const terms = INDUSTRY_KEYWORDS.get(industry)
    if (!terms || terms.length === 0) continue
    // Primary industry term only (first entry) to keep queries focused and
    // bound the count; the full term list is used for matching, not querying.
    const primaryTerm = terms[0]

    for (const verb of GDELT_CONTEXT_VERBS) {
      if (queries.length >= MAX_GDELT_QUERIES) break
      const query = `${primaryTerm} ${verb}`
      const key = query.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      queries.push(query)
    }
    if (queries.length >= MAX_GDELT_QUERIES) break
  }

  return queries.join('\n')
}

/** Exported for tests/audit. */
export const GDELT_CONTEXT_VERBS_LIST = GDELT_CONTEXT_VERBS
