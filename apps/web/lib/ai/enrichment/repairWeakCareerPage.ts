/**
 * Weak career-page enrichment repair — the single, safe pipeline insertion point.
 *
 * Where this sits: AFTER deterministic career-page evidence is gathered and its
 * quality scored, BEFORE final FIUR scoring. For leads whose career-page evidence
 * is weak/incomplete, this step asks the enrichment provider to recover hiring
 * signals the deterministic crawler missed. For strong leads it does nothing.
 *
 * What it is NOT allowed to do:
 *   - It never mutates the deterministic score, gate, or evidence. It returns a
 *     SEPARATE `CareerPageEnrichmentResult`; the caller stores it in an auxiliary
 *     field that scoring may OPTIONALLY read as a hint.
 *   - It only RUNS when the source is weak — strong evidence is left untouched so
 *     enrichment cannot dilute or override a clean deterministic lead.
 *
 * How that separation is enforced. TODAY it is structural: this step returns a
 * disjoint result type and writes nothing back into the lead, so there is no
 * mutation to guard against. The runtime guard (../boundary `assertNoOverride`)
 * becomes load-bearing at the *merge site* — the future caller that attaches this
 * result to a lead object. That caller MUST run `assertEnrichmentDoesNotTouchEvidence`
 * (below) so the structural guarantee is also checked at runtime; this file ships
 * the helper so the merge site cannot forget it.
 *
 * This is product-side plumbing only. The provider is a stub today (see
 * ../providers/scrapegraph), so in practice this returns the degraded result —
 * which is exactly the path the real provider will later light up.
 *
 * See docs/specs/2026-06-28-ai-enrichment-career-pages.md.
 */

import {
  computeCareerPageQuality,
  type CareerPageQualityInput,
} from '../../scoring/career-page-quality';
import {
  emptyEnrichmentResult,
  type CareerPageEnrichmentInput,
  type CareerPageEnrichmentResult,
  type SourceEvidenceSnapshot,
} from './careerPages';
import {
  CAREER_PAGE_EXTRACTION_INSTRUCTION,
  type ScrapeProvider,
} from '../providers/scrapegraph';
import type { MarkdownProvider } from '../providers/crawl4ai';
import {
  tryConsumeEnrichmentQuota,
  logEnrichmentApiCall,
} from './enrichmentRateLimit';
import { assertNoOverride, type ProtectedLeadField } from '../boundary';

/**
 * Quality at or below this is "weak enough to try enrichment". Tuned to catch
 * pages that exist but yield little structured evidence (a bare URL scores ~0.1;
 * a URL + a couple vacancies but no contact/freshness lands well under 0.4),
 * while leaving genuinely rich pages alone.
 */
export const WEAK_CAREER_PAGE_QUALITY_THRESHOLD = 0.4;

/** The deterministic inputs needed to decide weakness + build the snapshot. */
export interface WeakCareerPageCandidate {
  orgId: string;
  careerPageUrl: string | null;
  /** Deterministic career-page signals (same shape the quality scorer reads). */
  qualityInput: CareerPageQualityInput;
  /** Distinct vacancy titles the deterministic pipeline already extracted. */
  knownRoleTitles?: ReadonlyArray<string>;
  /** Current deterministic confidence gate, for the read-only snapshot. */
  confidenceGate?: string | null;
  /** Pre-fetched page content, if the crawler already has it (avoids re-scrape). */
  rawHtml?: string;
  markdown?: string;
}

/**
 * Decide whether a career-page lead is weak enough to warrant enrichment.
 * Pure + deterministic: no provider, no network — just the quality gate. Exposed
 * so the pipeline (and tests) can branch on "attempt vs skip" without running the
 * provider, and so the decision stays consistent with FIUR's quality scorer.
 *
 * A lead with NO career-page URL is not an enrichment candidate here: there is no
 * page to read. (Domain backfill is a different gap — see assist-types GapEnrich.)
 */
export function isWeakCareerPage(candidate: WeakCareerPageCandidate): boolean {
  if (!candidate.careerPageUrl) return false;
  const quality = computeCareerPageQuality(candidate.qualityInput);
  return quality.score <= WEAK_CAREER_PAGE_QUALITY_THRESHOLD;
}

/** Build the read-only deterministic snapshot handed to the enrichment layer. */
function buildSnapshot(candidate: WeakCareerPageCandidate): SourceEvidenceSnapshot {
  const quality = computeCareerPageQuality(candidate.qualityInput);
  return {
    qualityScore: quality.score,
    vacancyCount: quality.signals.vacancyCount,
    knownRoleTitles: candidate.knownRoleTitles ?? [],
    hasHrContact: quality.signals.hasHrContact,
    freshnessDays: quality.signals.freshnessDays,
    confidenceGate: candidate.confidenceGate ?? null,
  };
}

/** Options for the repair step. */
export interface RepairWeakCareerPageOptions {
  /**
   * Enforce the per-org daily cost quota before any real provider call. Default
   * true — every live call site MUST respect it. Tests that exercise the provider
   * path directly can disable it to avoid coupling to the in-memory window.
   */
  enforceQuota?: boolean;
  /**
   * Optional Crawl4AI-compatible markdown provider. When the PRIMARY extract
   * returns no usable signal, this is used to PREPARE clean markdown for a future
   * re-extraction retry path (spec §2.2/§2.3). It never re-extracts here and never
   * changes the returned result — it only logs that the fallback prep ran. Omit to
   * skip the fallback entirely.
   */
  fallbackProvider?: MarkdownProvider;
}

