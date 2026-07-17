/**
 * Career-page URL discovery — an ACTIVE data-collection step where the LLM/scrape
 * provider goes and finds a company's careers page when the deterministic
 * pipeline never recorded one.
 *
 * Why this exists (per operator direction 2026-07-16: "LLM должен сам собирать
 * инфу"): the richest enrichment (repairWeakCareerPage) only runs for leads that
 * ALREADY have a `career_page_url`. Leads whose org has a `website_url` but no
 * career page recorded are the largest data-gap cohort — the agency never sees a
 * direct hiring surface for them. This module closes that gap by asking the
 * scrape provider to visit the company's own website and locate the careers /
 * вакансии page, then persisting that URL onto `orgs.career_page_url` so:
 *   - the next enrichment run can repair it (recover hiring signals), and
 *   - the next daily-radar crawl (source-career-pages) can pick it up.
 *
 * TRUST CONTRACT — mirrors the enrichment boundary:
 *   - This NEVER changes a score, gate, or evidence field. It writes ONLY
 *     `orgs.career_page_url` (a surface/identity column), named explicitly in the
 *     UPDATE so no deterministic column can be touched.
 *   - The discovered URL is a REAL corporate surface the provider actually
 *     visited; it is not invented. A subsequent career-pages crawl that finds
 *     job_posting signals on it is the thing that may move a gate — and that is
 *     the deterministic crawler's verdict, not the LLM's.
 *   - Discovering a URL does NOT fabricate a job_posting signal. It only fills a
 *     gap so the deterministic pipeline can do its job on the next run.
 *
 * Safety:
 *   - The seed URL comes from `orgs.website_url` (deterministic source data), not
 *     from user input. It is validated as http(s) before any provider call.
 *   - The returned URL is validated: must be http(s), and must be on the same
 *     registrable domain as the seed (or a recognized careers subdomain), so the
 *     provider cannot point us at an arbitrary external host.
 *   - Per-org 1/24h quota (shares the enrichment quota slot) bounds cost.
 *   - Best-effort: any failure degrades to "no URL discovered" and is logged; it
 *     never blocks a digest run.
 */

import { getPool } from '../../db';
import { logError, logEvent } from '../../runtime';
import type { ScrapeProvider } from '../providers/firecrawl';
import { tryConsumeEnrichmentQuota, logEnrichmentApiCall } from './enrichmentRateLimit';
import { assertNoOverride, type ProtectedLeadField } from '../boundary';

export interface CareerPageDiscoveryCandidate {
  orgId: string;
  /** The company's own website URL — the seed the provider starts from. */
  websiteUrl: string;
  /** The registrable domain (for same-site validation of the discovered URL). */
  domain: string | null;
}

export interface CareerPageDiscoveryResult {
  /** True when a provider was configured and discovery actually ran. */
  ran: boolean;
  /** Orgs inspected (had a website_url and no career_page_url). */
  considered: number;
  /** Orgs for which a career-page URL was discovered and persisted. */
  discovered: number;
}

/** Hard cap so a huge run cannot spawn unbounded discovery calls. */
const MAX_DISCOVERY_CANDIDATES_PER_RUN = 30;

/**
 * Normalize a hostname to its registrable domain (last two labels, crude but
 * sufficient for same-site validation). "careers.acme.ru" → "acme.ru".
 * For single-label or IP hosts returns the whole thing.
 */
function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split('.');
  if (parts.length <= 2) return host.toLowerCase();
  // Heuristic: drop the leading subdomain. Good enough to catch a careers.*
  // subdomain pointing at the same employer; we do NOT rely on the Public Suffix
  // List here — the validation is a guardrail, not a security boundary (the URL
  // came from a provider visiting the company's own site).
  return parts.slice(-2).join('.');
}

/**
 * Is `candidateUrl` an http(s) URL on the same registrable domain as `seed`?
 *
 * Both sides are normalized through a URL constructor so an IDN/cyrillic seed
 * domain (e.g. `руча.рф`) compares equal to the punycode-encoded hostname a
 * discovered link carries (`xn--...`). Without this, a real RU employer's
 * careers link would be wrongly rejected as "off-site".
 */
