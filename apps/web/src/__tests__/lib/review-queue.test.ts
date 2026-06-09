/**
 * Tests for the review queue system.
 *
 * Per product concept §Human-in-the-loop review queue:
 * - Score ≥ 80 + confidence gate < A → auto pending_review
 * - First lead from new source family → pending_review
 * - Single source only → pending_review
 * - Questionable entity match → pending_review
 * - Personal contact data → pending_review
 */

import { needsReview, type ReviewCheckInput } from '@/lib/review-queue'

describe('needsReview', () => {
  const baseInput: ReviewCheckInput = {
    score: 2.5,
    confidenceGate: 'B',
    sourceFamilies: ['hh', 'career-pages'],
    isFirstLeadFromSource: false,
    hasPersonalContactData: false,
    entityMatchQuality: 'clean',
  }

  it('does not flag A-gate lead with score < 3.2', () => {
    expect(needsReview({ ...baseInput, score: 2.8, confidenceGate: 'A' })).toBe(false)
  })

  it('flags score ≥ 3.2 with gate B (high score, not A)', () => {
    expect(needsReview({ ...baseInput, score: 3.2, confidenceGate: 'B' })).toBe(true)
  })

  it('flags score ≥ 3.2 with gate C', () => {
    expect(needsReview({ ...baseInput, score: 3.5, confidenceGate: 'C' })).toBe(true)
  })

  it('does not flag score < 3.2 with gate B', () => {
    expect(needsReview({ ...baseInput, score: 3.0, confidenceGate: 'B' })).toBe(false)
  })

  it('flags first lead from new source family', () => {
    expect(needsReview({ ...baseInput, isFirstLeadFromSource: true })).toBe(true)
  })

  it('flags questionable entity match', () => {
    expect(needsReview({ ...baseInput, entityMatchQuality: 'questionable' })).toBe(true)
  })

  it('flags personal contact data', () => {
    expect(needsReview({ ...baseInput, hasPersonalContactData: true })).toBe(true)
  })

  it('does not flag clean lead with gate A', () => {
    expect(needsReview({ ...baseInput, score: 90, confidenceGate: 'A' })).toBe(false)
  })

  it('flags single source (only one source family)', () => {
    expect(needsReview({ ...baseInput, sourceFamilies: ['hh'] })).toBe(true)
  })

  it('does not flag multi-source lead with gate A and no risk factors', () => {
    expect(needsReview(baseInput)).toBe(false)
  })
})
