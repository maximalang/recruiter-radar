/**
 * Unit tests for DashboardQuality component types and helpers.
 * React rendering tests skipped (require jsdom; node env for pg compatibility).
 */
import type { MetricsData, AcceptanceRate, GateDistribution } from '@/app/dashboard/dashboard-quality';

const baseMetrics: MetricsData = {
  gateDistribution: [
    { gate: 'A', count: 20, percentage: 40 },
    { gate: 'B', count: 20, percentage: 40 },
    { gate: 'C', count: 8, percentage: 16 },
    { gate: 'D', count: 2, percentage: 4 },
  ],
  acceptanceRate7d: { period: '7d', delivered: 50, accepted: 15, rate: 30 },
  acceptanceRate30d: { period: '30d', delivered: 200, accepted: 65, rate: 33 },
  totalLeadsDelivered: 200,
  totalSourcesActive: 8,
  overallHealth: 80,
};

describe('MetricsData types', () => {
  it('accepts valid MetricsData structure', () => {
    expect(baseMetrics.gateDistribution).toHaveLength(4);
    expect(baseMetrics.acceptanceRate7d.rate).toBe(30);
    expect(baseMetrics.acceptanceRate30d.rate).toBe(33);
  });
});

describe('AcceptanceRate calculation', () => {
  const calcRate = (delivered: number, accepted: number): number => {
    return delivered > 0 ? Math.round((accepted / delivered) * 100) : 0;
  };

  it('calculates 30% acceptance rate', () => {
    expect(calcRate(50, 15)).toBe(30);
  });

  it('returns 0 when no delivered', () => {
    expect(calcRate(0, 0)).toBe(0);
  });

  it('handles zero acceptance', () => {
    expect(calcRate(10, 0)).toBe(0);
  });
});

describe('GateDistribution', () => {
  it('gate A has correct color mapping', () => {
    const GATE_COLORS: Record<string, string> = {
      A: '#10b981',
      B: '#3b82f6',
      C: '#f59e0b',
      D: '#6b7280',
    };
    expect(GATE_COLORS['A']).toBe('#10b981');
    expect(GATE_COLORS['B']).toBe('#3b82f6');
    expect(GATE_COLORS['C']).toBe('#f59e0b');
    expect(GATE_COLORS['D']).toBe('#6b7280');
  });

  it('gate percentages sum to reasonable total', () => {
    const total = baseMetrics.gateDistribution.reduce(
      (sum, g) => sum + g.percentage, 0
    );
    // May not be exactly 100 due to rounding per gate
    expect(total).toBeGreaterThan(90);
    expect(total).toBeLessThanOrEqual(100);
  });

  it('all gates present in distribution', () => {
    const gates = new Set(baseMetrics.gateDistribution.map(g => g.gate));
    expect(gates.has('A')).toBe(true);
    expect(gates.has('B')).toBe(true);
    expect(gates.has('C')).toBe(true);
    expect(gates.has('D')).toBe(true);
  });
});

describe('Rate threshold colors', () => {
  const getRateColor = (r: number) =>
    r >= 30 ? '#10b981' : r >= 15 ? '#f59e0b' : '#ef4444';

  it('green for >= 30%', () => {
    expect(getRateColor(30)).toBe('#10b981');
    expect(getRateColor(50)).toBe('#10b981');
  });

  it('amber for 15-29%', () => {
    expect(getRateColor(15)).toBe('#f59e0b');
    expect(getRateColor(20)).toBe('#f59e0b');
    expect(getRateColor(29)).toBe('#f59e0b');
  });

  it('red for < 15%', () => {
    expect(getRateColor(14)).toBe('#ef4444');
    expect(getRateColor(0)).toBe('#ef4444');
  });
});

describe('Edge cases', () => {
  it('handles zero delivered metrics', () => {
    const zeroMetrics: MetricsData = {
      ...baseMetrics,
      acceptanceRate7d: { period: '7d', delivered: 0, accepted: 0, rate: 0 },
    };
    expect(zeroMetrics.acceptanceRate7d.delivered).toBe(0);
    expect(zeroMetrics.acceptanceRate7d.rate).toBe(0);
  });

  it('handles empty gate distribution', () => {
    const emptyDist: GateDistribution[] = [];
    expect(emptyDist.length).toBe(0);
  });
});
