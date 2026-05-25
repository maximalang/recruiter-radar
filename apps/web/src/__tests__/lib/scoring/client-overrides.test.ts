/**
 * Unit tests for client-overrides.ts
 * computeClientOverrides reads badfit history and builds FiurClientOverrides.
 */

import { computeClientOverrides } from '@/lib/scoring/client-overrides';

// ---------------------------------------------------------------------------
// Mock DB client for controlled testing
// ---------------------------------------------------------------------------
function mockPool(rows: { industry: string; badfit_count: string }[], rowCount?: number) {
  return {
    query: async (_sql: string, _params: unknown[]) => ({
      rows,
      rowCount: rowCount ?? rows.length,
    }),
  } as unknown as Parameters<typeof computeClientOverrides>[1];
}

describe('computeClientOverrides — logic', () => {
  it('returns empty overrides when no badfit rows', async () => {
    const result = await computeClientOverrides(1, mockPool([]));
    expect(result).toEqual({
      overrides: {},
      penalizedIndustries: [],
      totalBadfits: 0,
    });
  });

  it('returns empty overrides when no rows meet BADFIT_THRESHOLD=3', async () => {
    const result = await computeClientOverrides(1, mockPool([
      { industry: 'fintech', badfit_count: '2' },
      { industry: 'logistics', badfit_count: '1' },
    ]));
    expect(result!.overrides).toEqual({});
    expect(result!.penalizedIndustries).toHaveLength(0);
  });

  it('applies 50% penalty when badfit count >= 3', async () => {
    const result = await computeClientOverrides(1, mockPool([
      { industry: 'fintech', badfit_count: '5' },
    ]));
    expect(result!.overrides.industryFitPenalty).toEqual({ 'fintech': 0.5 });
    expect(result!.penalizedIndustries).toEqual(['fintech']);
    expect(result!.totalBadfits).toBe(5);
  });

  it('handles multiple penalized industries', async () => {
    const result = await computeClientOverrides(1, mockPool([
      { industry: 'fintech', badfit_count: '5' },
      { industry: 'logistics', badfit_count: '3' },
      { industry: 'retail', badfit_count: '2' }, // below threshold
    ]));
    expect(result!.overrides.industryFitPenalty).toEqual({
      'fintech': 0.5,
      'logistics': 0.5,
    });
    expect(result!.penalizedIndustries).toHaveLength(2);
    expect(result!.totalBadfits).toBe(8);
  });

  it('normalizes industry names to lowercase (SQL LOWER(TRIM) applied before return)', async () => {
    // Mock simulates SQL: rows returned are already LOWER(TRIM(...)) normalized
    // In production, SQL normalizes; mock must mirror that behavior
    const result = await computeClientOverrides(1, mockPool([
      { industry: 'fintech', badfit_count: '3' }, // already lowercase per SQL
    ]));
    expect(result!.overrides.industryFitPenalty).toHaveProperty('fintech');
  });

  it('ignores null/empty industry rows', async () => {
    const result = await computeClientOverrides(1, mockPool([
      { industry: 'fintech', badfit_count: '5' },
      { industry: '', badfit_count: '10' },
      { industry: '   ', badfit_count: '7' },
    ]));
    expect(Object.keys(result!.overrides.industryFitPenalty ?? {})).toEqual(['fintech']);
  });

  it('sorts penalized industries by badfit count descending', async () => {
    const result = await computeClientOverrides(1, mockPool([
      { industry: 'retail', badfit_count: '4' },
      { industry: 'fintech', badfit_count: '10' },
      { industry: 'logistics', badfit_count: '3' },
    ]));
    expect(result!.penalizedIndustries).toEqual(['fintech', 'retail', 'logistics']);
  });

  it('accepts string or number clientProfileId', async () => {
    const result1 = await computeClientOverrides(123, mockPool([]));
    const result2 = await computeClientOverrides('456', mockPool([]));
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });
});

describe('computeClientOverrides — no DATABASE_URL', () => {
  const originalDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = originalDbUrl;
  });

  it('returns null when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;
    const result = await computeClientOverrides(1);
    expect(result).toBeNull();
  });
});