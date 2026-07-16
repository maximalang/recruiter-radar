/**
 * Daily-pipeline AI enrichment step — the production wiring that was missing.
 *
 * Until now `repairWeakCareerPage` + `persistEnrichmentForCandidate` only ran
 * inside `LeadScoringService`, which the manual /api/leads/{generate,score}
 * routes call — NOT the daily radar (`runDigestForClientProfile` →
 * `deliverCandidatesForRun`). So `ai_enrichment` was always NULL for real leads
 * and the "AI-подсказка" block never rendered in practice.
 *
 * This module closes that gap WITHOUT touching the deterministic core. It runs
 * AFTER a digest run's candidates are committed and BEFORE delivery, looking at
 * each candidate's org career page. For candidates whose page is weak (quality
 * ≤ threshold), it asks the enrichment provider to recover hiring signals and
 * persists them onto `digest_candidates.ai_enrichment` — the SAME attributed,
 * advisory column the UI/Telegram card already read. It never reads or writes
 * score, gate, evidence, or reasons.
 *
 * Safety contract (every one is load-bearing):
 *   - PROVIDER-GATED: with no FIRECRAWL_API_KEY the provider is null and this
 *     returns immediately — zero DB work, zero network, zero cost.
 *   - QUOTA-BOUNDED: repairWeakCareerPage consumes the per-org 1/24h quota, so a
 *     given org is enriched at most once a day even across many runs.
 *   - BEST-EFFORT: any failure (DB, provider, parse) is swallowed and logged.
 *     Enrichment must never block, slow materially, or fail a digest delivery.
 *   - BOUNDED FAN-OUT: candidates are processed with limited concurrency and a
 *     hard per-run cap so a huge run cannot spawn unbounded provider calls.
 */

import pLimit from 'p-limit';
import { getPool } from '../../db';
import { logError, logEvent } from '../../runtime';
import { ensureLlmOverridesLoaded } from '../../operatorSettings';
import type { ContactPath } from '../../scoring/contact-paths';
import {
  repairWeakCareerPage,
  createFirecrawlProvider,
  isFirecrawlConfigured,
  createCrawl4aiProvider,
  isCrawl4aiConfigured,
  persistEnrichmentForCandidate,
  hasEnrichment,
  type ScrapeProvider,
  type MarkdownProvider,
  type WeakCareerPageCandidate,
} from '../../ai';

/** Bounded concurrency for provider calls within a run. */
const ENRICH_CONCURRENCY = 4;

/**
 * Hard cap on how many candidates a single run will even consider for
 * enrichment. Combined with the per-org daily quota this bounds cost: a run
 * never inspects more than this many career pages regardless of run size.
 */
const MAX_CANDIDATES_PER_RUN = 50;

export interface EnrichRunResult {
  /** True when a provider was configured and the step actually ran. */
  ran: boolean;
  /** Candidates inspected (had a career page and were considered). */
  considered: number;
  /** Candidates that received a persisted enrichment. */
  enriched: number;
}

interface RunCandidateRow {
  candidate_id: string;
  org_id: string;
  client_profile_id: string;
  career_page_url: string | null;
  vacancies_count: number | null;
  latest_published_at: string | null;
  payload: unknown;
}

/**
 * Enrich the weak-career-page candidates of a single digest run.
 *
 * @param runId digest_runs.id whose candidates were just committed.
 * @returns a summary; `ran: false` means enrichment is off (no provider).
 */
