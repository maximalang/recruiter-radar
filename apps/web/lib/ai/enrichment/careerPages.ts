/**
 * Career-page enrichment contract — the first concrete AI-enrichment boundary.
 *
 * Purpose (per session 2026-06-28, AI roadmap §quality/quantity): recover hiring
 * signals from WEAK or unstructured career pages — pages that exist but yield
 * little structured evidence (no parseable vacancies, stale, thin contact paths).
 * A model (ScrapeGraphAI first, see ./providers/scrapegraph) reads the page and
 * proposes normalized hiring signals the deterministic pipeline could not extract.
 *
 * TRUST CONTRACT — this is the whole reason the types are split below:
 *   - AI output is a SECONDARY assist layer. It never becomes evidence, never
 *     changes the FIUR score, and never moves a confidence gate. The split is
 *     enforced structurally here (disjoint types; output lives under the result,
 *     never inside the lead's evidence fields) and, at the future merge site, at
 *     runtime via ../boundary `assertNoOverride` (see
 *     repairWeakCareerPage.assertEnrichmentDoesNotTouchEvidence).
 *   - The input carries a READ-ONLY snapshot of the deterministic source evidence
 *     (`SourceEvidenceSnapshot`) purely so the model knows what is already known
 *     and what is missing — it may not write back into it.
 *   - The output (`EnrichedHiringSignals`) is a SEPARATE, ATTRIBUTED shape. Every
 *     enriched field is namespaced under the AI result and tagged with provider +
 *     self-confidence, so downstream scoring can OPTIONALLY read it as a hint and
 *     a human/review path can verify it — but nothing here is auto-promoted.
 *
 * No model and no network live in this file. It is the seam a provider plugs into.
 *
 * See docs/specs/2026-06-28-ai-enrichment-career-pages.md and
 * docs/specs/2026-06-27-delivery-paths-and-ai-roadmap.md §D.
 */

import type { AssistConfidence, AssistResult } from '../assist-types';

// ─── Provider identity ───────────────────────────────────────────────────────

/**
 * Which enrichment provider produced a result. Kept as a named union (plus an
 * open `string & {}` escape hatch) so swapping ScrapeGraphAI for Crawl4AI /
 * PixelRAG later is a one-line provider change, not a type migration.
 */
export type EnrichmentProvider =
  | 'scrapegraph'
  | 'crawl4ai'
  | 'pixelrag'
  | 'none'
  | (string & {});

// ─── Source-evidence snapshot (READ-ONLY input) ──────────────────────────────

/**
 * A read-only photograph of what the DETERMINISTIC pipeline already knows about
 * this org's career page, handed to the enrichment layer so it can target the
 * gaps. The enrichment layer MUST treat every field here as immutable input — it
 * is the deterministic core's surface, not a writable record.
 *
 * Mirrors the signals from lib/scoring/career-page-quality.ts so "weak" can be
 * judged consistently with the rest of FIUR.
 */
export interface SourceEvidenceSnapshot {
  /** 0..1 deterministic career-page quality (computeCareerPageQuality). */
  qualityScore: number;
  /** Vacancies the deterministic crawler actually parsed off the page. */
  vacancyCount: number;
  /** Distinct vacancy titles already extracted, if any. */
  knownRoleTitles: ReadonlyArray<string>;
  /** Whether a usable (non-personal) HR/careers contact path was found. */
  hasHrContact: boolean;
  /** Days since the page was last modified; null if unknown. */
  freshnessDays: number | null;
  /** Confidence gate the lead currently sits at (deterministic). Read-only. */
  confidenceGate: string | null;
}

// ─── Enrichment input ────────────────────────────────────────────────────────

/**
 * Input to a career-page enrichment attempt. `rawHtml` / `markdown` are optional:
 * a caller that already fetched the page can pass it to avoid a re-scrape; if
 * neither is present the provider is expected to fetch `url` itself (later — the
 * Stage-1 stub does not). `evidence` lets the provider see the deterministic gaps.
 */
