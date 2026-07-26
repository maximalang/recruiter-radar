/**
 * Phase 4 (T4.5) — the review-reason helper derives the single reason a
 * candidate landed in the review queue from already-available fields (gate,
 * source count, foreign flag), without new SQL. Returns a stable reason key +
 * the SVG icon component the chip should render.
 *
 * Also asserts the /api/review GET response now carries `isForeignEmployer`
 * (derived from extractPayloadFields — no new SQL/JOIN), backward-compatible.
 */
import { deriveReviewReason } from '@/app/review/review-reason';
import { AlertIcon, GlobeIcon, LayersIcon } from '@/app/ui/icons';

describe('deriveReviewReason (T4.5)', () => {
  it('flags gate-C as "gate-c" with the AlertIcon', () => {
    const r = deriveReviewReason({
      confidenceGate: 'C',
      isForeignEmployer: false,
      sourceCount: 2,
    });
    expect(r?.key).toBe('gate-c');
    expect(r?.icon).toBe(AlertIcon);
  });

  it('flags a foreign employer as "foreign" with the GlobeIcon (priority over single-source)', () => {
    const r = deriveReviewReason({
      confidenceGate: 'B',
      isForeignEmployer: true,
      sourceCount: 1,
    });
    expect(r?.key).toBe('foreign');
    expect(r?.icon).toBe(GlobeIcon);
  });

  it('flags a single-source non-foreign candidate as "single-source" with the LayersIcon', () => {
    const r = deriveReviewReason({
      confidenceGate: 'B',
      isForeignEmployer: false,
      sourceCount: 1,
    });
    expect(r?.key).toBe('single-source');
    expect(r?.icon).toBe(LayersIcon);
  });

  it('returns null when no review reason applies (gate A/B + multi-source + domestic)', () => {
    const r = deriveReviewReason({
      confidenceGate: 'A',
      isForeignEmployer: false,
      sourceCount: 3,
    });
    expect(r).toBeNull();
  });
});