export async function enrichRunCandidates(runId: string | number): Promise<EnrichRunResult> {
  const off: EnrichRunResult = { ran: false, considered: 0, enriched: 0 };

  // Provider gate FIRST — no key means no work at all.
  if (!isFirecrawlConfigured()) {
    return off;
  }

  const pool = getPool();
  if (!pool) return off;

  // Prime the operator-DB LLM override cache before the provider is built, so
  // an admin-set provider (api key / base url / model) is live on this run even
  // right after a container restart — not just after the first lazy resolver
  // call. No-op once cached. See lib/operatorSettings.ts.
  await ensureLlmOverridesLoaded();

  let provider: ScrapeProvider;
  let fallbackProvider: MarkdownProvider | undefined;
  try {
    provider = createFirecrawlProvider();
    fallbackProvider = isCrawl4aiConfigured() ? createCrawl4aiProvider() : undefined;
  } catch (error) {
    logError('ai.enrichment.provider_init_failed', error, { runId: String(runId) });
    return off;
  }

  // Only candidates whose org carries a career-page URL are enrichable — there is
  // nothing to read otherwise. Ordered by score so, under the per-run cap, the
  // strongest leads get the enrichment budget first.
  let rows: RunCandidateRow[];
  try {
    const result = await pool.query<RunCandidateRow>(
      `
      SELECT
        dc.id::TEXT            AS candidate_id,
        dc.org_id::TEXT        AS org_id,
        dc.client_profile_id::TEXT AS client_profile_id,
        o.career_page_url,
        dc.vacancies_count,
        dc.latest_published_at::TEXT AS latest_published_at,
        dc.payload
      FROM digest_candidates dc
      JOIN orgs o ON o.id = dc.org_id
      WHERE dc.digest_run_id = $1
        AND o.career_page_url IS NOT NULL
        AND dc.ai_enrichment IS NULL
      ORDER BY dc.total_score DESC
      LIMIT $2
      `,
      [runId, MAX_CANDIDATES_PER_RUN],
    );
    rows = result.rows;
  } catch (error) {
    logError('ai.enrichment.run_query_failed', error, { runId: String(runId) });
    return { ran: true, considered: 0, enriched: 0 };
  }

  if (rows.length === 0) {
    return { ran: true, considered: 0, enriched: 0 };
  }

  const limit = pLimit(ENRICH_CONCURRENCY);
  let enriched = 0;

  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        try {
          const candidate: WeakCareerPageCandidate = {
            orgId: row.org_id,
            careerPageUrl: row.career_page_url,
            qualityInput: {
              url: row.career_page_url ?? undefined,
              vacancyCount: row.vacancies_count ?? 0,
              contactPaths: deriveContactPaths(row.career_page_url),
              lastModifiedAt: row.latest_published_at,
            },
            knownRoleTitles: extractEvidenceTitles(row.payload),
            confidenceGate: extractGate(row.payload),
          };

          const result = await repairWeakCareerPage(candidate, provider, { fallbackProvider });
          if (!hasEnrichment(result)) return;

          const updated = await persistEnrichmentForCandidate({
            clientProfileId: row.client_profile_id,
            orgId: row.org_id,
            enrichment: result,
          });
          if (updated > 0) enriched += 1;
        } catch (error) {
          // Per-candidate isolation: one bad page never aborts the rest.
          logError('ai.enrichment.candidate_failed', error, {
            runId: String(runId),
            candidateId: row.candidate_id,
            orgId: row.org_id,
          });
        }
      }),
    ),
  );

  logEvent('ai.enrichment.run_completed', {
    runId: String(runId),
    considered: rows.length,
    enriched,
  });

  return { ran: true, considered: rows.length, enriched };
}

/**
 * Career-page contact paths for the weakness check.
 *
 * A career-page URL is a SURFACE (already counted by the quality scorer as
 * `hasPage` = +0.1), NOT a contact path. Previously this returned a
 * `careers-email` ContactPath with the URL as its value, which inflated quality
 * by +0.37 (hasHrContact +0.3 + pathScore +0.07) and made EVERY career-page
 * candidate score above the weak threshold (0.4) — so `isWeakCareerPage` was
 * never true and enrichment never ran. That defeats the entire purpose of
 * AI enrichment, which exists to recover signals from WEAK career pages.
 *
 * `careers-email` semantically means a real careers mailbox (see
 * contact-paths.ts `CAREERS_LOCAL_PARTS`); a bare URL is not one. We return no
 * derived contact path here — the deterministic pipeline's own contact
 * extraction (real emails/phones) remains the only source of contact paths.
 */
function deriveContactPaths(_careerPageUrl: string | null): ContactPath[] {
  return [];
}

/** Read evidence titles out of payload (snake/camel tolerant). Read-only. */
function extractEvidenceTitles(payload: unknown): string[] {
  const p = asObject(payload);
  if (!p) return [];
  const raw = p.evidence_titles ?? p.evidenceTitles;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/** Read the deterministic confidence gate out of payload, for the snapshot. */
function extractGate(payload: unknown): string | null {
  const p = asObject(payload);
  if (!p) return null;
  const raw = p.confidence_gate ?? p.confidenceGate;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
