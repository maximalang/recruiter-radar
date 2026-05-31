/**
 * Salary level analysis.
 *
 * Pure helper that turns a list of vacancy salary bands into a single
 * 0..1 hiring-intensity signal plus a categorical tier (low/mid/high/premium),
 * disclosure rate, and the median midpoint in RUB. Salary disclosure and
 * level both correlate with hiring seriousness — a company posting premium,
 * fully-disclosed bands is materially stronger than one posting "по итогам
 * собеседования".
 *
 * Currency: all bands are normalized to RUB. USD/EUR rates can be injected
 * via options for deterministic tests; sensible defaults apply otherwise.
 */

export type SalaryCurrency = 'RUB' | 'USD' | 'EUR'

export interface SalaryVacancyInput {
  salaryFrom?: number | null
  salaryTo?: number | null
  salaryCurrency?: SalaryCurrency
}

export type SalaryTier = 'low' | 'mid' | 'high' | 'premium' | 'unknown'

export interface SalaryAnalysisOptions {
  usdToRub?: number
  eurToRub?: number
}

export interface SalaryAnalysisResult {
  score: number
  tier: SalaryTier
  medianRub: number | null
  disclosureRate: number
  reasons: string[]
}

const DEFAULT_USD_RUB = 90
const DEFAULT_EUR_RUB = 100

const TIER_THRESHOLDS: Array<{ tier: SalaryTier; max: number; score: number }> = [
  { tier: 'low', max: 80_000, score: 0.25 },
  { tier: 'mid', max: 200_000, score: 0.55 },
  { tier: 'high', max: 400_000, score: 0.8 },
  { tier: 'premium', max: Number.POSITIVE_INFINITY, score: 1 },
]

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function midpointRub(
  vacancy: SalaryVacancyInput,
  options: Required<SalaryAnalysisOptions>
): number | null {
  const { salaryFrom, salaryTo } = vacancy
  const from = typeof salaryFrom === 'number' && salaryFrom > 0 ? salaryFrom : null
  const to = typeof salaryTo === 'number' && salaryTo > 0 ? salaryTo : null

  if (from === null && to === null) return null

  const raw = from !== null && to !== null ? (from + to) / 2 : (from ?? to)!

  switch (vacancy.salaryCurrency) {
    case 'USD':
      return raw * options.usdToRub
    case 'EUR':
      return raw * options.eurToRub
    case 'RUB':
    default:
      return raw
  }
}

function classifyTier(midpoint: number): {
  tier: SalaryTier
  score: number
} {
  for (const { tier, max, score } of TIER_THRESHOLDS) {
    if (midpoint < max) return { tier, score }
  }
  return { tier: 'premium', score: 1 }
}

export function analyzeSalaryLevel(
  vacancies: SalaryVacancyInput[],
  options: SalaryAnalysisOptions = {}
): SalaryAnalysisResult {
  const opts: Required<SalaryAnalysisOptions> = {
    usdToRub: options.usdToRub ?? DEFAULT_USD_RUB,
    eurToRub: options.eurToRub ?? DEFAULT_EUR_RUB,
  }

  if (vacancies.length === 0) {
    return {
      score: 0,
      tier: 'unknown',
      medianRub: null,
      disclosureRate: 0,
      reasons: [],
    }
  }

  const midpoints: number[] = []
  let disclosed = 0
  for (const v of vacancies) {
    const mid = midpointRub(v, opts)
    if (mid !== null) {
      midpoints.push(mid)
      disclosed += 1
    }
  }

  const disclosureRate = disclosed / vacancies.length

  if (midpoints.length === 0) {
    return {
      score: 0,
      tier: 'unknown',
      medianRub: null,
      disclosureRate,
      reasons: ['no salary disclosure across vacancies'],
    }
  }

  const med = median(midpoints)!
  const { tier, score: tierScore } = classifyTier(med)

  const score = clamp01(tierScore * (0.5 + 0.5 * disclosureRate))

  const reasons: string[] = []
  reasons.push(`salary tier: ${tier} (median ≈ ${Math.round(med).toLocaleString('ru-RU')} ₽)`)
  reasons.push(`disclosure rate: ${Math.round(disclosureRate * 100)}%`)

  return {
    score,
    tier,
    medianRub: med,
    disclosureRate,
    reasons,
  }
}
