/**
 * Firecrawl provider boundary — the swappable seam for page→structure AI.
 *
 * Why Firecrawl (per session 2026-07-02): the first enrichment use case is
 * recovering hiring signals from WEAK career pages — pages that exist but whose
 * structure defeats the deterministic crawler (JS-rendered lists, prose-only
 * postings, non-standard markup). Firecrawl is a self-hostable scraper with a
 * schema-shaped /v1/extract endpoint that turns a messy page into structured
 * data with one ask, which is exactly the gap-filling this boundary needs. It
 * replaced ScrapeGraphAI, whose API key was rejected (403 Invalid API key).
 *
 * This file owns the CONTRACT (`ScrapeProvider`) plus a REAL Firecrawl client:
 *   - `extract`  → POST /v2/scrape  formats:['json'] + jsonOptions.schema
 *   - `scrape`   → POST /v2/scrape  formats:['markdown']  (fallback for RU pages)
 * The real client NEVER throws to the caller: any failure (no key, timeout, HTTP
 * error, malformed body) degrades to a typed `available: false` result and is
 * logged. The stub is kept so Stage-1 callers and tests still exercise the
 * degrade path without a key, and so Crawl4AI / PixelRAG can implement the same
 * interface unchanged.
 *
 * Migration (2026-07-03): Firecrawl /v1/extract is DEPRECATED. Structured
 * extraction now rides on the SYNCHRONOUS /v2/scrape endpoint with the `json`
 * format — one POST returns `{ data: { json, markdown } }`, no job id / polling.
 * That both removes the async wall-clock (was ≈117s worst case) and lets a single
 * scrape return markdown AND structured json together. Markdown scraping uses the
 * same /v2/scrape with formats:['markdown'] (already works for RU SPA pages).
 * Each HTTP call has a hard REQUEST_TIMEOUT_MS (15s).
 *
 * See lib/ai/enrichment/careerPages.ts for the data contract this provider feeds,
 * and docs/specs/2026-06-28-ai-enrichment-career-pages.md.
 */

import type { AssistResult, AssistConfidence } from '../assist-types';
import type {
  EnrichedHiringSignals,
  EnrichedRole,
  EnrichedHiringUrgency,
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
 * A page→structure scraping provider. Two stages: first reduce a page to clean
 * markdown, then extract a schema-shaped object from that markdown. Keeping them
 * separate means a caller can supply its own markdown (skipping the fetch) and
 * means the extraction step is engine-agnostic.
 *
 * Crawl4AI / PixelRAG implement this SAME interface to stay swappable.
 */
export interface ScrapeProvider {
  readonly name: EnrichmentProvider;

  /**
   * Fetch `url` and reduce it to clean markdown. Real impl: provider's scrape
   * endpoint. Degrades to `available: false` on any failure.
   */
  scrapeToMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>>;

  /**
   * Extract normalized hiring signals from page content (markdown preferred, raw
   * HTML acceptable). The `instruction` is the natural-language extraction ask.
   * Real impl: provider's structured-extract endpoint with our schema. Degrades
   * to `available: false` on any failure.
   */
  extractStructuredData(input: {
    sourceUrl: string;
    content: string;
    instruction: string;
  }): Promise<AssistResult<EnrichedHiringSignals>>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PROVIDER_NAME: EnrichmentProvider = 'firecrawl';

/** Firecrawl API base. Overridable for tests / self-hosting via env. */
const DEFAULT_API_BASE = 'http://localhost:3002';

/** Hard per-request timeout. Enrichment is best-effort and must never hang the run. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The extraction ask handed to the scraper. Centralized here so prompt versioning
 * lives in product code (never in n8n) and so tests can assert it is passed
 * through.
 */
export const CAREER_PAGE_EXTRACTION_INSTRUCTION =
  'Extract hiring signals from this company career page: list open roles with ' +
  'their department and location, infer overall hiring urgency (low/medium/high), ' +
  'and summarize the hiring pattern in one sentence. Only report what the page ' +
  'states — do not invent roles, companies, or contacts.';

/**
 * The JSON schema we ask Firecrawl's /v1/extract to fill. Mirrors
 * `EnrichedHiringSignals` (minus provenance, which we attach ourselves) so the
 * mapping is mechanical and the model can only return shapes we expect.
 */
const EXTRACTION_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    detectedRoles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          department: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['title'],
      },
    },
    hiringUrgency: { type: 'string', enum: ['low', 'medium', 'high', 'unknown'] },
    departments: { type: 'array', items: { type: 'string' } },
    locations: { type: 'array', items: { type: 'string' } },
    hiringPatternSummary: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['detectedRoles', 'hiringUrgency', 'hiringPatternSummary'],
} as const;

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Resolve the Firecrawl API key. Read from process.env only — never hardcoded.
 * `.env.example` documents the variable name.
 */
