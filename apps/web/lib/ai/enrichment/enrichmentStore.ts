/**
 * Persistence for Stage-2 AI enrichment — the bridge between the in-memory
 * `EnrichedHiringSignals` an enrichment run produces and the `ai_enrichment`
 * JSONB column on `digest_candidates`.
 *
 * Why a dedicated module: enrichment is a SEPARATE, attributed layer. It is
 * written only after a successful enrichment and read back purely as an advisory
 * UI hint. It must never touch the deterministic columns (total_score,
 * confidence_gate, reasons, evidence_titles) — so the write here is a targeted
 * `UPDATE ... SET ai_enrichment = $1` that names only that column, and the read
 * is a single column SELECT. There is no path from this module to the score/gate.
 *
 * Stored shape (schema-versioned so a future change is detectable):
 *   StoredAiEnrichment = EnrichedHiringSignals + { schemaVersion, enrichedAt }
 *
 * All functions degrade to a no-op / null when there is no pool or the payload
 * is unusable — persistence can never break a scoring or a page render.
 */

import { getPool } from '../../db';
import type { EnrichedHiringSignals } from './careerPages';
import { hasEnrichment, type CareerPageEnrichmentResult } from './careerPages';

/** Bump when the stored shape changes in a non-additive way. */
export const AI_ENRICHMENT_SCHEMA_VERSION = 1 as const;

/**
 * The exact JSON persisted in `digest_candidates.ai_enrichment`. It is the
 * attributed signals plus provenance the column comment documents. `enrichedAt`
 * is set at write time; `schemaVersion` lets a reader reject/upgrade old shapes.
 */
export interface StoredAiEnrichment extends EnrichedHiringSignals {
  schemaVersion: number;
  /** ISO-8601 timestamp the enrichment was persisted. */
  enrichedAt: string;
}

/**
 * Build the stored payload from a successful enrichment result. Returns null when
 * the result carries no usable data (degraded / empty) — callers then skip the
 * write entirely, so a NULL column always means "no enrichment".
 */
export function toStoredEnrichment(
  result: CareerPageEnrichmentResult,
  now: Date = new Date(),
): StoredAiEnrichment | null {
  if (!hasEnrichment(result)) return null;
  return {
    ...result.data,
    schemaVersion: AI_ENRICHMENT_SCHEMA_VERSION,
    enrichedAt: now.toISOString(),
  };
}

/**
 * Parse a raw `ai_enrichment` column value back into a `StoredAiEnrichment`.
 * Defensive: returns null for NULL, malformed JSON-as-object, or a shape missing
 * the required provenance. Never throws — a bad row renders the deterministic
 * baseline instead of crashing the page.
 */
export function parseStoredEnrichment(raw: unknown): StoredAiEnrichment | null {
  if (raw === null || raw === undefined) return null;

  // node-postgres returns JSONB as a parsed object; tolerate a string too.
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;

  const o = obj as Record<string, unknown>;
  // Minimal provenance contract: a provider and a source URL must be present.
  if (typeof o.provider !== 'string' || typeof o.sourceUrl !== 'string') return null;

  return {
    detectedRoles: Array.isArray(o.detectedRoles) ? (o.detectedRoles as StoredAiEnrichment['detectedRoles']) : [],
    hiringUrgency: (o.hiringUrgency as StoredAiEnrichment['hiringUrgency']) ?? 'unknown',
    departments: Array.isArray(o.departments) ? (o.departments as string[]) : [],
    locations: Array.isArray(o.locations) ? (o.locations as string[]) : [],
    hiringPatternSummary: typeof o.hiringPatternSummary === 'string' ? o.hiringPatternSummary : '',
    confidence: (o.confidence as StoredAiEnrichment['confidence']) ?? 'low',
    sourceUrl: o.sourceUrl,
    provider: o.provider,
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : 0,
    enrichedAt: typeof o.enrichedAt === 'string' ? o.enrichedAt : '',
  };
}

/**
 * Persist enrichment onto a digest candidate, addressed by (client_profile_id,
 * org_id) — the natural key a scoring pass holds. Writes ONLY the ai_enrichment
 * column; no other column is named, so it cannot disturb the deterministic core.
 * No-op when there is no pool or no usable payload. Returns the number of rows
 * updated (0 when the candidate row does not exist yet).
 */
export async function persistEnrichmentForCandidate(input: {
  clientProfileId: string | number;
  orgId: string | number;
  enrichment: CareerPageEnrichmentResult;
  now?: Date;
}): Promise<number> {
  const stored = toStoredEnrichment(input.enrichment, input.now);
  if (!stored) return 0;

  const pool = getPool();
  if (!pool) return 0;

  const result = await pool.query(
    `UPDATE digest_candidates
        SET ai_enrichment = $1::jsonb
      WHERE client_profile_id = $2
        AND org_id = $3`,
    [JSON.stringify(stored), input.clientProfileId, input.orgId],
  );
  return result.rowCount ?? 0;
}
