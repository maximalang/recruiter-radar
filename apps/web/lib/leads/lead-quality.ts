import { hasCompanyHiringSource } from '../sources/company-hiring-sources'

/**
 * Lead-quality derivations for narrow-ICP agencies (Block 3).
 *
 * Recruitment agencies in Russia are often niche: IT-only, one region, a
 * specific company size, or executive vs. mass hiring. The generic digest copy
 * ("Опубликовано за последние 45 дней", empty roles, vacuous why-match) reads as
 * noise to them. These pure, deterministic helpers sharpen three surfaces:
 *
 *   - deriveRoleNames: real, normalized, deduped job titles from evidence, with a
 *     fallback so the card never shows a blank "roles" slot.
 *   - deriveUrgencyCue: a concrete urgency line (burst / fresh / active / stale)
 *     from vacancy counts + freshness, replacing the weak "за 45 дней" default.
 *   - passesMinimumSignalGate: drops/penalises a lead with no roles, no AI hint,
 *     and no direct corporate surface — the empty-shell leads that erode trust.
 *
 * Everything here states only what is true of the lead. No invented facts.
 */

// ─── Role names ──────────────────────────────────────────────────────────────

/** Noise tokens that are not real role titles — dropped from the roles list. */
const ROLE_NOISE = new Set([
  'hiring position',
  'вакансия',
  'вакансии',
  'open position',
  'careers',
  'career',
  'jobs',
  'job',
  '-',
  '—',
])

/**
 * Collapse a raw job title to a comparison key: lowercased, punctuation folded to
 * spaces, whitespace collapsed. Used only for dedupe/noise checks — the returned
 * display title keeps original casing.
 */
