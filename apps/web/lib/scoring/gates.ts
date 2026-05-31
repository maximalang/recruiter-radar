/**
 * Confidence gate selector — docs/product.md §Confidence gates.
 *
 * | Gate | Condition                                                                            | Action                          |
 * | ---- | ------------------------------------------------------------------------------------ | ------------------------------- |
 * | A    | 2+ independent evidence layers, clean entity match, direct company surface           | Auto-deliver                    |
 * | B    | 1 strong source + enrichment/corroboration layer                                     | Auto-deliver with confidence    |
 * | C    | Platform-only aggregation or questionable entity match                               | Review before delivery          |
 * | D    | Context without direct hiring proof                                                  | Do not create lead              |
 *
 * Pure function. Pipeline must skip lead creation when this returns 'D'
 * and mark gate 'C' leads as pending_review (handled in lead pipeline,
 * not here).
 */

import type { FiurEvidenceItem } from './fiur'

export type ConfidenceGate = 'A' | 'B' | 'C' | 'D'

export type EntityMatchQuality = 'clean' | 'questionable'

export interface ConfidenceGateInput {
  evidence: FiurEvidenceItem[]
  entityMatch: EntityMatchQuality
}

export function selectConfidenceGate(input: ConfidenceGateInput): ConfidenceGate {
  const direct = input.evidence.filter((e) => e.tier === 'direct').length
  const corroboration = input.evidence.filter((e) => e.tier === 'corroboration').length

  if (direct === 0 && corroboration === 0) return 'D'

  if (input.entityMatch === 'questionable') return 'C'

  if (direct === 0) return 'C'

  if (direct >= 2 || (direct >= 1 && corroboration >= 1)) return 'A'

  return 'B'
}