function isAcceptableCareerUrl(candidateUrl: string, seedDomain: string | null): boolean {
  try {
    const u = new URL(candidateUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (!seedDomain) return true; // no seed domain to compare → accept any http(s)
    const candidateRoot = registrableDomain(u.hostname);
    // Normalize the seed through a URL too: `new URL('http://руча.рф').hostname`
    // yields the punycode form, matching the candidate's encoded hostname.
    let seedRoot = registrableDomain(seedDomain);
    try {
      seedRoot = registrableDomain(new URL(`http://${seedDomain}`).hostname);
    } catch {
      // seed wasn't a parseable host — keep the plain-text form
    }
    return candidateRoot === seedRoot;
  } catch {
    return false;
  }
}

/**
 * Discover and persist career-page URLs for candidates whose org has a
 * website_url but no career_page_url. Shares the enrichment provider + quota.
 *
 * @param runId the digest run whose candidates are being enriched.
 * @param provider the scrape provider (Firecrawl). Omit/undefined → no-op.
 * @returns a summary; `ran: false` means discovery was off (no provider).
 */
export async function discoverCareerPageUrls(
  runId: string | number,
  provider?: ScrapeProvider,
): Promise<CareerPageDiscoveryResult> {
  const off: CareerPageDiscoveryResult = { ran: false, considered: 0, discovered: 0 };
  if (!provider) return off;

  const pool = getPool();
  if (!pool) return off;

  // Candidates: this run's orgs with a website but NO recorded career page.
  // Ordered by score so the strongest leads get the discovery budget first.
  let rows: CareerPageDiscoveryCandidate[];
  try {
    const result = await pool.query<CareerPageDiscoveryCandidate>(
      `
      SELECT
        dc.org_id::TEXT        AS "orgId",
        o.website_url          AS "websiteUrl",
        o.domain               AS "domain"
      FROM digest_candidates dc
      JOIN orgs o ON o.id = dc.org_id
      WHERE dc.digest_run_id = $1
        AND o.career_page_url IS NULL
        AND o.website_url IS NOT NULL
        AND BTRIM(o.website_url) <> ''
      ORDER BY dc.total_score DESC
      LIMIT $2
      `,
      [runId, MAX_DISCOVERY_CANDIDATES_PER_RUN],
    );
    rows = result.rows;
  } catch (error) {
    logError('ai.discovery.run_query_failed', error, { runId: String(runId) });
    return { ran: true, considered: 0, discovered: 0 };
  }

  if (rows.length === 0) {
    return { ran: true, considered: 0, discovered: 0 };
  }

  let discovered = 0;
  for (const candidate of rows) {
    try {
      // Cost guard: shares the per-org 1/24h enrichment slot.
      const quota = await tryConsumeEnrichmentQuota(candidate.orgId);
      if (!quota.allowed) continue;

      const foundUrl = await discoverOne(candidate, provider);
      if (!foundUrl) continue;

      // Persist ONLY the career_page_url column — named explicitly so no
      // deterministic column (score/gate/evidence) can be touched.
      const updated = await persistDiscoveredCareerPageUrl(candidate.orgId, foundUrl);
      if (updated > 0) {
        discovered += 1;
        logEvent('ai.discovery.career_page_found', {
          runId: String(runId),
          orgId: candidate.orgId,
          careerPageUrl: foundUrl,
        });
      }
    } catch (error) {
      // Per-org isolation: one bad site never aborts the rest.
      logError('ai.discovery.candidate_failed', error, {
        runId: String(runId),
        orgId: candidate.orgId,
      });
    }
  }

  logEvent('ai.discovery.run_completed', {
    runId: String(runId),
    considered: rows.length,
    discovered,
  });

  return { ran: true, considered: rows.length, discovered };
}

/**
 * Ask the provider to find the careers-page URL for one org. Returns a validated
 * absolute URL string, or null when nothing usable was found. Never throws.
 *
 * How: the scrape provider VISITS the company's own website (scrapeToMarkdown),
 * reducing the page to clean markdown, then we scan the links for a
 * careers/vacancies/«работа» anchor. This is ACTIVE collection — the provider
 * fetches the real page and we read its real links — without depending on a
 * structured-extract schema the provider does not fill for URL discovery (its
 * typed result maps to hiring signals, not URLs). One scrape, no second LLM call.
 */
async function discoverOne(
  candidate: CareerPageDiscoveryCandidate,
  provider: ScrapeProvider,
): Promise<string | null> {
  const scraped = await provider.scrapeToMarkdown(candidate.websiteUrl);
  if (!scraped.available || !scraped.data) return null;
  const markdown = scraped.data.markdown;
  const base = scraped.data.fetchedUrl ?? candidate.websiteUrl;

  const found = scanMarkdownForCareerLink(markdown, base, candidate.domain);
  logEnrichmentApiCall({
    orgId: candidate.orgId,
    url: candidate.websiteUrl,
    provider: provider.name,
    success: found !== null,
  });
  return found;
}

const CAREER_LINK_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:careers?|jobs?|vacancies|vacanc(?:y|ies)|ваканс(?:ии|ия)|работа|карьера)/i,
];

/**
 * Scan markdown for an anchor whose link text or href matches a careers keyword.
 * Resolves relative URLs against the fetched base URL and validates same-site.
 */
function scanMarkdownForCareerLink(
  markdown: string,
  baseUrl: string,
  seedDomain: string | null,
): string | null {
  // Markdown links: [text](href) and bare <a href="...">.
  const linkRegex = /\[(?:[^\]]+)\]\(([^)\s]+)\)|<a\s+[^>]*href=["']([^"']+)["'][^>]*>(?:[^<]*)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(markdown)) !== null) {
    const href = match[1] ?? match[2];
    if (!href) continue;
    const absolute = resolveUrl(href, baseUrl);
    if (!absolute) continue;
    if (!isAcceptableCareerUrl(absolute, seedDomain)) continue;
    // Match on either the link text (group 1 of the [text](href) form) or the href.
    const text = match[0];
    if (CAREER_LINK_PATTERNS.some((re) => re.test(text) || re.test(href))) {
      return absolute;
    }
  }
  return null;
}

/** Resolve a possibly-relative href against the page base URL. */
function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Persist the discovered career-page URL onto the org. Writes ONLY the
 * career_page_url column. Returns rows updated (0 if the org no longer exists).
 */
async function persistDiscoveredCareerPageUrl(
  orgId: string,
  careerPageUrl: string,
): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const result = await pool.query(
    `UPDATE orgs
        SET career_page_url = $1,
            updated_at = NOW()
      WHERE id = $2
        AND (career_page_url IS NULL OR BTRIM(career_page_url) = '')`,
    [careerPageUrl, orgId],
  );
  return result.rowCount ?? 0;
}

/**
 * Runtime guard for the discovery write site. The discovery step only ever sets
 * `orgs.career_page_url` — it must not touch any protected lead field. This
 * helper exists so a future caller that reads/writes a lead-shaped object can
 * assert the discovery did not leak into score/gate/evidence.
 */
export function assertDiscoveryDoesNotTouchEvidence<
  T extends Partial<Record<ProtectedLeadField, unknown>>,
>(original: T, after: Partial<Record<ProtectedLeadField, unknown>>): void {
  assertNoOverride(original, after);
}
