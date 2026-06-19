/**
 * Habr Career keyword derivation.
 *
 * Ingestion is global: `ingestAllPrimarySources()` fills ONE shared signal pool
 * before any per-profile digest runs. So habr-career search keywords cannot be
 * tied to a single profile — they must reflect the UNION of every active
 * profile's ICP `roles`. This module maps canonical role keys (the same
 * `VALID_ROLES` whitelist used by onboarding + FIUR Fit scoring) to the
 * Russian-first search terms Habr Career understands, then dedupes across all
 * active profiles.
 *
 * Habr Career is IT-focused, so IT roles get rich keyword sets and non-IT roles
 * map to the nearest IT-adjacent terms (e.g. sales → 'sales manager'); the
 * derived list is a search seed, not an exclusion filter — downstream FIUR Fit
 * scoring still decides per-profile relevance.
 *
 * Fallback chain (handled by the caller in source-ingest):
 *   derived keywords (from active roles) → HABR_CAREER_KEYWORD env → adapter default.
 */

import { VALID_ROLES } from '@/lib/clientProfiles'

/**
 * Canonical role key → Habr Career search keywords.
 *
 * Keys MUST be a subset of VALID_ROLES (enforced by assertion below). Russian
 * terms first because the product is Russia-first and Habr's index is Russian;
 * a few English terms are added where they materially widen recall.
 */
export const ROLE_HABR_KEYWORDS: Record<string, string[]> = {
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
  // 'other' intentionally has no keywords — it must not widen the search blindly.
  other: [],
}

// Guard: every keyword key must be a known canonical role. A typo here would
// silently drop a role's keywords, narrowing the shared pool without warning.
for (const key of Object.keys(ROLE_HABR_KEYWORDS)) {
  if (!VALID_ROLES.has(key)) {
    throw new Error(`ROLE_HABR_KEYWORDS has unknown role key: ${key}`)
  }
}

/**
 * Derive a deduped, order-stable list of Habr Career keywords from the roles of
 * all active client profiles.
 *
 * @param roleLists one entry per active profile: that profile's `roles` array.
 * @returns deduped keywords across every role of every profile. Empty when no
 *          profile declares a mappable role — caller falls back to ENV/default.
 *
 * Dedup is case-insensitive but preserves first-seen casing, so 'sales manager'
 * appearing via two profiles yields a single entry. Order follows first
 * appearance for deterministic, cache-friendly URLs.
 */
export function deriveHabrKeywordsFromProfiles(roleLists: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const seen = new Set<string>()
  const keywords: string[] = []

  for (const roles of roleLists) {
    for (const role of roles) {
      const mapped = ROLE_HABR_KEYWORDS[role]
      if (!mapped) continue
      for (const kw of mapped) {
        const dedupeKey = kw.toLowerCase()
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        keywords.push(kw)
      }
    }
  }

  return keywords
}
