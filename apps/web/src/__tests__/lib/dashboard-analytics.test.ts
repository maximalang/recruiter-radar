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
  getDashboardSourceEvidenceQuality,
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

describe('getDashboardSourceEvidenceQuality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty array when pool is not available', async () => {
    mockGetPool.mockReturnValue(null);
    const result = await getDashboardSourceEvidenceQuality();
    expect(result).toEqual([]);
  });

  it('returns per-source gate + evidence-quality distribution', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          source: 'career-pages',
          leads: '40',
          gate_a: '12',
          gate_b: '20',
          gate_c: '8',
          gate_d: '0',
          direct: '32',
          platform: '8',
          context: '0',
          avg_age_days: '4.5',
        },
        {
          source: 'hh',
          leads: '30',
          gate_a: '0',
          gate_b: '5',
          gate_c: '25',
          gate_d: '0',
          direct: '0',
          platform: '30',
          context: '0',
          avg_age_days: null,
        },
      ],
    });

    const result = await getDashboardSourceEvidenceQuality();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      source: 'career-pages',
      leads: 40,
      gateA: 12,
      gateB: 20,
      gateC: 8,
      gateD: 0,
      directHiringProof: 32,
      platformAggregation: 8,
      enrichmentContext: 0,
      avgAgeDays: 4.5,
    });
    expect(result[1].gateC).toBe(25);
    expect(result[1].platformAggregation).toBe(30);
    expect(result[1].directHiringProof).toBe(0);
    expect(result[1].avgAgeDays).toBeNull();
  });

  it('handles empty results', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getDashboardSourceEvidenceQuality();
    expect(result).toEqual([]);
  });

  it('parses integer counts from string columns', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          source: 'habr-career',
          leads: '7',
          gate_a: '0',
          gate_b: '1',
          gate_c: '6',
          gate_d: '0',
          direct: '0',
          platform: '7',
          context: '0',
          avg_age_days: '12.3',
        },
      ],
    });
    const result = await getDashboardSourceEvidenceQuality();
    expect(result[0].leads).toBe(7);
    expect(result[0].gateB).toBe(1);
    expect(result[0].gateC).toBe(6);
    expect(result[0].avgAgeDays).toBe(12.3);
  });
});
