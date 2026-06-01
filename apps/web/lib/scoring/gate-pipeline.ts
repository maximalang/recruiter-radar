/**
 * GREEN Phase — document the resolution strategy for TS/SQL gate divergence.
 *
 * After analysis (RED tests), the gap is clear:
 * - TS selectConfidenceGate: direct tier count + corroboration tier count + entityMatch
 * - SQL source-digest-evidence.sql: evidence_quality (source-based) + source_families count
 *
 * Resolution approach:
 * 1. Keep SQL gate as the fast ingest-time gate (no TS call needed at ingest)
 * 2. Add a TypeScript gate audit step AFTER SQL results for review-required cases
 *    (gate C items that need entity match validation)
 * 3. Keep the pipeline filter (C/D exclusion) as-is — SQL gates are correct for this
 *    because the filter happens at digest assembly time, not ingest time
 * 4. Document the divergence clearly so future developers understand both systems
 *
 * This approach:
 * - Avoids calling TS selectConfidenceGate during every digest run (performance)
 * - Keeps SQL gates as the source of truth for pipeline filtering
 * - Adds a TS gate override path for the specific entityMatch divergence case
 * - Is backward compatible — no existing DB rows need to change
 */

import { selectConfidenceGate, type ConfidenceGate } from '@/lib/scoring/gates';
import type { FiurEvidenceItem } from '@/lib/scoring/fiur';

/**
 * Evidence row shape as it comes from source-digest-evidence.sql.
 * Mirrors the actual returned columns from the SQL query.
 */
interface DigestEvidenceRow {
  org_id: string | number;
  rank: number;
  confidence_gate: string;
  evidence_quality: 'direct_hiring_proof' | 'platform_aggregation' | 'enrichment_context' | null;
  source_families: string[];
  source_external_id: string | null;
  source_display_name: string | null;
  evidence_titles: string[];
  latest_published_at: string | null;
  matched_by?: string | null;
}

export interface GateResolution {
  sql_gate: ConfidenceGate;
  ts_gate?: ConfidenceGate;
  resolved_gate: ConfidenceGate;
  divergence_detected: boolean;
  divergence_reason?: string;
}

/**
 * Audit a single SQL gate result using TS selectConfidenceGate.
 *
 * Called only for items that need post-SQL validation:
 * - Gate C items (review required)
 * - Items with questionable entity match indicators
 *
 * Returns the resolved gate and whether divergence was found.
 *
 * NOTE: This function needs evidence data to call selectConfidenceGate.
 * The SQL result does not include per-signal evidence tier data — only
 * aggregated evidence_quality. For full TS gate audit, the pipeline
 * needs to re-fetch signal evidence for items under review.
 *
 * This function documents the gap and provides a safe fallback:
 * - If evidence cannot be re-fetched, use SQL gate (trusted, deterministic)
 * - If evidence can be re-fetched, call selectConfidenceGate with proper input
 */
export function auditDigestGate(
  sqlGate: ConfidenceGate,
  evidenceQuality: string | null,
  sourceFamilies: string[],
  entityMatchQuality?: 'clean' | 'questionable'
): GateResolution {
  const sqlGateStr: ConfidenceGate =
    sqlGate === 'A' || sqlGate === 'B' || sqlGate === 'C' || sqlGate === 'D'
      ? sqlGate
      : 'D';

  // Map SQL evidence_quality to approximate TS evidence tier
  // This is lossy — SQL loses the distinction between corroboration and context
  const approxEvidence: FiurEvidenceItem[] = [];

  if (evidenceQuality === 'direct_hiring_proof') {
    // Best case: at least one direct signal
    approxEvidence.push({ tier: 'direct', source: sourceFamilies[0] ?? 'unknown' });
    // If multiple source families, might have corroboration too
    if (sourceFamilies.length >= 2) {
      approxEvidence.push({ tier: 'corroboration', source: sourceFamilies[1] ?? 'unknown' });
    }
  } else if (evidenceQuality === 'platform_aggregation') {
    // Platform-level — no direct surface, but matched to org
    approxEvidence.push({ tier: 'corroboration', source: sourceFamilies[0] ?? 'unknown' });
  } else {
    // enrichment_context or null — context only
    approxEvidence.push({ tier: 'context', source: 'unknown' });
  }

  const tsGate = selectConfidenceGate({
    evidence: approxEvidence,
    entityMatch: entityMatchQuality ?? 'clean',
  });

  const divergenceDetected =
    tsGate !== sqlGateStr &&
    // Only flag as divergence if entityMatch was explicitly questionable
    // (SQL doesn't have entity match quality, so this is the key gap)
    entityMatchQuality === 'questionable';

  return {
    sql_gate: sqlGateStr,
    ts_gate: tsGate,
    resolved_gate: divergenceDetected ? tsGate : sqlGateStr,
    divergence_detected: divergenceDetected,
    divergence_reason: divergenceDetected
      ? `TS gate ${tsGate} overrides SQL gate ${sqlGateStr} due to questionable entity match`
      : undefined,
  };
}

/**
 * Fast gate filter — equivalent to digest.ts line 242.
 * Kept as-is: SQL gates are correct for pipeline filtering.
 * TS selectConfidenceGate is NOT called here because:
 *   1. SQL gates are deterministic and fast
 *   2. The C/D exclusion is a hard rule that doesn't need re-evaluation
 *   3. Entity match quality is checked at ingest time via matched_by
 */
/**
 * Generic confidence-gate filter for digest eligibility.
 *
 * Preserves the original "not-C-and-not-D" semantics:
 *   - A, B → eligible (auto-deliver)
 *   - C, D → excluded (review / no-lead)
 *   - undefined / null / empty → eligible (pre-gate items scored downstream)
 *   - Any other unexpected value → eligible with a warning (backward compat)
 *
 * Use this as a drop-in replacement for the inline filter:
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

/**
 * @deprecated Use isDigestEligibleGate instead — this function only accepts DigestEvidenceRow
 * and excludes items with no confidence_gate, which is incorrect for pre-gate items.
 * Kept for backward compat with existing tests.
 */
export function filterGatesForDigest(items: DigestEvidenceRow[]): DigestEvidenceRow[] {
  return items.filter(isDigestEligibleGate)
}

/**
 * Check if a digest item needs TS gate review.
 * Called after SQL gate computation for items where TS might differ.
 */
export function needsGateReview(
  sqlGate: string,
  matchedBy: string | null | undefined,
  evidenceQuality: string | null
): boolean {
  // Gate C always needs review (by definition)
  if (sqlGate === 'C') return true;

  // Gate B with no matched_by → questionable entity resolution
  if (sqlGate === 'B' && !matchedBy) return true;

  // Platform aggregation without strong entity match
  if (sqlGate === 'B' && evidenceQuality === 'platform_aggregation' && !matchedBy) return true;

  return false;
}