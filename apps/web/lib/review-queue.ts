/**
 * Review queue logic — determines which leads require human review
 * before delivery to the agency.
 *
 * Per product concept §Human-in-the-loop review queue:
 * "машина делает 95% pipeline, человек проверяет 5% самых рискованных hot leads"
 *
 * Rules from concept:
 * 1. Score ≥ 80 and confidence gate < A → mandatory analyst review
 * 2. First lead from a new source family → mandatory analyst review
 * 3. Questionable entity match → mandatory analyst review
 * 4. Personal contact data present → mandatory compliance review
 * 5. Single source only (no independent confirmation) → review
 */

export type ReviewReason =
  | 'high-score-low-confidence'
  | 'first-lead-from-source'
  | 'questionable-entity-match'
  | 'personal-contact-data'
  | 'single-source'

export interface ReviewCheckInput {
  /** FIUR total score ∈ [0, 4] — concept uses score ≥ 80 but our scale is [0,4], so ≥ 3.2 */
  score: number
  /** Confidence gate from selectConfidenceGate */
  confidenceGate: 'A' | 'B' | 'C' | 'D'
  /** Source families contributing to this lead */
  sourceFamilies: string[]
  /** Is this the first lead from a new source family for this client? */
  isFirstLeadFromSource: boolean
  /** Does the evidence contain personal contact data? */
  hasPersonalContactData: boolean
  /** Entity match quality from entity resolution */
  entityMatchQuality: 'clean' | 'questionable'
}

/**
 * Determine whether a lead needs human review before delivery.
 * Returns true if ANY review rule is triggered.
 */
export function needsReview(input: ReviewCheckInput): boolean {
  // Rule 1: Score ≥ 3.2 (≈80 on 0-100 scale) + gate < A
  // Our FIUR scale is [0, 4], so 80% of 4 = 3.2
  if (input.score >= 3.2 && input.confidenceGate !== 'A') {
    return true
  }

  // Rule 2: First lead from a new source family
  if (input.isFirstLeadFromSource) {
    return true
  }

  // Rule 3: Questionable entity match
  if (input.entityMatchQuality === 'questionable') {
    return true
  }

  // Rule 4: Personal contact data present
  if (input.hasPersonalContactData) {
    return true
  }

  // Rule 5: Single source — no independent confirmation
  if (input.sourceFamilies.length <= 1) {
    return true
  }

  return false
}

/**
 * Get the specific review reasons for a lead.
 * Useful for displaying in the review UI why a lead was flagged.
 */
export function getReviewReasons(input: ReviewCheckInput): ReviewReason[] {
  const reasons: ReviewReason[] = []

  if (input.score >= 3.2 && input.confidenceGate !== 'A') {
    reasons.push('high-score-low-confidence')
  }
  if (input.isFirstLeadFromSource) {
    reasons.push('first-lead-from-source')
  }
  if (input.entityMatchQuality === 'questionable') {
    reasons.push('questionable-entity-match')
  }
  if (input.hasPersonalContactData) {
    reasons.push('personal-contact-data')
  }
  if (input.sourceFamilies.length <= 1) {
    reasons.push('single-source')
  }

  return reasons
}
