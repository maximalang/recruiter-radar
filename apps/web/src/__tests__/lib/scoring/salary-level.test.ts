import {
  analyzeSalaryLevel,
} from '@/lib/scoring/salary-level'

const rub = (from?: number, to?: number) => ({
  salaryFrom: from,
  salaryTo: to,
  salaryCurrency: 'RUB' as const,
})

describe('analyzeSalaryLevel', () => {
  describe('contract', () => {
    it('returns zero score and tier "unknown" for empty input', () => {
      const result = analyzeSalaryLevel([])
      expect(result.score).toBe(0)
      expect(result.tier).toBe('unknown')
      expect(result.disclosureRate).toBe(0)
      expect(result.medianRub).toBeNull()
    })

    it('returns score in [0, 1]', () => {
      const result = analyzeSalaryLevel([rub(100_000, 150_000)])
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
    })
  })

  describe('disclosure rate', () => {
    it('flags a vacancy without salary as undisclosed', () => {
      const result = analyzeSalaryLevel([
        { salaryFrom: undefined, salaryTo: undefined },
        rub(100_000, 200_000),
      ])
      expect(result.disclosureRate).toBeCloseTo(0.5)
    })

    it('treats a single-bound salary (only "from" or only "to") as disclosed', () => {
      const result = analyzeSalaryLevel([rub(150_000, undefined), rub(undefined, 200_000)])
      expect(result.disclosureRate).toBe(1)
    })
  })

  describe('tier classification (RUB)', () => {
    it('classifies < 80k RUB midpoints as "low"', () => {
      const result = analyzeSalaryLevel([rub(50_000, 70_000)])
      expect(result.tier).toBe('low')
      expect(result.score).toBeLessThan(0.5)
    })

    it('classifies 80k..200k RUB midpoints as "mid"', () => {
      const result = analyzeSalaryLevel([rub(120_000, 180_000)])
      expect(result.tier).toBe('mid')
    })

    it('classifies 200k..400k RUB midpoints as "high"', () => {
      const result = analyzeSalaryLevel([rub(250_000, 350_000)])
      expect(result.tier).toBe('high')
    })

    it('classifies > 400k RUB midpoints as "premium" with the highest score', () => {
      const premium = analyzeSalaryLevel([rub(500_000, 700_000)])
      const high = analyzeSalaryLevel([rub(250_000, 350_000)])

      expect(premium.tier).toBe('premium')
      expect(premium.score).toBeGreaterThan(high.score)
    })
  })

  describe('currency normalization', () => {
    it('converts USD into RUB at the provided rate', () => {
      const result = analyzeSalaryLevel(
        [{ salaryFrom: 5000, salaryTo: 7000, salaryCurrency: 'USD' }],
        { usdToRub: 90 }
      )
      expect(result.medianRub).toBeCloseTo(540_000, -3)
      expect(result.tier).toBe('premium')
    })

    it('converts EUR into RUB at the provided rate', () => {
      const result = analyzeSalaryLevel(
        [{ salaryFrom: 4000, salaryTo: 5000, salaryCurrency: 'EUR' }],
        { eurToRub: 100 }
      )
      expect(result.medianRub).toBeCloseTo(450_000, -3)
    })

    it('uses default conversion rates when none are supplied', () => {
      const result = analyzeSalaryLevel([
        { salaryFrom: 3000, salaryTo: 4000, salaryCurrency: 'USD' },
      ])
      expect(result.medianRub).toBeGreaterThan(0)
    })
  })

  describe('aggregation', () => {
    it('reports the median (p50) midpoint across vacancies', () => {
      const result = analyzeSalaryLevel([
        rub(80_000, 120_000),
        rub(150_000, 250_000),
        rub(300_000, 400_000),
      ])
      expect(result.medianRub).toBeCloseTo(200_000, -3)
    })

    it('a stronger overall band yields a higher score than a weaker one', () => {
      const strong = analyzeSalaryLevel([
        rub(250_000, 300_000),
        rub(280_000, 350_000),
      ])
      const weak = analyzeSalaryLevel([rub(40_000, 60_000), rub(50_000, 70_000)])
      expect(strong.score).toBeGreaterThan(weak.score)
    })
  })

  describe('reasons', () => {
    it('includes the tier and disclosure rate in reasons', () => {
      const result = analyzeSalaryLevel([rub(250_000, 350_000), rub(undefined, undefined)])
      expect(result.reasons.some((r) => /high/i.test(r))).toBe(true)
      expect(result.reasons.some((r) => /disclos/i.test(r))).toBe(true)
    })
  })
})
