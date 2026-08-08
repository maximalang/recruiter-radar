import { parseCommercialSignalCard } from './commercial-signal-card'

export type CommercialSignalTodayCandidate = {
  metadata: Record<string, unknown>
  evidenceTimeline: readonly { id: string }[]
}

/**
 * Authoritative Today is intentionally stricter than persistence.
 * `qualified_needs_enrichment` is a valid high-quality opportunity, but it is
 * not actionable yet. Legacy/raw opportunities have no exact v3 card and fail
 * closed here instead of leaking into the action queue.
 */
export function isActionableCommercialSignalTodayCandidate(
  opportunity: CommercialSignalTodayCandidate,
): boolean {
  const card = opportunity.metadata.commercialSignalCard
  const allowedEvidenceIds = new Set(
    opportunity.evidenceTimeline.map((evidence) => evidence.id),
  )
  const snapshot = parseCommercialSignalCard(card, allowedEvidenceIds)
  return snapshot?.status === 'qualified_actionable'
}

export function filterActionableCommercialSignalToday<T extends CommercialSignalTodayCandidate>(
  opportunities: readonly T[],
): T[] {
  return opportunities.filter(isActionableCommercialSignalTodayCandidate)
}
