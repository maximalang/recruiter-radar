/**
 * Feedback-driven search-query tuning (self-learning layer).
 *
 * Goal: search queries "improve themselves from feedback without manual
 * involvement". Today feedback only reweights the SCORE of already-fetched
 * leads (`computeClientOverrides`: 50% industryFitPenalty after 3+ badfits).
 * It never changes WHAT a source searches for next — so a source keeps
 * re-fetching the same bad-fit industry every day. This module closes that
 * loop: it reads a profile's feedback history and produces keyword
 * adjustments (boost / demote) that the query builder applies, so future
 * queries learn from past feedback.
 *
 * DESIGN CONSTRAINTS (critical domain — suppression/feedback state)
 *
 * - Pure core. The computation (history → adjustments) is a pure function of
 *   a small typed input. No DB, no process.env, no side effects. Fully
 *   deterministic + unit-testable. The DB read is a thin caller
 *   (`loadClientFeedbackPatterns`) that feeds this core.
 * - Minimum sample size. A single badfit must NEVER narrow a query — that
 *   would let one noisy rejection starve the lead pool. MIN_SAMPLES_PER_AXIS
 *   (default 3, matching the existing reweight threshold) gates every
 *   adjustment. Below the threshold the axis is left untouched.
 * - Bounded effect. Demote never removes a term outright; it flags it for
 *   de-prioritisation. Boost never invents new terms outside the profile's
 *   ICP — it only re-orders existing ICP terms. This keeps the query inside
 *   the operator's declared ICP; the loop tunes emphasis, not scope.
 * - Auditable + resettable. Adjustments carry provenance
 *   (`source: 'feedback'`) so the operator can distinguish them from manual
 *   `user_search_preferences` rows and reset them. The writer (separate
 *   module) is idempotent and rate-limited.
 * - Does NOT change FIUR scoring, confidence contract, or source promotion
 *   policy. This is upstream of scoring: it changes the query, not the score.
 *   It is additive to `computeClientOverrides` (which still reweights scores).
 */

import { INDUSTRY_KEYWORDS, VALID_INDUSTRIES } from '@/lib/clientProfiles'

/** Feedback actions that count as NEGATIVE for query tuning. */
export const NEGATIVE_FEEDBACK_ACTIONS = Object.freeze(['badfit', 'dismissed'] as const)
/** Feedback actions that count as POSITIVE for query tuning. */
export const POSITIVE_FEEDBACK_ACTIONS = Object.freeze(['contacted', 'replied', 'won'] as const)

export type NegativeFeedbackAction = (typeof NEGATIVE_FEEDBACK_ACTIONS)[number]
export type PositiveFeedbackAction = (typeof POSITIVE_FEEDBACK_ACTIONS)[number]

/**
 * Minimum feedback events on an axis before any tuning is applied. Matches the
 * existing reweight threshold (BADFIT_THRESHOLD=3 in client-overrides.ts) so
 * the query loop and the score loop agree on when a pattern is statistically
 * meaningful rather than noise.
 */
export const MIN_SAMPLES_PER_AXIS = 3

/**
 * One feedback event projected to the axes the tuner reads. The caller
 * (`loadClientFeedbackPatterns`) produces these from a join of
 * client_digest_org_state × orgs (industry) × signals (role, future).
 */
export interface FeedbackPatternEvent {
  /** Canonical industry key (validated against VALID_INDUSTRIES) or null. */
  industry: string | null
  /** Canonical role key (validated against VALID_ROLES) or null. Future axis. */
  role: string | null
  /** 'negative' | 'positive' — mapped from the feedback_status enum. */
  sentiment: 'negative' | 'positive'
}

/** A single tuning decision for one axis value. */
export interface QueryTermAdjustment {
  /** The axis this adjustment is on. */
  axis: 'industry' | 'role'
  /** The canonical axis value (industry key or role key). */
  value: string
  /** 'demote' (too many badfits) | 'boost' (too many wins). */
  direction: 'demote' | 'boost'
  /** Number of feedback events behind this decision (for audit). */
  sampleCount: number
  /** Net sentiment score: positives - negatives (for audit). */
  netScore: number
}

/**
 * The result of tuning a profile's feedback history.
 *
 * `demote` / `boost` contain the canonical axis values whose ICP terms the
 * query builder should de-prioritise / prioritise. The builder maps these to
 * concrete keywords via INDUSTRY_KEYWORDS / ROLE_SEARCH_KEYWORDS.
 */
export interface ClientQueryAdjustments {
  demote: QueryTermAdjustment[]
  boost: QueryTermAdjustment[]
}

/** No-op result returned when there is not enough feedback to tune. */
export const NO_ADJUSTMENTS: ClientQueryAdjustments = Object.freeze({
  demote: [],
  boost: [],
})

/**
 * Classify a raw feedback_status string into a sentiment, or null if it is
 * not a tuning-relevant action ('none', 'snooze' are neutral / temporal and
 * do not signal query quality).
 */
