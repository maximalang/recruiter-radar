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
 *   - `extract`  → POST /v1/extract  (structured JSON for our hiring schema)
 *   - `scrape`   → POST /v1/scrape   (markdown fallback when extract is empty)
 * The real client NEVER throws to the caller: any failure (no key, timeout, HTTP
 * error, malformed body) degrades to a typed `available: false` result and is
 * logged. The stub is kept so Stage-1 callers and tests still exercise the
 * degrade path without a key, and so Crawl4AI / PixelRAG can implement the same
 * interface unchanged.
 *
 * Firecrawl /v1/extract is ASYNC: the first POST returns a job id, then the
 * caller polls GET /v1/extract/{id} until status is "completed". /v1/scrape is
 * synchronous. Each HTTP call has a hard REQUEST_TIMEOUT_MS (15s); the total
 * extract wall-clock is bounded by REQUEST_TIMEOUT_MS (POST) + MAX_EXTRACT_POLLS
 * × (EXTRACT_POLL_DELAY_MS + REQUEST_TIMEOUT_MS) ≈ 15 + 6×(2+15) ≈ 117s worst
 * case, but the per-org 1/24h quota means at most one such hang per org/day.
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

/** Max polls for the async /v1/extract job before giving up. Bounds total wall-clock. */
const MAX_EXTRACT_POLLS = 6;
/** Delay between extract-status polls. */
const EXTRACT_POLL_DELAY_MS = 2_000;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Firecrawl /v1/extract wraps the schema result under a `data` (or `result`)
 * key. Unwrap defensively — providers differ and we never trust shape.
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
 * Map a Firecrawl extract body into `EnrichedHiringSignals`, attaching our own
 * provenance (sourceUrl + provider). Returns null when the body carries no
 * usable signal (no roles AND no summary) — the caller then degrades.
 */
function mapExtractResponse(
  body: unknown,
  sourceUrl: string,
): EnrichedHiringSignals | null {
  const result = unwrapResult(body);
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

/**
 * Firecrawl /v1/extract is async. POST returns a job id; we then poll
 * GET /v1/extract/{id} until status === 'completed' (or a terminal failure).
 * Returns the final body (with `data` populated) or throws on failure/timeout.
 */
async function runExtractJob(
  base: string,
  apiKey: string,
  requestBody: Record<string, unknown>,
): Promise<unknown> {
  const startBody = await requestJson(base, 'POST', '/v1/extract', apiKey, requestBody);

  // Firecrawl v1 returns { id, status } or { jobId }. Tolerate both.
  const startObj =
    typeof startBody === 'object' && startBody !== null
      ? (startBody as Record<string, unknown>)
      : {};
  const jobId = asString(startObj.id) ?? asString(startObj.jobId);
  if (!jobId) {
    // Some self-hosted builds return the result synchronously — accept it.
    return startBody;
  }

  // If already completed with data, skip polling.
  const startStatus = asString(startObj.status);
  if (startStatus === 'completed') return startBody;

  for (let i = 0; i < MAX_EXTRACT_POLLS; i += 1) {
    await sleep(EXTRACT_POLL_DELAY_MS);
    const pollBody = await requestJson(
      base,
      'GET',
      `/v1/extract/${jobId}`,
      apiKey,
      undefined,
    );
    const pollObj =
      typeof pollBody === 'object' && pollBody !== null
        ? (pollBody as Record<string, unknown>)
        : {};
    const status = asString(pollObj.status);
    if (status === 'completed') return pollBody;
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`firecrawl extract job ${status}`);
    }
    // status === 'processing' (or unknown) → keep polling.
  }
  throw new Error('firecrawl extract job timed out (polling)');
}

function createRealFirecrawlProvider(apiKey: string): ScrapeProvider {
  const base = resolveApiBase();

  return {
    name: PROVIDER_NAME,

    async scrapeToMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      try {
        const body = await requestJson(base, 'POST', '/v1/scrape', apiKey, {
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
        const body = await runExtractJob(base, apiKey, {
          // Firecrawl /v1/extract fetches the page itself from `urls` — unlike
          // ScrapeGraphAI it does NOT accept a caller-supplied markdown/html
          // body. `input.content` (pre-fetched by the caller) is therefore not
          // forwarded here; it is still used by the Crawl4AI fallback path in
          // repairWeakCareerPage, which re-extracts from clean markdown. The
          // prompt + schema drive the structured output.
          urls: [input.sourceUrl],
          prompt: input.instruction,
          schema: EXTRACTION_OUTPUT_SCHEMA,
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
