/**
 * Tests for getLeadsForProfile filtering.
 *
 * Verifies that confidenceGate and feedbackStatus filters
 * are applied correctly in the SQL query.
 */

import { getLeadsForProfile } from '@/lib/leads-data';
import { getPool } from '@/lib/db';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

const mockQuery = jest.fn();
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

function makeMockPool() {
  mockGetPool.mockReturnValue({
    query: mockQuery,
  } as never);
}

describe('getLeadsForProfile filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty results when pool is null', async () => {
    mockGetPool.mockReturnValue(null);
    const result = await getLeadsForProfile({ clientProfileId: '1' });
    expect(result.leads).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('applies confidenceGate filter to both count and data queries', async () => {
    makeMockPool();

    // Count query
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });
    // Data query
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getLeadsForProfile({ clientProfileId: '1', confidenceGate: 'A' });

    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Both queries should include confidence_gate = 'A' condition
    const countSql = mockQuery.mock.calls[0][0] as string;
    const dataSql = mockQuery.mock.calls[1][0] as string;
    expect(countSql).toContain("confidence_gate");
    expect(dataSql).toContain("confidence_gate");
  });

  it('applies feedbackStatus filter', async () => {
    makeMockPool();

    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getLeadsForProfile({ clientProfileId: '1', feedbackStatus: 'accepted' });

    const countSql = mockQuery.mock.calls[0][0] as string;
    expect(countSql).toContain("feedback_status");
  });

  it('combines multiple filters', async () => {
    makeMockPool();

    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getLeadsForProfile({
      clientProfileId: '1',
      confidenceGate: 'B',
      feedbackStatus: 'dismissed',
    });

    const countSql = mockQuery.mock.calls[0][0] as string;
    expect(countSql).toContain("confidence_gate");
    expect(countSql).toContain("feedback_status");
  });

  it('does not add filter conditions when filters are null', async () => {
    makeMockPool();

    mockQuery.mockResolvedValueOnce({ rows: [{ count: '10' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getLeadsForProfile({
      clientProfileId: '1',
      confidenceGate: null,
      feedbackStatus: null,
    });

    const countSql = mockQuery.mock.calls[0][0] as string;
    // Only client_profile_id condition
    expect(countSql).toContain("client_profile_id");
    expect(countSql).not.toContain("confidence_gate");
    expect(countSql).not.toContain("feedback_status");
  });

  it('handles feedbackStatus "none" with IS NULL OR = none condition', async () => {
    makeMockPool();

    mockQuery.mockResolvedValueOnce({ rows: [{ count: '7' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getLeadsForProfile({ clientProfileId: '1', feedbackStatus: 'none' });

    const countSql = mockQuery.mock.calls[0][0] as string;
    expect(countSql).toContain("feedback_status IS NULL");
    expect(countSql).toContain("feedback_status = 'none'");

    // Should NOT use parameterized value for 'none' — it's embedded in SQL
    const countParams = mockQuery.mock.calls[0][1] as unknown[];
    // Only clientProfileId param, no extra param for 'none'
    expect(countParams).toEqual(['1']);
  });
});