function resolveApiKey(explicit?: string | null): string | null {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const fromEnv = process.env.FIRECRAWL_API_KEY;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null;
}

function resolveApiBase(): string {
  const fromEnv = process.env.FIRECRAWL_API_URL;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : DEFAULT_API_BASE;
}

/**
 * Whether a usable Firecrawl configuration is present (an API key). The single
 * place a caller checks before attempting enrichment — flip the env var and the
 * real client lights up with no code change.
 */
export function isFirecrawlConfigured(): boolean {
  return resolveApiKey() !== null;
}

// ─── Degrade helpers ─────────────────────────────────────────────────────────

function degradedMarkdown(note: string): AssistResult<ScrapeMarkdownResult> {
  return {
    available: false,
    capability: 'extract-weak-signal',
    provider: PROVIDER_NAME,
    confidence: 'low',
    data: null,
    note,
  };
}

function degradedExtract(note: string): AssistResult<EnrichedHiringSignals> {
  return {
    available: false,
    capability: 'extract-weak-signal',
    provider: PROVIDER_NAME,
    confidence: 'low',
    data: null,
    note,
  };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

/**
 * Make an HTTP request to a Firecrawl endpoint with a hard timeout. Returns the
 * parsed body, or throws — the caller wraps every call in try/catch and
 * degrades, so a throw here never reaches the enrichment caller.
 */
async function requestJson(
  base: string,
  method: string,
  path: string,
  apiKey: string,
  body: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`firecrawl ${path} returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Response mapping (provider shape → our contract) ────────────────────────

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asConfidence(v: unknown, fallback: AssistConfidence = 'low'): AssistConfidence {
  return v === 'low' || v === 'medium' || v === 'high' ? v : fallback;
}

function asUrgency(v: unknown): EnrichedHiringUrgency {
  return v === 'low' || v === 'medium' || v === 'high' ? v : 'unknown';
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const item of v) {
    const s = asString(item);
    if (s) seen.add(s);
  }
  return [...seen];
}

function mapRoles(v: unknown): EnrichedRole[] {
  if (!Array.isArray(v)) return [];
  const roles: EnrichedRole[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    const title = asString(obj.title);
    if (!title) continue; // a role with no title is not a usable signal
    roles.push({
      title,
      department: asString(obj.department),
      confidence: asConfidence(obj.confidence),
    });
  }
  return roles;
}

/**
 * Firecrawl wraps its result under a `data` (or `result`) key. Unwrap
 * defensively — providers differ and we never trust shape.
 */
function unwrapResult(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null;
  const obj = body as Record<string, unknown>;
  const result = obj.data ?? obj.result ?? obj;
  return typeof result === 'object' && result !== null
    ? (result as Record<string, unknown>)
    : null;
}

/**
 * Unwrap the STRUCTURED object from a /v2/scrape response. v2 returns
 * `{ success, data: { json: {...}, markdown } }` — the schema result lives at
 * `data.json`. Falls back to `data` itself (self-hosted builds may inline the
 * fields) then the whole body, so an older shape still maps.
 */
function unwrapJsonResult(body: unknown): Record<string, unknown> | null {
  const data = unwrapResult(body);
  if (!data) return null;
  const json = data.json;
  if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
    return json as Record<string, unknown>;
  }
  return data;
}

/**
 * Map a Firecrawl extract body into `EnrichedHiringSignals`, attaching our own
 * provenance (sourceUrl + provider). Returns null when the body carries no
 * usable signal (no roles AND no summary) — the caller then degrades.
 */
function mapExtractResponse(
  body: unknown,
  sourceUrl: string,
): EnrichedHiringSignals | null {
  const result = unwrapJsonResult(body);
  if (!result) return null;

  const detectedRoles = mapRoles(result.detectedRoles);
  const hiringPatternSummary = asString(result.hiringPatternSummary) ?? '';
  const departments = asStringList(result.departments);
  // Firecrawl may surface a single departmentOrTeam string; fold it into
  // departments for a uniform downstream shape.
  const deptTeam = asString(result.departmentOrTeam);
  if (deptTeam && !departments.includes(deptTeam)) departments.push(deptTeam);
  const locations = asStringList(result.locations);
  const geo = asString(result.geoOrLocation);
  if (geo && !locations.includes(geo)) locations.push(geo);

  // No roles and no summary → the model found nothing structured. Treat as empty.
  if (detectedRoles.length === 0 && hiringPatternSummary.length === 0) {
    return null;
  }

  return {
    detectedRoles,
    hiringUrgency: asUrgency(result.hiringUrgency),
    departments,
    locations,
    hiringPatternSummary,
    confidence: asConfidence(result.confidence, 'medium'),
    sourceUrl,
    provider: PROVIDER_NAME,
  };
}

function mapScrapeResponse(
  body: unknown,
  requestedUrl: string,
): ScrapeMarkdownResult | null {
  const result = unwrapResult(body);
  if (!result) return null;
  const markdown =
    asString(result.markdown) ?? asString(result.content) ?? asString(result.result);
  if (!markdown) return null;
  return { markdown, fetchedUrl: asString(result.url) ?? requestedUrl };
}

// ─── Real client ─────────────────────────────────────────────────────────────

function createRealFirecrawlProvider(apiKey: string): ScrapeProvider {
  const base = resolveApiBase();

  return {
    name: PROVIDER_NAME,

    async scrapeToMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      try {
        const body = await requestJson(base, 'POST', '/v2/scrape', apiKey, {
          url,
          formats: ['markdown'],
        });
        const mapped = mapScrapeResponse(body, url);
        if (!mapped) return degradedMarkdown('firecrawl: scrape returned no markdown');
        return {
          available: true,
          capability: 'extract-weak-signal',
          provider: PROVIDER_NAME,
          confidence: 'medium',
          data: mapped,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown_error';
        console.error(
          JSON.stringify({ level: 'error', event: 'ai.firecrawl.scrape_failed', url, message }),
        );
        return degradedMarkdown(`firecrawl: scrape error: ${message}`);
      }
    },

    async extractStructuredData(input: {
      sourceUrl: string;
      content: string;
      instruction: string;
    }): Promise<AssistResult<EnrichedHiringSignals>> {
      try {
        // /v2/scrape with the `json` format is SYNCHRONOUS — one POST returns
        // `{ data: { json, markdown } }`, no job id / polling. Firecrawl fetches
        // the page itself from `url`; `input.content` (pre-fetched markdown) is
        // therefore not forwarded here — it is used by the Crawl4AI fallback in
        // repairWeakCareerPage, which re-extracts from clean markdown. The prompt
        // + schema drive the structured output.
        const body = await requestJson(base, 'POST', '/v2/scrape', apiKey, {
          url: input.sourceUrl,
          formats: [
            {
              type: 'json',
              prompt: input.instruction,
              schema: EXTRACTION_OUTPUT_SCHEMA,
            },
          ],
        });
        const mapped = mapExtractResponse(body, input.sourceUrl);
        if (!mapped) return degradedExtract('firecrawl: extract returned no usable signal');
        return {
          available: true,
          capability: 'extract-weak-signal',
          provider: PROVIDER_NAME,
          confidence: mapped.confidence,
          data: mapped,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown_error';
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'ai.firecrawl.extract_failed',
            url: input.sourceUrl,
            message,
          }),
        );
        return degradedExtract(`firecrawl: extract error: ${message}`);
      }
    },
  };
}

// ─── Stub implementation (no key / explicit Stage-1 path) ────────────────────

/**
 * The degrade-only provider: both methods return a typed "unavailable" result
 * with no network. Used when no API key is configured and exposed directly so
 * tests can exercise the degrade path deterministically.
 */
export function createStubFirecrawlProvider(
  opts: { note?: string } = {},
): ScrapeProvider {
  const note = opts.note ?? 'firecrawl: no API key configured';
  return {
    name: PROVIDER_NAME,
    async scrapeToMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      void url;
      return degradedMarkdown(note);
    },
    async extractStructuredData(input): Promise<AssistResult<EnrichedHiringSignals>> {
      void input;
      return degradedExtract(note);
    },
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build the Firecrawl provider. Returns the REAL client when an API key is
 * available (explicit arg or `FIRECRAWL_API_KEY`), otherwise the degrade-only
 * stub. Either way the result satisfies `ScrapeProvider` and never throws to the
 * caller — callers always degrade to the deterministic baseline.
 *
 * @param opts.apiKey override the env key (mainly for tests).
 */
export function createFirecrawlProvider(
  opts: { apiKey?: string | null } = {},
): ScrapeProvider {
  const apiKey = resolveApiKey(opts.apiKey);
  if (!apiKey) return createStubFirecrawlProvider();
  return createRealFirecrawlProvider(apiKey);
}