function roleKey(title: string): string {
  return title
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Derive a clean, deduped list of real role titles for the lead card.
 *
 * Prefers `evidenceTitles` (actual parsed job titles). Falls back to
 * `aiRoleTitles` (from AI enrichment) only when evidence carries none — the AI
 * layer is advisory and must not override real evidence. Drops blanks and noise
 * tokens, dedupes case-insensitively, and preserves first-seen order.
 *
 * Returns [] when nothing usable exists — the caller shows "роли не определены"
 * rather than a blank space.
 */
export function deriveRoleNames(input: {
  evidenceTitles?: readonly string[] | null
  aiRoleTitles?: readonly string[] | null
}): string[] {
  const fromEvidence = cleanRoleList(input.evidenceTitles)
  if (fromEvidence.length > 0) return fromEvidence
  return cleanRoleList(input.aiRoleTitles)
}

function cleanRoleList(raw: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const title = item.trim()
    if (title === '') continue
    const key = roleKey(title)
    if (key === '' || ROLE_NOISE.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(title)
  }
  return out
}

/**
 * Split a role list into a shown head (max `limit`) and the remaining count, so
 * the card can render "role, role, role + ещё N". Deterministic and pure.
 */
export function splitRolesForDisplay(
  roles: readonly string[],
  limit = 5,
): { shown: string[]; more: number } {
  if (roles.length <= limit) return { shown: [...roles], more: 0 }
  return { shown: roles.slice(0, limit), more: roles.length - limit }
}

// ─── Urgency cue ───────────────────────────────────────────────────────────────

export type UrgencyLevel = 'burst' | 'fresh' | 'active' | 'normal' | 'stale'

export interface UrgencyCue {
  level: UrgencyLevel
  /** Russian one-liner for the card. */
  label: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Derive a concrete urgency cue from the lead's activity signals, replacing the
 * weak "опубликовано за последние 45 дней" default.
 *
 * Priority (strongest first):
 *   - burst:  5+ recent signals (last 7 days) → "5+ вакансий за последние 7 дней"
 *   - active: 10+ open roles                  → "активный найм, 10+ открытых позиций"
 *   - fresh:  latest signal within 7 days      → "новые вакансии за неделю"
 *   - stale:  latest signal older than 30 days → downgrade line
 *   - normal: otherwise                        → neutral recency line
 *
 * `recentSignalCount` is the count of signals in the last 7 days (may be
 * undefined when unknown). `now` is injectable for tests.
 *
 * `hiringMode` makes urgency agency-aware (2026-07-06):
 *   - 'executive' — a single fresh senior posting is a strong signal, while a
 *     high open-role count is NOT urgency (it often signals low-seniority churn,
 *     the opposite of an executive mandate). Volume cues are downgraded; a fresh
 *     single posting is upgraded to a senior-specific urgency line.
 *   - 'volume' — open-role volume is the dominant urgency cue (kept as-is).
 *   - 'specialist' — the default pre-mode behavior above (unchanged).
 *
 * The mode only changes the LABEL and the relative emphasis — it never weakens
 * the underlying signal or invents activity that isn't there.
 */
export function deriveUrgencyCue(input: {
  vacanciesCount: number
  latestPublishedAt?: string | null
  recentSignalCount?: number | null
  now?: number
  hiringMode?: 'specialist' | 'executive' | 'volume'
}): UrgencyCue {
  const now = input.now ?? Date.now()
  const recent = input.recentSignalCount ?? 0
  const ageDays = ageInDays(input.latestPublishedAt, now)
  const mode = input.hiringMode ?? 'specialist'

  // Executive mode: seniority-shaped urgency. A high open-role count is not a
  // hot lead for an executive agency — downgrade volume cues and lead with the
  // freshness/seniority signal instead. We do NOT invent a "senior" claim here
  // (the caller knows the roles); we only reframe the recency cue so a single
  // fresh posting reads as urgency rather than as "one role".
  if (mode === 'executive') {
    if (ageDays != null && ageDays <= 7) {
      return { level: 'fresh', label: 'Свежая вакансия за неделю — стоит реагировать быстро' }
    }
    if (ageDays != null && ageDays > 30) {
      const rounded = Math.round(ageDays)
      return { level: 'stale', label: `Последняя вакансия ${rounded}+ дней назад` }
    }
    return { level: 'normal', label: 'Есть активная вакансия' }
  }

  // Volume + specialist share the volume-shaped ladder below; volume mode is
  // the case where these cues matter most, specialist keeps them as the default.
  if (recent >= 5) {
    return { level: 'burst', label: `${recent}+ вакансий за последние 7 дней` }
  }
  if (input.vacanciesCount >= 10) {
    return { level: 'active', label: `Активный найм — ${input.vacanciesCount}+ открытых позиций` }
  }
  if (ageDays != null && ageDays <= 7) {
    return { level: 'fresh', label: 'Новые вакансии за неделю' }
  }
  if (ageDays != null && ageDays > 30) {
    const rounded = Math.round(ageDays)
    return { level: 'stale', label: `Последняя вакансия ${rounded}+ дней назад` }
  }
  if (input.vacanciesCount >= 3) {
    return { level: 'active', label: `${input.vacanciesCount} открытых позиций` }
  }
  return { level: 'normal', label: 'Есть активная вакансия' }
}

function ageInDays(publishedAt: string | null | undefined, now: number): number | null {
  if (!publishedAt) return null
  const t = Date.parse(publishedAt)
  if (Number.isNaN(t)) return null
  return Math.max(0, (now - t) / DAY_MS)
}

// ─── Minimum signal quality gate ─────────────────────────────────────────────

/**
 * Whether a lead clears the minimum signal-quality bar. A lead FAILS (should be
 * excluded / heavily penalised) only when ALL of these hold:
 *   - no roles detected (vacanciesCount = 0 OR every role name is empty/noise)
 *   - AND no AI hint
 *   - AND no direct corporate surface (company career/hosted ATS / A-B gate)
 *
 * The three conditions are ANDed on purpose: any single real signal (a role, an
 * AI hint, or a corporate surface) is enough to keep the lead. This is the
 * empty-shell filter, not an aggressive quality bar — it must not regress the
 * leads=0 trap for registry-sourced leads that legitimately carry roles.
 */
export function passesMinimumSignalGate(input: {
  vacanciesCount: number
  roleNames: readonly string[]
  hasAiHint: boolean
  sourceFamilies: readonly string[]
  confidenceGate: string
}): boolean {
  const hasRoles = input.vacanciesCount > 0 && input.roleNames.length > 0
  if (hasRoles) return true
  if (input.hasAiHint) return true

  const hasDirectSurface =
    hasCompanyHiringSource(input.sourceFamilies) ||
    input.confidenceGate === 'A' ||
    input.confidenceGate === 'B'
  if (hasDirectSurface) return true

  return false
}
