/**
 * ScrapeGraphAI provider boundary — the swappable seam for page→structure AI.
 *
 * Why ScrapeGraphAI first (per session 2026-06-28): the first enrichment use case
 * is recovering hiring signals from WEAK career pages — pages that exist but whose
 * structure defeats the deterministic crawler (JS-rendered lists, prose-only
 * postings, non-standard markup). ScrapeGraphAI is graph-of-prompts scraping that
 * turns a messy page into structured data with one schema-shaped ask, which is
 * exactly the gap-filling this boundary needs — and it is far lighter to integrate
 * than standing up our own headless-render + extraction stack.
 *
 * This file defines the CONTRACT only. No SDK, no API key, no network call is
 * wired in this stage: the methods are stubs that return a typed "unavailable"
 * result. The point is the interface — `ScrapeProvider` — so the real wiring is a
 * drop-in later, and so a different engine (Crawl4AI, PixelRAG) can implement the
 * same interface without touching any caller.
 *
 * See lib/ai/enrichment/careerPages.ts for the data contract this provider feeds,
 * and docs/specs/2026-06-28-ai-enrichment-career-pages.md.
 */

import type { AssistResult } from '../assist-types';
import type {
  EnrichedHiringSignals,
  EnrichmentProvider,
} from '../enrichment/careerPages';

// ─── Provider interface (swappable) ──────────────────────────────────────────

/** Markdown conversion of a page — the normalized intermediate for extraction. */
export interface ScrapeMarkdownResult {
  markdown: string;
  /** The URL actually fetched (may differ from input after redirects). */
  fetchedUrl: string;
}

/**
 * A page→structure scraping provider. Two stages, mirroring how ScrapeGraphAI and
 * its alternatives work: first reduce a page to clean markdown, then extract a
 * schema-shaped object from that markdown. Keeping them separate means a caller
 * can supply its own markdown (skipping the fetch) and means the extraction step
 * is engine-agnostic.
 *
 * Crawl4AI / PixelRAG implement this SAME interface to stay swappable.
 */
export interface ScrapeProvider {
  readonly name: EnrichmentProvider;

  /**
   * Fetch `url` and reduce it to clean markdown. Real impl: provider's scrape
   * endpoint. Stub: returns `available: false`.
   */
  scrapeToMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>>;

  /**
   * Extract normalized hiring signals from page content (markdown preferred, raw
   * HTML acceptable). The `instruction` is the natural-language extraction ask the
   * graph-scraper is built around. Real impl: provider's structured-extract
   * endpoint with our schema. Stub: returns `available: false`.
   */
  extractStructuredData(input: {
    sourceUrl: string;
    content: string;
    instruction: string;
  }): Promise<AssistResult<EnrichedHiringSignals>>;
}

// ─── Stub implementation (Stage 1) ───────────────────────────────────────────

const PROVIDER_NAME: EnrichmentProvider = 'scrapegraph';

/**
 * The extraction ask handed to the graph-scraper. Centralized here so prompt
 * versioning lives in product code (never in n8n) and so tests can assert it is
 * passed through.
 */
export const CAREER_PAGE_EXTRACTION_INSTRUCTION =
  'Extract hiring signals from this company career page: list open roles with ' +
  'their department and location, infer overall hiring urgency (low/medium/high), ' +
  'and summarize the hiring pattern in one sentence. Only report what the page ' +
  'states — do not invent roles, companies, or contacts.';

/**
 * Build the Stage-1 ScrapeGraphAI provider. Today every method returns a typed
 * "unavailable" result so callers exercise the real degrade path. Wiring a real
 * client is a matter of replacing the two method bodies — the interface and all
 * call sites stay put.
 *
 * @param opts.apiKey reserved for the real client; unused by the stub. Passing it
 *   now lets callers thread config without a later signature change.
 */
export function createScrapeGraphProvider(
  opts: { apiKey?: string | null } = {},
): ScrapeProvider {
  const configured = typeof opts.apiKey === 'string' && opts.apiKey.length > 0;

  return {
    name: PROVIDER_NAME,

    async scrapeToMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      // Stage-1 stub: no network. A real impl would POST `url` to ScrapeGraphAI's
      // markdownify endpoint and return its markdown.
      void url;
      return {
        available: false,
        capability: 'extract-weak-signal',
        provider: PROVIDER_NAME,
        confidence: 'low',
        data: null,
        note: configured
          ? 'scrapegraph: real client not wired in this stage'
          : 'scrapegraph: no API key configured',
      };
    },

    async extractStructuredData(input: {
      sourceUrl: string;
      content: string;
      instruction: string;
    }): Promise<AssistResult<EnrichedHiringSignals>> {
      // Stage-1 stub: no network. A real impl would send `content` + `instruction`
      // to ScrapeGraphAI's smartscraper endpoint with our EnrichedHiringSignals
      // schema and map the response, then attribute it with provider + confidence.
      void input;
      return {
        available: false,
        capability: 'extract-weak-signal',
        provider: PROVIDER_NAME,
        confidence: 'low',
        data: null,
        note: configured
          ? 'scrapegraph: real client not wired in this stage'
          : 'scrapegraph: no API key configured',
      };
    },
  };
}

/**
 * Whether a usable ScrapeGraphAI configuration is present. Stage-1 always false
 * (no client wired); kept as the single place a caller checks before attempting
 * enrichment, so flipping it on later is one change.
 */
export function isScrapeGraphConfigured(): boolean {
  return false;
}
