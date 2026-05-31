/**
 * Market-fit scorer.
 *
 * Pure helper that combines an industry trend, per-company growth signals,
 * and expansion-into-new-market evidence into a single 0..1 score with
 * explainable reasons. Feeds the Market Fit slot in agency lead scoring
 * and Urgency in FIUR (a company expanding inside a growing market is more
 * urgent to contact than one in a declining one).
 *
 * Inputs are deliberately additive — callers can supply whatever signals
 * are available and missing fields contribute zero rather than penalize.
 */

export type IndustryTrend = 'growing' | 'stable' | 'declining'

export type GrowthSignalKind =
  | 'funding-round'
  | 'office-expansion'
  | 'new-product'
  | 'leadership-hire'
  | 'media-mention'
  | 'partnership'
  | 'acquisition'

export interface MarketFitInput {
  industryTrend?: IndustryTrend
  growthSignals?: string[]
  expandingIntoNewMarket?: boolean
}

export interface MarketFitResult {
  score: number
  reasons: string[]
}

const TREND_WEIGHTS: Record<IndustryTrend, number> = {
  growing: 0.3,
  stable: 0.1,
  declining: -0.1,
}

const GROWTH_SIGNAL_WEIGHTS: Record<GrowthSignalKind, number> = {
  'funding-round': 0.25,
  'office-expansion': 0.15,
  'new-product': 0.12,
  'leadership-hire': 0.1,
  'media-mention': 0.08,
  partnership: 0.1,
  acquisition: 0.18,
}

const EXPANSION_WEIGHT = 0.15
const SIGNAL_CAP = 0.6

const KNOWN_SIGNALS = new Set<string>(Object.keys(GROWTH_SIGNAL_WEIGHTS))

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function humanizeSignal(signal: GrowthSignalKind): string {
  return signal.replace(/-/g, ' ')
}

export function computeMarketFit(input: MarketFitInput): MarketFitResult {
  const reasons: string[] = []
  let score = 0

  if (input.industryTrend) {
    score += TREND_WEIGHTS[input.industryTrend]
    if (input.industryTrend === 'growing') {
      reasons.push('industry is growing')
    } else if (input.industryTrend === 'declining') {
      reasons.push('industry is declining (penalty applied)')
    }
  }

  const uniqueSignals = new Set<string>(input.growthSignals ?? [])
  let signalScore = 0
  for (const raw of uniqueSignals) {
    if (!KNOWN_SIGNALS.has(raw)) continue
    const kind = raw as GrowthSignalKind
    signalScore += GROWTH_SIGNAL_WEIGHTS[kind]
    reasons.push(`growth signal: ${humanizeSignal(kind)}`)
  }
  score += Math.min(SIGNAL_CAP, signalScore)

  if (input.expandingIntoNewMarket) {
    score += EXPANSION_WEIGHT
    reasons.push('company is expanding into a new market')
  }

  return { score: clamp01(score), reasons }
}
