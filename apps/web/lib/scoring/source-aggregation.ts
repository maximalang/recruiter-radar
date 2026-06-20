/**
 * Source-reliability evidence aggregator.
 *
 * Pure helper that takes a flat list of evidence items (each tagged with
 * source family and tier) and returns a single aggregate weight in [0,1],
 * a per-source breakdown, the count of independent source families, and a
 * multi-source confirmation flag. Feeds Intent and confidence gates without
 * coupling to runtime adapters.
 */

import type { EvidenceTier } from '@/lib/db/evidence'

export interface AggregationInput {
  source: string
  tier: EvidenceTier
  fetchedAt: string | Date
}

export interface SourceBreakdownEntry {
  source: string
  weight: number
  itemCount: number
  topTier: EvidenceTier
}

export interface AggregationResult {
  weight: number
  independentSources: number
  hasMultiSourceConfirmation: boolean
  breakdown: SourceBreakdownEntry[]
}

const SOURCE_BASE_WEIGHTS: Record<string, number> = {
  career_page: 0.45,
  hh: 0.35,
  rabota_rossii: 0.2,
  news: 0.1,
  social: 0.08,
  egrul: 0.15,
  funding: 0.18,
}

const DEFAULT_SOURCE_WEIGHT = 0.1

const TIER_MULTIPLIER: Record<EvidenceTier, number> = {
  direct: 1.0,
  corroboration: 0.6,
  context: 0.3,
}

const TIER_RANK: Record<EvidenceTier, number> = {
  direct: 2,
  corroboration: 1,
  context: 0,
}

/**
 * Graduated multi-source confirmation bonus, keyed on the count of independent
 * *strong* source families (direct/corroboration). More independent layers of
 * evidence is a stronger "why now" signal, so the bonus is tiered rather than
 * flat: 3+ strong sources outrank exactly 2. Weak (context-only) sources never
 * trigger a bonus — they corroborate, they don't confirm.
 */
const MULTI_SOURCE_BONUS_TIERS: ReadonlyArray<{ minStrongSources: number; bonus: number }> = [
  { minStrongSources: 3, bonus: 0.35 },
  { minStrongSources: 2, bonus: 0.2 },
]

function multiSourceBonus(strongSources: number): number {
  for (const tier of MULTI_SOURCE_BONUS_TIERS) {
    if (strongSources >= tier.minStrongSources) return tier.bonus
  }
  return 0
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function baseWeightFor(source: string): number {
  return SOURCE_BASE_WEIGHTS[source] ?? DEFAULT_SOURCE_WEIGHT
}

export function aggregateSourceSignals(items: AggregationInput[]): AggregationResult {
  if (items.length === 0) {
    return {
      weight: 0,
      independentSources: 0,
      hasMultiSourceConfirmation: false,
      breakdown: [],
    }
  }

  const bySource = new Map<string, { itemCount: number; topTier: EvidenceTier }>()
  for (const item of items) {
    const existing = bySource.get(item.source)
    if (!existing) {
      bySource.set(item.source, { itemCount: 1, topTier: item.tier })
    } else {
      existing.itemCount += 1
      if (TIER_RANK[item.tier] > TIER_RANK[existing.topTier]) {
        existing.topTier = item.tier
      }
    }
  }

  const breakdown: SourceBreakdownEntry[] = []
  let baseWeight = 0
  for (const [source, info] of bySource.entries()) {
    const w = baseWeightFor(source) * TIER_MULTIPLIER[info.topTier]
    breakdown.push({ source, weight: w, itemCount: info.itemCount, topTier: info.topTier })
    baseWeight += w
  }

  const strongSources = breakdown.filter(
    (b) => b.topTier === 'direct' || b.topTier === 'corroboration'
  ).length
  const hasMultiSourceConfirmation = strongSources >= 2

  const weight = clamp01(baseWeight + multiSourceBonus(strongSources))

  return {
    weight,
    independentSources: bySource.size,
    hasMultiSourceConfirmation,
    breakdown,
  }
}
