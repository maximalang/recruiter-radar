import sourcePolicyContract from '../../../../packages/db/source-policy.json'

export type LeadEligibility =
  | 'digest-lead-originating'
  | 'confidence-gated-evidence'
  | 'enrichment-only'
  | 'context-only'

export type PromotionStatus =
  | 'digest-allowed'
  | 'supporting-evidence-only'
  | 'never-lead-originating'
  | 'blocked-from-digest-pending-confidence-tests'

export interface CanonicalSourcePolicy {
  priority: 'P1' | 'P2' | 'P3'
  defaultConfidence: number
  leadEligibility: LeadEligibility
  promotionStatus: PromotionStatus
}

const POLICY_BY_ID = sourcePolicyContract as Record<string, CanonicalSourcePolicy>

export function getCanonicalSourcePolicy(sourceId: string): CanonicalSourcePolicy | null {
  return POLICY_BY_ID[sourceId] ?? null
}

export function canOriginateActionableLead(sourceId: string): boolean {
  const policy = getCanonicalSourcePolicy(sourceId)
  if (!policy || policy.promotionStatus !== 'digest-allowed') return false

  return policy.leadEligibility === 'digest-lead-originating'
    || policy.leadEligibility === 'confidence-gated-evidence'
}

export function isDefaultGeneratorSource(sourceId: string): boolean {
  return canOriginateActionableLead(sourceId) || sourceId === 'egrul-fns'
}
