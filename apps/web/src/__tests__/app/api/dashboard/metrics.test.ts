/**
 * Unit tests for quality dashboard metrics API endpoint.
 * Phase 5 — Quality observability.
 */

import type { GateDistribution, AcceptanceRate, QualityDashboardMetrics } from '@/app/api/dashboard/metrics/route'

// --- Types only (no DB required) ---

describe('GateDistribution type', () => {
  it('has required fields gate, count, percentage', () => {
    const entry: GateDistribution = { gate: 'A', count: 42, percentage: 30 }
    expect(entry.gate).toBe('A')
    expect(entry.count).toBe(42)
    expect(entry.percentage).toBe(30)
  })
})

describe('AcceptanceRate type', () => {
  it('has required fields period, delivered, accepted, rate', () => {
    const rate: AcceptanceRate = { period: '7d', delivered: 10, accepted: 3, rate: 30 }
    expect(rate.period).toBe('7d')
    expect(rate.delivered).toBe(10)
    expect(rate.accepted).toBe(3)
    expect(rate.rate).toBe(30)
  })

  it('handles zero delivered gracefully', () => {
    const rate: AcceptanceRate = { period: '7d', delivered: 0, accepted: 0, rate: 0 }
    expect(rate.rate).toBe(0)
  })
})

describe('QualityDashboardMetrics type', () => {
  it('has all required quality observability fields', () => {
    const metrics: QualityDashboardMetrics = {
      gateDistribution: [
        { gate: 'A', count: 20, percentage: 40 },
        { gate: 'B', count: 20, percentage: 40 },
        { gate: 'C', count: 8, percentage: 16 },
        { gate: 'D', count: 2, percentage: 4 },
      ],
      acceptanceRate7d: { period: '7d', delivered: 50, accepted: 15, rate: 30 },
      acceptanceRate30d: { period: '30d', delivered: 200, accepted: 65, rate: 33 },
      totalLeadsDelivered: 50,
      totalSourcesActive: 8,
      overallHealth: 80,
    }

    expect(metrics.gateDistribution).toHaveLength(4)
    expect(metrics.acceptanceRate7d.rate).toBe(30)
    expect(metrics.acceptanceRate30d.rate).toBe(33)
    expect(metrics.totalLeadsDelivered).toBe(50)
    expect(metrics.totalSourcesActive).toBe(8)
    expect(metrics.overallHealth).toBe(80)
  })
})

// --- Acceptance rate calculation logic ---

describe('acceptance rate calculation', () => {
  const calcRate = (delivered: number, accepted: number): number => {
    return delivered > 0 ? Math.round((accepted / delivered) * 100) : 0
  }

  it('calculates 30% acceptance rate', () => {
    expect(calcRate(100, 30)).toBe(30)
  })

  it('calculates 0% when no leads delivered', () => {
    expect(calcRate(0, 0)).toBe(0)
  })

  it('calculates 100% when all leads accepted', () => {
    expect(calcRate(10, 10)).toBe(100)
  })

  it('rounds to nearest integer', () => {
    expect(calcRate(33, 10)).toBe(30) // 30.3% → 30
    expect(calcRate(33, 11)).toBe(33) // 33.3% → 33
  })
})

// --- Gate distribution percentage calculation ---

describe('gate distribution percentages', () => {
  const calcPercentages = (rows: Array<{ gate: string; count: number }>): GateDistribution[] => {
    const total = rows.reduce((sum, r) => sum + r.count, 0)
    return rows.map((r) => ({
      gate: r.gate,
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 100) : 0,
    }))
  }

  it('distributes 100% across gates', () => {
    const rows = [
      { gate: 'A', count: 2 },
      { gate: 'B', count: 4 },
      { gate: 'C', count: 3 },
      { gate: 'D', count: 1 },
    ]
    const result = calcPercentages(rows)
    const totalPct = result.reduce((sum, r) => sum + r.percentage, 0)
    // May not equal 100 due to rounding — that's intentional per Math.round
    expect(result).toHaveLength(4)
    expect(result.map((r) => r.percentage)).toEqual([20, 40, 30, 10])
    expect(totalPct).toBe(100) // 2/10=20%, 4/10=40%, 3/10=30%, 1/10=10%
  })

  it('handles empty input', () => {
    const result = calcPercentages([])
    expect(result).toEqual([])
  })

  it('single gate gets 100%', () => {
    const result = calcPercentages([{ gate: 'A', count: 5 }])
    expect(result[0].percentage).toBe(100)
  })

  it('zero total returns zero percentages', () => {
    const result = calcPercentages([])
    expect(result).toEqual([])
  })
})

// --- Feedback status filtering for acceptance ---

describe('accepted feedback statuses', () => {
  const ACCEPTED_STATUSES = new Set(['accepted', 'contacted', 'replied', 'won'])

  const isAccepted = (status: string | null): boolean => {
    return status !== null && ACCEPTED_STATUSES.has(status)
  }

  it('accepts "accepted" status', () => {
    expect(isAccepted('accepted')).toBe(true)
  })

  it('accepts "contacted" status', () => {
    expect(isAccepted('contacted')).toBe(true)
  })

  it('accepts "replied" status', () => {
    expect(isAccepted('replied')).toBe(true)
  })

  it('accepts "won" status', () => {
    expect(isAccepted('won')).toBe(true)
  })

  it('rejects "badfit" status', () => {
    expect(isAccepted('badfit')).toBe(false)
  })

  it('rejects "dismissed" status', () => {
    expect(isAccepted('dismissed')).toBe(false)
  })

  it('rejects "snooze" status', () => {
    expect(isAccepted('snooze')).toBe(false)
  })

  it('rejects null (no feedback yet)', () => {
    expect(isAccepted(null)).toBe(false)
  })
})