export function classifyFeedbackSentiment(
  status: string,
): 'negative' | 'positive' | null {
  if ((NEGATIVE_FEEDBACK_ACTIONS as readonly string[]).includes(status)) return 'negative'
  if ((POSITIVE_FEEDBACK_ACTIONS as readonly string[]).includes(status)) return 'positive'
  return null
}

/**
 * Aggregate feedback events by axis value and apply the minimum-sample gate.
 *
 * For each (axis, value) pair we count positives and negatives. A pair becomes
 * a 'demote' adjustment when it has >= MIN_SAMPLES_PER_AXIS events AND negatives
 * outnumber positives (net negative). A pair becomes a 'boost' adjustment when
 * it has >= MIN_SAMPLES_PER_AXIS events AND positives outnumber negatives
 * (net positive). Ties and sub-threshold pairs are ignored — tuning is
 * conservative and only acts on clear, sufficiently-sampled signals.
 *
 * Sort order is deterministic: by absolute net score descending, then value
 * ascending, so the strongest signals lead and ties are stable.
 */
export function computeClientQueryAdjustments(
  events: readonly FeedbackPatternEvent[],
): ClientQueryAdjustments {
  if (events.length === 0) return NO_ADJUSTMENTS

  type Bucket = { pos: number; neg: number }
  const byIndustry = new Map<string, Bucket>()
  const byRole = new Map<string, Bucket>()

  const accumulate = (map: Map<string, Bucket>, value: string, sentiment: 'negative' | 'positive') => {
    let b = map.get(value)
    if (!b) {
      b = { pos: 0, neg: 0 }
      map.set(value, b)
    }
    if (sentiment === 'positive') b.pos += 1
    else b.neg += 1
  }

  for (const e of events) {
    if (e.sentiment !== 'negative' && e.sentiment !== 'positive') continue
    if (e.industry && VALID_INDUSTRIES.has(e.industry)) {
      accumulate(byIndustry, e.industry, e.sentiment)
    }
    // Role axis: validated against VALID_ROLES in the caller; here we accept
    // any non-empty string the caller passes (the caller is responsible for
    // canonicalising). This keeps the core decoupled from clientProfiles'
    // VALID_ROLES import while still bounded.
    if (e.role) {
      accumulate(byRole, e.role, e.sentiment)
    }
  }

  const toAdjustments = (
    map: Map<string, Bucket>,
    axis: 'industry' | 'role',
  ): QueryTermAdjustment[] => {
    const out: QueryTermAdjustment[] = []
    for (const [value, b] of map) {
      const total = b.pos + b.neg
      if (total < MIN_SAMPLES_PER_AXIS) continue
      const net = b.pos - b.neg
      if (net === 0) continue
      out.push({
        axis,
        value,
        direction: net > 0 ? 'boost' : 'demote',
        sampleCount: total,
        netScore: net,
      })
    }
    out.sort((a, z) => {
      const magA = Math.abs(a.netScore)
      const magZ = Math.abs(z.netScore)
      if (magA !== magZ) return magZ - magA
      return a.value < z.value ? -1 : a.value > z.value ? 1 : 0
    })
    return out
  }

  const demote = [
    ...toAdjustments(byIndustry, 'industry'),
    ...toAdjustments(byRole, 'role'),
  ].filter(a => a.direction === 'demote')
  const boost = [
    ...toAdjustments(byIndustry, 'industry'),
    ...toAdjustments(byRole, 'role'),
  ].filter(a => a.direction === 'boost')

  return { demote, boost }
}

/**
 * Project computed adjustments into a SET of ICP terms to demote, keyed by
 * lowercase term. The query builder uses this to push demoted terms to the
 * back of the keyword list (not remove them — bounded effect).
 *
 * Only the industry axis maps to terms here (via INDUSTRY_KEYWORDS). The role
 * axis is reserved for a future increment that extracts roles from vacancy
 * headlines; until then role adjustments are computed but do not emit terms
 * (returned separately by `roleDemoteValues` for audit/future use).
 */
export function industryDemoteTerms(
  adjustments: ClientQueryAdjustments,
): Set<string> {
  const terms = new Set<string>()
  for (const a of adjustments.demote) {
    if (a.axis !== 'industry') continue
    const kw = INDUSTRY_KEYWORDS.get(a.value)
    if (!kw) continue
    for (const t of kw) terms.add(t.toLowerCase())
  }
  return terms
}

/** Role axis values flagged for demotion (for audit / future term mapping). */
export function roleDemoteValues(
  adjustments: ClientQueryAdjustments,
): string[] {
  return adjustments.demote
    .filter(a => a.axis === 'role')
    .map(a => a.value)
}

/** Role axis values flagged for boost (for audit / future term mapping). */
export function roleBoostValues(
  adjustments: ClientQueryAdjustments,
): string[] {
  return adjustments.boost
    .filter(a => a.axis === 'role')
    .map(a => a.value)
}