/**
 * The repair step. Returns a `CareerPageEnrichmentResult` that the caller stores
 * in a SEPARATE auxiliary field — it never feeds back into deterministic state.
 *
 * Flow:
 *   1. Strong / no-URL lead  → skip (empty result, note explains why).
 *   2. Weak lead, no provider → empty result (graceful degrade — Stage-1 path).
 *   3. Weak lead, over quota  → skip (empty result; ≤1 provider call per org/24h).
 *   4. Weak lead + provider   → ask the provider; on any failure, empty result.
 *   5. Primary extract empty + fallbackProvider → PREPARE clean markdown via
 *      Crawl4AI for a future re-extraction retry; the returned result is still the
 *      (empty) primary result — the fallback only logs that prep ran.
 *
 * The quota (step 3) is a COST guard: the external provider charges per call, so
 * a given org is enriched at most once per 24h. It is consumed only after the
 * weakness + provider checks pass, so skipped leads never burn quota. The fallback
 * (step 5) shares that single quota slot — it does not consume a second one.
 *
 * @param candidate deterministic lead facts (weakness is judged from these).
 * @param provider  enrichment provider; omit to force the degrade path.
 * @param options   see RepairWeakCareerPageOptions.
 */
export async function repairWeakCareerPage(
  candidate: WeakCareerPageCandidate,
  provider?: ScrapeProvider,
  options: RepairWeakCareerPageOptions = {},
): Promise<CareerPageEnrichmentResult> {
  if (!isWeakCareerPage(candidate)) {
    return emptyEnrichmentResult(
      'source evidence is strong or has no career page — enrichment skipped',
    );
  }

  if (!provider) {
    return emptyEnrichmentResult('no enrichment provider available');
  }

  // careerPageUrl is non-null here: isWeakCareerPage returned true.
  const url = candidate.careerPageUrl as string;

  // Cost guard: at most one real provider call per org per 24h. Consumed only
  // now — after weakness + provider checks — so skips never spend quota.
  const enforceQuota = options.enforceQuota ?? true;
  if (enforceQuota) {
    const quota = tryConsumeEnrichmentQuota(candidate.orgId);
    if (!quota.allowed) {
      return emptyEnrichmentResult('enrichment quota reached for this org (1/24h)');
    }
  }

  const enrichmentInput: CareerPageEnrichmentInput = {
    orgId: candidate.orgId,
    url,
    rawHtml: candidate.rawHtml,
    markdown: candidate.markdown,
    evidence: buildSnapshot(candidate),
  };

  try {
    // Prefer caller-supplied content; otherwise have the provider fetch it.
    let content = enrichmentInput.markdown ?? enrichmentInput.rawHtml ?? null;
    if (!content) {
      const scraped = await provider.scrapeToMarkdown(url);
      content = scraped.available && scraped.data ? scraped.data.markdown : null;
    }
    if (!content) {
      logEnrichmentApiCall({
        orgId: candidate.orgId,
        url,
        provider: provider.name,
        success: false,
      });
      return emptyEnrichmentResult('could not obtain page content for enrichment');
    }

    const result = await provider.extractStructuredData({
      sourceUrl: url,
      content,
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });

    // Primary extract found nothing usable → optionally PREPARE markdown via the
    // Crawl4AI fallback so a later retry path can re-extract. We do not re-extract
    // here and the returned result is unchanged; this only readies the input and
    // records that the fallback ran (spec §2.2/§2.3).
    let fallbackUsed = false;
    if (!result.available && options.fallbackProvider) {
      const prepared = await options.fallbackProvider.fetchCleanMarkdown(url);
      fallbackUsed = prepared.available && prepared.data !== null;
    }

    logEnrichmentApiCall({
      orgId: candidate.orgId,
      url,
      provider: provider.name,
      success: result.available,
      fallbackUsed,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    logEnrichmentApiCall({
      orgId: candidate.orgId,
      url,
      provider: provider.name,
      success: false,
    });
    return emptyEnrichmentResult(`enrichment provider error: ${message}`);
  }
}

/**
 * Runtime guard for the FUTURE merge site — the caller that attaches an
 * enrichment result to a lead-shaped object. Delegates to the shared boundary
 * (`assertNoOverride`): throws `AiBoundaryViolation` if the enriched lead changed
 * any deterministic-core field (score, gate, evidence, …) relative to the
 * original deterministic snapshot.
 *
 * `repairWeakCareerPage` itself returns a disjoint result and never touches a
 * lead, so it needs no guard. This helper exists so that when the result IS
 * merged onto a lead, the structural separation is also enforced at runtime —
 * the merge site calls this and cannot silently overwrite evidence.
 *
 * @param original the deterministic lead snapshot (source of truth).
 * @param enrichedLead the same lead with the enrichment result attached.
 */
export function assertEnrichmentDoesNotTouchEvidence<
  T extends Partial<Record<ProtectedLeadField, unknown>>,
>(original: T, enrichedLead: Partial<Record<ProtectedLeadField, unknown>>): void {
  assertNoOverride(original, enrichedLead);
}
