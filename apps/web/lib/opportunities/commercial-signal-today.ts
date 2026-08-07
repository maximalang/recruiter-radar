export type CommercialSignalTodayCandidate = {
  metadata: Record<string, unknown>
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
  if (!card || typeof card !== 'object' || Array.isArray(card)) return false
  const snapshot = card as Record<string, unknown>
  return snapshot.version === 'commercial-signal-card-v1' &&
    snapshot.scoreVersion === 'opportunity-v3' &&
    snapshot.status === 'qualified_actionable'
}

export function filterActionableCommercialSignalToday<T extends CommercialSignalTodayCandidate>(
  opportunities: readonly T[],
): T[] {
  return opportunities.filter(isActionableCommercialSignalTodayCandidate)
}
