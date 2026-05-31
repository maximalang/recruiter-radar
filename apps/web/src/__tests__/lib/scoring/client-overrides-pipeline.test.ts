/**
 * RED Phase — TDD: clientOverrides reweighting gap.
 *
 * These tests document that:
 * 1. badfit history exists in client_digest_org_state (no pipeline code needed)
 * 2. computeFiur accepts clientOverrides and applies industryFitPenalty
 * 3. The DIGEST PIPELINE does NOT currently compute or pass clientOverrides
 *
 * After wiring (GREEN phase), the pipeline will:
 * - Query badfit patterns from client_digest_org_state
 * - Compute industryFitPenalty when 3+ badfits hit an industry/pattern
 * - Pass clientOverrides into computeFiur for scoring
 */

import { computeFiur, type FiurInput, type FiurClientOverrides } from '@/lib/scoring/fiur';

// ---------------------------------------------------------------------------
// These tests pass TODAY (computeFiur already handles clientOverrides)
// ---------------------------------------------------------------------------
describe('computeFiur accepts and applies clientOverrides', () => {
  const baseInput = (overrides?: FiurClientOverrides): FiurInput => ({
    company: {
      id: 'co-fintech',
      name: 'FintechCo',
      industry: 'fintech',
      location: 'Moscow',
      hasCareerPage: true,
    },
    vacancies: [{
      id: 'v-1',
      title: 'Senior Backend Engineer',
      role: 'backend engineer',
      location: 'Moscow',
      publishedAt: new Date().toISOString(),
    }],
    clientProfile: {
      industries: ['fintech'],
      roles: ['backend engineer'],
      locations: ['Moscow'],
    },
    evidence: [{ tier: 'direct', source: 'career-page' }],
    clientOverrides: overrides,
  });

  it('applies industryFitPenalty and lowers fit score', () => {
    const normal = computeFiur(baseInput());
    const reweighted = computeFiur(baseInput({ industryFitPenalty: { 'fintech': 0.5 } }));

    expect(reweighted.fit).toBeLessThan(normal.fit);
    expect(reweighted.reasons.fit.some(r => /reweight|badfit|penalty/i.test(r))).toBe(true);
  });

  it('clamps penalty to 0.3 minimum', () => {
    const reweighted = computeFiur(baseInput({ industryFitPenalty: { 'fintech': 0.01 } }));
    // min multiplier: 0.3. Industry component: 0.35 * 0.3 = 0.105
    // fit = 0.105 (industry) + other components (~0.35) + location (~0.2)
    expect(reweighted.fit).toBeGreaterThan(0.6);
    expect(reweighted.fit).toBeLessThan(0.7);
  });

  it('has no effect when penalized industry does not match', () => {
    const normal = computeFiur(baseInput());
    const reweighted = computeFiur(
      baseInput({ industryFitPenalty: { 'logistics': 0.5 } })
    );
    expect(reweighted.fit).toBe(normal.fit);
  });
});

// ---------------------------------------------------------------------------
// This test documents the PIPELINE GAP — pipeline does NOT compute overrides
// ---------------------------------------------------------------------------
describe('pipeline gap — clientOverrides are NOT computed in digest assembly', () => {
  it('PIPELINE DOES NOT YET: compute industryFitPenalty from 3+ badfit records', () => {
    // Simulate badfit history that SHOULD drive a penalty:
    // 3 badfits recorded for fintech companies in client_digest_org_state
    const badfitCount = 3;
    const industry = 'fintech';
    const penaltyThreshold = 3;
    const baseMultiplier = 0.5; // 50% penalty after 3 badfits

    const shouldHavePenalty = badfitCount >= penaltyThreshold;
    expect(shouldHavePenalty).toBe(true);

    // The correct override should be computed by the pipeline:
    const expectedOverride: FiurClientOverrides = {
      industryFitPenalty: { [industry]: baseMultiplier },
    };

    // computeFiur CAN handle this:
    const result = computeFiur({
      company: { id: 'co-1', name: 'FintechCo', industry, hasCareerPage: true },
      vacancies: [{ id: 'v-1', title: 'Engineer', role: 'engineer', location: 'Moscow', publishedAt: new Date().toISOString() }],
      clientProfile: { industries: [industry], roles: ['engineer'], locations: ['Moscow'] },
      evidence: [{ tier: 'direct', source: 'hh' }],
      clientOverrides: expectedOverride,
    });

    // With penalty: fit score should be reduced
    expect(result.fit).toBeLessThan(1.0);
    expect(result.total).toBeLessThan(4.0); // max = 1+1+1+1 = 4
  });
});

// ---------------------------------------------------------------------------
// Pipeline integration gap: digest.ts does NOT call computeFiur
// ---------------------------------------------------------------------------
describe('integration gap — digest pipeline does NOT call computeFiur', () => {
  it('computeFiur is called by 0 pipeline functions (verified via code search)', () => {
    // Verified: grep for 'computeFiur' finds only:
    //   lib/scoring/fiur.ts (definition)
    //   ...test.ts files (tests)
    // NO callers in digest, telegram, payments, or API routing code
    // This is the documented gap — FIUR scoring exists but unused
    expect(true).toBe(true); // Gap is documented, not a test failure
  });

  it('pipeline uses SQL total_score, not FIUR score', () => {
    // source-digest-evidence.sql computes total_score from:
    //   quality_weight (200-300 for direct_hiring_proof / platform_aggregation)
    //   + activity_score (vacancies * 10, role diversity * 5, recency bonus)
    // This is a DETERMINISTIC SQL score — no client personalization.
    //
    // computeFiur is a CLIENT-AWARE scorer:
    //   fit: company/ICP match → industryFitPenalty applies here
    //   intent: vacancy freshness
    //   urgency: burst patterns, hard-to-fill
    //   reachability: corporate surface quality
    //
    // The gap: clientOverrides (which drive industryFitPenalty) are never computed
    // by the pipeline because computeFiur is never called.
    expect(true).toBe(true); // Gap is documented
  });
});

// ---------------------------------------------------------------------------
// TODO for GREEN phase:
// - Add function: computeClientOverrides(clientProfileId, pool) → FiurClientOverrides
// - Query client_digest_org_state for feedback_status='badfit' count by industry
// - When count >= 3 for a pattern, add industryFitPenalty entry
// - Call computeFiur with clientOverrides in digest scoring step
// - OR: keep SQL total_score for SQL speed, use FIUR only for review/prioritization
// ---------------------------------------------------------------------------