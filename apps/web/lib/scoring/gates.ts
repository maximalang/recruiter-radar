/**
 * Confidence gate selector — docs/product.md §Confidence gates.
 *
 * | Gate | Condition                                                                            | Action                          |
 * | ---- | ------------------------------------------------------------------------------------ | ------------------------------- |
 * | A    | 2+ independent evidence layers, clean entity match, direct company surface           | Auto-deliver                    |
 * | B    | 1 strong source + enrichment/corroboration layer                                     | Auto-deliver with confidence    |
 * | C    | Platform-only aggregation or questionable entity match                               | Review before delivery          |
 * | D    | Context without direct hiring proof                                                  | Do not create lead              |
 *
 * Pure function. Pipeline must skip lead creation when this returns 'D'
 * and mark gate 'C' leads as pending_review (handled in lead pipeline,
 * not here).
 */

import type { FiurEvidenceItem } from './fiur'

export type ConfidenceGate = 'A' | 'B' | 'C' | 'D'

export type EntityMatchQuality = 'clean' | 'questionable'

export interface ConfidenceGateInput {
  evidence: FiurEvidenceItem[]
  entityMatch: EntityMatchQuality
}

export function selectConfidenceGate(input: ConfidenceGateInput): ConfidenceGate {
  const direct = input.evidence.filter((e) => e.tier === 'direct').length
  const corroboration = input.evidence.filter((e) => e.tier === 'corroboration').length

  if (direct === 0 && corroboration === 0) return 'D'

  if (input.entityMatch === 'questionable') return 'C'

  if (direct === 0) return 'C'

  if (direct >= 2 || (direct >= 1 && corroboration >= 1)) return 'A'

  return 'B'
}

// ─── Review status (analyst gate) ────────────────────────────────

/**
 * The `digest_candidates.review_status` values the pipeline writes.
 * `approved`/`rejected` are analyst decisions (written by /api/review POST),
 * never emitted here. `auto_approved` = passed all review rules; `pending_review`
 * = needs an analyst check before it can be delivered as a lead.
 */
export type ReviewStatus = 'auto_approved' | 'pending_review'

/**
 * Decide whether a freshly scored candidate needs analyst review before it is
 * delivered as a lead. Implements the contract documented in
 * docs/инфо о проекте.md §"обязательный analyst review" and lib/scoring/gates.ts:
 *   - confidence gate C (platform-only aggregation / questionable entity match)
 *   - foreign employer (no RU footprint — needs a human eyes-on check)
 *   - single source (no independent corroboration yet)
 *
 * Pure function so the rule is fully unit-testable without a DB. The digest
 * writer calls this per candidate and stores the result into
 * `digest_candidates.review_status`, which populates the /review queue and the
 * "На проверке" metric on /leads + /dashboard — wiring a queue that was
 * structurally empty before (the column defaulted to auto_approved and no
 * pipeline ever set pending_review).
 *
 * Returns the DB-enum string literal (not the analyst-only `approved`/`rejected`).
 */
export function deriveReviewStatus(input: {
  confidenceGate: string
  isForeignEmployer?: boolean
  sourceFamilies: readonly string[]
}): ReviewStatus {
  // Gate C — platform-only aggregation or questionable entity match. The gate
  // labels already call this "На проверке (C)"; routing it to pending_review
  // makes the label honest across /leads, /review, and /dashboard.
  if (input.confidenceGate === 'C') return 'pending_review'

  // Foreign employer — the score already carries a soft penalty, but a human
  // should confirm the company is a legitimate agency client target before it
  // surfaces as a lead.
  if (input.isForeignEmployer) return 'pending_review'

  // Single source — no independent corroboration. The doc's "первый lead для
  // нового source family" rule generalizes to: a candidate with only one
  // source family has not yet been independently confirmed.
  if (input.sourceFamilies.length <= 1) return 'pending_review'

  return 'auto_approved'
}

