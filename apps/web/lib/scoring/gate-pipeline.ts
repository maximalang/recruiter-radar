/**
 * Digest confidence-gate filtering.
 *
 * The confidence gate is computed at ingest time (SQL source-digest-evidence.sql)
 * and stored on each evidence row. At digest-assembly time we only need a fast,
 * deterministic eligibility filter — gates A/B are auto-delivered, C/D are held
 * back (review / no-lead). This module owns that single rule so every digest
 * surface (digest.ts, hhDigest.ts, payments.ts, lead-discovery) shares it.
 */

/**
 * Confidence-gate filter for digest eligibility.
 *
 * Semantics:
 *   - A, B → eligible (auto-deliver)
 *   - C, D → excluded (review / no-lead)
 *   - undefined / null / empty → eligible (pre-gate items scored downstream)
 *   - Any other unexpected value → eligible with a warning (backward compat)
 *
 * Drop-in replacement for the inline filter:
 *   `.filter(item => item.confidence_gate !== 'C' && item.confidence_gate !== 'D')`
 */
export function isDigestEligibleGate<T extends { confidence_gate?: string | null }>(
  item: T,
): boolean {
  const gate = item.confidence_gate
  if (!gate) return true // no gate yet → eligible, will be scored downstream
  if (gate === 'C' || gate === 'D') return false
  // Unexpected gate values (not A/B/C/D/empty) pass with a warning.
  // This preserves backward compat with the old inline filter that would
  // have passed any non-C/non-D value.
  if (gate !== 'A' && gate !== 'B') {
    console.warn(`isDigestEligibleGate: unexpected confidence_gate "${gate}" — passing (backward compat)`)
  }
  return true
}
