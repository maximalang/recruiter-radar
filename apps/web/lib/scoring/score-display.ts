/**
 * Score presentation — single source of truth for turning the persisted
 * `digest_candidates.total_score` into something a human reads.
 *
 * WHY this module exists: `total_score` is NOT the FIUR [0,4] total. It is the
 * digest evidence-ranking score produced by digest-evidence-query.ts:
 *
 *   total_score = quality_weight (140 platform | 220 direct) + activity_score (0..180)
 *
 * so any *surfaced* lead scores ~180–400 (enrichment_context/0 is filtered out
 * before persistence). Three surfaces each independently mis-read this value:
 *   • the web score bar/gauge assumed a [0,50] scale → every real lead rendered
 *     at 100% width and "Высокий";
 *   • the Telegram card assumed a raw FIUR [0,4] value → every card read
 *     "Горячий · 247.0";
 *   • the hiring-intent filter compared a 200+ integer against a [0,4] threshold
 *     → the condition was never true, so the filter silently did nothing.
 *
 * The fix: convert ONCE, here. Dividing by 100 lands the raw score on the same
 * [0,4] "сила сигнала" scale the product contract, the Telegram band, and the
 * profile form already speak — direct-hiring leads → 3.x ("горячий"),
 * platform-only aggregation → 2.x ("тёплый"). Every surface imports from this
 * module so the scales can never drift apart again.
 *
 * This is presentation only: it never changes how candidates are scored, ranked,
 * gated, or persisted. The raw `total_score` remains the ordering key.
 */

/** Raw evidence-ranking ceiling: quality_weight 220 + activity_score 180 = 400. */
export const RAW_SCORE_MAX = 400

/** The FIUR-aligned signal-strength scale shown to users. */
export const SIGNAL_STRENGTH_MAX = 4

/**
 * The user-facing points scale (0–100). The persisted `total_score` lives on
 * [0,400]; the displayed score is `raw / 4` → 0–100 points, so a 75-point lead
 * is the same 75% of the ceiling as strength 3.0 of 4 (raw 300). This is the
 * scale the lead-card meter, the detail gauge, the CSV export, and the delivery
 * cards show as the headline number. The internal [0,4] signal strength stays
 * the gate/tone/threshold contract (see toSignalStrength) — points are a
 * higher-resolution read of the SAME underlying value, not a separate score.
 */
export const SCORE_POINTS_MAX = 100

export type ScoreTone = 'success' | 'warning' | 'danger'

/**
 * Convert the raw persisted `total_score` to the [0,4] signal-strength scale.
 * This is the same scale the FIUR contract and the profile `hiringIntentMin`
 * threshold use, so a UI value and a stored threshold are directly comparable.
 */
export function toSignalStrength(rawScore: number | null | undefined): number {
  if (rawScore == null || !Number.isFinite(rawScore)) return 0
  const value = rawScore / 100
  if (value < 0) return 0
  if (value > SIGNAL_STRENGTH_MAX) return SIGNAL_STRENGTH_MAX
  return value
}

/**
 * Convert the raw persisted `total_score` to the user-facing 0–100 points scale.
 * `raw / 4` (the raw ceiling 400 → 100). Same fraction as toSignalStrength, so
 * the points number and the gate/tone/threshold never disagree: 75 pts ↔ 3.0 of
 * 4 ↔ raw 300 ↔ the "горячий" cut. Clamped to [0, SCORE_POINTS_MAX].
 */
export function scorePoints(rawScore: number | null | undefined): number {
  if (rawScore == null || !Number.isFinite(rawScore)) return 0
  const points = Math.round(rawScore / 4)
  if (points < 0) return 0
  if (points > SCORE_POINTS_MAX) return SCORE_POINTS_MAX
  return points
}

/** Percent fill (0–100) for a progress bar, derived from the raw score. */
export function scorePercent(rawScore: number | null | undefined): number {
  if (rawScore == null || !Number.isFinite(rawScore)) return 0
  const pct = Math.round((rawScore / RAW_SCORE_MAX) * 100)
  if (pct < 0) return 0
  if (pct > 100) return 100
  return pct
}

/** Tone by signal strength: ≥3 hot (success), ≥2 warm (warning), below cold (danger). */
export function scoreTone(rawScore: number | null | undefined): ScoreTone {
  const strength = toSignalStrength(rawScore)
  if (strength >= 3) return 'success'
  if (strength >= 2) return 'warning'
  return 'danger'
}

export type ScoreBand = { label: string; tone: ScoreTone }

/**
 * One-glance temperature read for a lead card (Telegram, email, web badge).
 * Mirrors the "companies worth contacting today" framing without inventing
 * precision the underlying number does not have.
 *
 * `tone` is the single source of truth for the temperature color across every
 * surface — the web chip renders an inline-SVG by tone, and the email card
 * colors the readiness line by tone. There is no `icon` field on purpose: the
 * product no longer uses emoji as interface iconography, and tone is enough
 * for every consumer to choose its own presentation.
 */
export function scoreBand(rawScore: number | null | undefined): ScoreBand {
  const strength = toSignalStrength(rawScore)
  if (strength >= 3) return { label: 'Горячий', tone: 'success' }
  if (strength >= 2) return { label: 'Тёплый', tone: 'warning' }
  return { label: 'Холодный', tone: 'danger' }
}

const SCORE_LEVEL_LABELS: Record<ScoreTone, string> = {
  success: 'Высокий',
  warning: 'Средний',
  danger: 'Низкий',
}

/** Human level label ("Высокий" / "Средний" / "Низкий") for the raw score. */
export function scoreLevelLabel(rawScore: number | null | undefined): string {
  return SCORE_LEVEL_LABELS[scoreTone(rawScore)]
}

/** "3.2" — one-decimal signal strength for inline display; "—" when absent. */
export function formatSignalStrength(rawScore: number | null | undefined): string {
  if (rawScore == null || !Number.isFinite(rawScore)) return '—'
  return toSignalStrength(rawScore).toFixed(1)
}

/** "75" — whole-number score points on the 0–100 scale; "—" when absent. */
export function formatScorePoints(rawScore: number | null | undefined): string {
  if (rawScore == null || !Number.isFinite(rawScore)) return '—'
  return String(scorePoints(rawScore))
}