export interface CareerPageEnrichmentInput {
  orgId: string;
  url: string;
  /** Pre-fetched page HTML, if the caller already has it. */
  rawHtml?: string;
  /** Pre-converted page markdown, if the caller already has it. */
  markdown?: string;
  /** Read-only snapshot of the deterministic source evidence (see above). */
  evidence: SourceEvidenceSnapshot;
}

// ─── Enriched output (AI-PRODUCED, attributed, separate) ─────────────────────

/**
 * A single role the enrichment layer believes the page is hiring for. This is an
 * AI suggestion — it is NOT merged into `evidenceTitles`; it lives only inside
 * the enriched result and is routed to review / optional scoring hints.
 */
export interface EnrichedRole {
  title: string;
  /** Normalized department/team if the model could infer one, else null. */
  department: string | null;
  /** AI self-confidence for THIS role, never fed straight into a gate. */
  confidence: AssistConfidence;
}

/**
 * How urgent the hiring looks, as inferred from page language/structure. Advisory
 * only — the deterministic Urgency component of FIUR is unaffected.
 */
export type EnrichedHiringUrgency = 'low' | 'medium' | 'high' | 'unknown';

/**
 * The normalized hiring signals an enrichment provider recovers from a weak page.
 *
 * Every field here is AI-ENRICHED and must stay segregated from source evidence:
 * downstream scoring may read it as an OPTIONAL hint, the UI must attribute it as
 * AI, and a review path can verify it — but it never overwrites a deterministic
 * field. The split is enforced structurally (these live under the enrichment
 * result, never inside the lead's evidence fields) and at review time.
 */
export interface EnrichedHiringSignals {
  /** Roles inferred from the page (separate from deterministic evidenceTitles). */
  detectedRoles: EnrichedRole[];
  /** Overall hiring urgency the page language suggests. */
  hiringUrgency: EnrichedHiringUrgency;
  /** Departments/teams mentioned as hiring, normalized + deduped. */
  departments: string[];
  /** Locations/geos mentioned for the roles, normalized. */
  locations: string[];
  /** One-line human-readable summary of the hiring pattern on the page. */
  hiringPatternSummary: string;
  /** AI self-confidence in the enrichment as a whole. NOT the FIUR gate. */
  confidence: AssistConfidence;
  /** The page the signals were recovered from — required for provenance. */
  sourceUrl: string;
  /** Which provider produced this enrichment — required for provenance. */
  provider: EnrichmentProvider;
}

/**
 * The result envelope for a career-page enrichment attempt. Reuses the shared
 * `AssistResult` so callers degrade uniformly: `available: false` means "no
 * enrichment — use the deterministic baseline" and `data` is null.
 *
 * `capability` is fixed to 'extract-weak-signal' — recovering signal from weak
 * evidence is exactly the boundary capability this serves.
 */
export type CareerPageEnrichmentResult = AssistResult<EnrichedHiringSignals>;

// ─── Empty / degraded helpers ────────────────────────────────────────────────

/**
 * The canonical "no enrichment available" result. Callers that cannot or should
 * not enrich (no provider, strong source, provider error) return this so the
 * rest of the pipeline reads a single, consistent degraded shape.
 */
export function emptyEnrichmentResult(note?: string): CareerPageEnrichmentResult {
  return {
    available: false,
    capability: 'extract-weak-signal',
    provider: 'none',
    confidence: 'low',
    data: null,
    note,
  };
}

/**
 * Whether an enrichment result carries usable data. A thin guard so callers do
 * not repeat the `available && data !== null` check at every read site.
 */
export function hasEnrichment(
  result: CareerPageEnrichmentResult,
): result is CareerPageEnrichmentResult & { data: EnrichedHiringSignals } {
  return result.available && result.data !== null;
}
