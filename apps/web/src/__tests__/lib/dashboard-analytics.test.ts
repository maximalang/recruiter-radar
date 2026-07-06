/**
 * Tests for dashboard analytics data fetching.
 *
 * Verifies feedback funnel, lead metrics over time,
 * and source performance comparison.
 */

import {
  getDashboardFeedbackFunnel,
  getDashboardLeadMetrics,
  getDashboardSourcePerformance,
} from '@/lib/dashboard-data';
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

describe('getDashboardFeedbackFunnel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty funnel when pool is not available', async () => {
    mockGetPool.mockReturnValue(null);
    const result = await getDashboardFeedbackFunnel();
    expect(result).toEqual([]);
  });

  it('returns feedback status distribution', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [
        { feedback_status: 'contacted', count: '10' },
        { feedback_status: 'dismissed', count: '5' },
        { feedback_status: 'snooze', count: '3' },
        { feedback_status: 'replied', count: '2' },
      ],
    });

    const result = await getDashboardFeedbackFunnel();
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ status: 'contacted', count: 10, label: 'В работе' });
    expect(result[1]).toEqual({ status: 'dismissed', count: 5, label: 'Мимо' });
  });

  it('excludes "none" status from funnel (SQL filters it)', async () => {
    makeMockPool();
    // The SQL query filters `feedback_status != 'none'`, so mock only returns non-none rows
    mockQuery.mockResolvedValueOnce({
      rows: [
        { feedback_status: 'contacted', count: '10' },
      ],
    });

    const result = await getDashboardFeedbackFunnel();
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('contacted');
  });

  it('handles empty results', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getDashboardFeedbackFunnel();
    expect(result).toEqual([]);
  });
});

describe('getDashboardLeadMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty metrics when pool is not available', async () => {
    mockGetPool.mockReturnValue(null);
    const result = await getDashboardLeadMetrics();
    expect(result.totalLeads).toBe(0);
    expect(result.avgScore).toBe(0);
    expect(result.todayLeads).toBe(0);
  });

  it('returns lead counts and average score', async () => {
    makeMockPool();

    // Total + today count
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '100', today: '5', avg_score: '23.5' }],
    });

    const result = await getDashboardLeadMetrics();
    expect(result.totalLeads).toBe(100);
    expect(result.todayLeads).toBe(5);
    expect(result.avgScore).toBe(23.5);
  });

  it('rounds average score to 1 decimal', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '10', today: '1', avg_score: '23.456' }],
    });

    const result = await getDashboardLeadMetrics();
    expect(result.avgScore).toBe(23.5);
  });

  it('handles zero leads gracefully', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '0', today: '0', avg_score: null }],
    });

    const result = await getDashboardLeadMetrics();
    expect(result.totalLeads).toBe(0);
    expect(result.avgScore).toBe(0);
  });
});

describe('getDashboardSourcePerformance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty array when pool is not available', async () => {
    mockGetPool.mockReturnValue(null);
    const result = await getDashboardSourcePerformance();
    expect(result).toEqual([]);
  });

  it('returns per-source lead counts', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [
        { source: 'hh', leads: '50', avg_score: '25.0' },
        { source: 'superjob', leads: '20', avg_score: '18.5' },
      ],
    });

    const result = await getDashboardSourcePerformance();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ source: 'hh', leads: 50, avgScore: 25.0 });
  });

  it('handles empty results', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getDashboardSourcePerformance();
    expect(result).toEqual([]);
  });
});
