/**
 * Foreign-employer geo gate.
 *
 * Product is Russia-first: leads are recruitment clients a RU agency can
 * realistically win. A hiring signal that lives ONLY on a foreign ATS
 * (Greenhouse, Lever, Workday, Ashby, …) with no Russian-market footprint is a
 * foreign employer — it should never out-rank a domestic company on score.
 *
 * The deterministic SQL scorer grants any `career-pages` signal
 * `direct_hiring_proof` (quality_weight 300), so a Discord/Greenhouse board
 * beats a Sber/HH lead (platform_aggregation 200) purely because it is a career
 * page. That is the ICP inversion this module corrects.
 *
 * Design: a SOFT cap, not a hard exclude. We subtract a fixed penalty from the
 * evidence total so a foreign employer sinks below any domestic lead at the same
 * activity level, while still being visible/reviewable. The lead is flagged
 * (`foreign_employer`) so the UI can badge it «Иностранный работодатель».
 *
 * A foreign ATS host with a Russian-market signal (Cyrillic location, known RU
 * city, .ru domain) is NOT treated as foreign — a RU company can host its board
 * on Greenhouse. We only penalise when the foreign surface has NO RU footprint.
 */

/**
 * Known foreign applicant-tracking / job-board hosts. Matched as substrings
 * against candidate source keys and the source external id (which carry
 * `domain:boards.greenhouse.io`-style values). Lowercased.
 */
export const FOREIGN_ATS_DOMAINS: readonly string[] = [
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkdayjobs.com',
  'ashbyhq.com',
  'jobvite.com',
  'smartrecruiters.com',
  'bamboohr.com',
  'workable.com',
  'recruitee.com',
  'breezy.hr',
  'teamtailor.com',
  'personio.com',
  'jazz.co',
  'jobs.eu',
]

/** Penalty subtracted from the evidence total when a foreign employer is detected.
 * Chosen to exceed the direct(300)→platform(200) quality-weight gap by 50, so a
 * foreign direct-proof lead sinks below a domestic platform lead AT EQUAL
 * activity. Note this is not an absolute guarantee across all activity levels
 * (activity_score spans ~0–90): a max-activity foreign lead can still edge out a
 * near-zero-activity domestic one. That residual is acceptable — the goal is to
 * remove the systematic inversion where being a career page alone out-ranks a
 * domestic company, not to hard-exclude foreign leads (that stays a soft cap). */
export const FOREIGN_EMPLOYER_SCORE_PENALTY = 150

/**
 * Russian-market cues. Presence of ANY of these in the lead's text (locations,
 * evidence titles, display name, source keys) means the employer has a RU
 * footprint and must NOT be treated as foreign, even on a foreign ATS host.
 */
const RU_CITY_HINTS: readonly string[] = [
  'москва', 'moscow', 'санкт-петербург', 'петербург', 'saint petersburg', 'spb',
  'новосибирск', 'екатеринбург', 'казань', 'нижний новгород', 'челябинск',
  'самара', 'ростов', 'уфа', 'краснодар', 'пермь', 'воронеж', 'волгоград',
  'россия', 'russia', 'рф',
]

/** True when the text contains any Cyrillic letter — a strong RU-market cue. */
function hasCyrillic(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text)
}

/** True when any source key / external id points at a `.ru` host. */
function hasRuDomain(keys: readonly string[]): boolean {
  return keys.some((k) => /(^|[.:/@])[a-z0-9-]+\.ru(\b|[/:?#])/i.test(k))
}

export interface ForeignEmployerInput {
  /** org display name (may be a domain). */
  sourceDisplayName?: string | null
  /** the winning source external id (often `domain:host` / `org:id`). */
  sourceExternalId?: string | null
  /** all candidate source keys (`domain:boards.greenhouse.io`, …). */
  candidateSourceKeys?: readonly string[]
  /** evidence titles (job titles) — Cyrillic here is a RU cue. */
  evidenceTitles?: readonly string[]
  /** location names — RU cities / Cyrillic here is a RU cue. */
  locationNames?: readonly string[]
}

export interface ForeignEmployerResult {
  /** Whether the lead is a foreign employer (foreign ATS host, no RU footprint). */
  isForeign: boolean
  /** The foreign ATS domain that matched, when isForeign. */
  matchedDomain: string | null
}

/**
 * Detect a foreign employer: hosted on a known foreign ATS AND showing no
 * Russian-market footprint. Pure and deterministic.
 */
export function detectForeignEmployer(input: ForeignEmployerInput): ForeignEmployerResult {
  const keys = [
    ...(input.candidateSourceKeys ?? []),
    input.sourceExternalId ?? '',
  ]
    .filter((k) => typeof k === 'string' && k.length > 0)
    .map((k) => k.toLowerCase())

  const matchedDomain = FOREIGN_ATS_DOMAINS.find((domain) =>
    keys.some((k) => k.includes(domain)),
  ) ?? null

  if (!matchedDomain) {
    return { isForeign: false, matchedDomain: null }
  }

  // Foreign ATS host found. Now check for a RU footprint that would exempt it.
  const ruText = [
    input.sourceDisplayName ?? '',
    ...(input.evidenceTitles ?? []),
    ...(input.locationNames ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase('ru-RU')

  const hasRuFootprint =
    hasCyrillic(ruText) ||
    RU_CITY_HINTS.some((hint) => ruText.includes(hint)) ||
    hasRuDomain(keys)

  return { isForeign: !hasRuFootprint, matchedDomain }
}

/**
 * Apply the soft foreign-employer penalty to an evidence total. Never returns
 * below 0. A non-foreign lead is returned unchanged.
 */
export function applyForeignEmployerPenalty(totalScore: number, isForeign: boolean): number {
  if (!isForeign) return totalScore
  return Math.max(0, totalScore - FOREIGN_EMPLOYER_SCORE_PENALTY)
}
