/**
 * Crawl4AI provider boundary — the markdown-prep fallback for weak career pages.
 *
 * Why a SEPARATE provider (per session 2026-06-28, Stage-2 §2.2): Firecrawl's
 * `/v1/extract` is the primary structured path, but some pages are too noisy for
 * a one-shot schema extraction (heavy JS, infinite-scroll lists, prose-only
 * postings). Crawl4AI turns such a page into clean markdown — the normalized
 * intermediate a later retry can re-extract from. This file does NOT re-extract;
 * it only PREPARES markdown when the primary extract came back empty, so the
 * retry path can be wired later without a broad crawler rollout now.
 *
 * Contract: ONE method, `fetchCleanMarkdown(url)`. It mirrors
 * `ScrapeProvider.scrapeToMarkdown`, so Firecrawl and Crawl4AI are
 * structurally interchangeable behind the same markdown seam — a caller can hold
 * either as a `MarkdownProvider`.
 *
 * The real client NEVER throws to the caller: no config, timeout, HTTP error, or
 * malformed body all degrade to a typed `available: false` result and are logged.
 * Absent config ⇒ degrade-only stub, exactly like Firecrawl without a key.
 *
 * See lib/ai/providers/firecrawl.ts (primary) and
 * docs/specs/2026-06-28-ai-enrichment-career-pages.md.
 */

import type { AssistResult } from '../assist-types';
import type { EnrichmentProvider } from '../enrichment/careerPages';
import type { ScrapeMarkdownResult } from './firecrawl';

// ─── Provider interface (markdown-only, swappable) ───────────────────────────

/**
 * A page→markdown provider. Deliberately a single method so any clean-markdown
 * engine (Crawl4AI, a self-hosted reader, even Firecrawl's /v1/scrape) satisfies
 * it. Degrades to `available: false` on any failure — never throws.
 */
export interface MarkdownProvider {
  readonly name: EnrichmentProvider;
  fetchCleanMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PROVIDER_NAME: EnrichmentProvider = 'crawl4ai';

/** Hard per-request timeout. Fallback prep is best-effort and must never hang. */
const REQUEST_TIMEOUT_MS = 15_000;

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Crawl4AI is self-hosted (no SaaS default): a base URL is required to enable it.
 * Read from process.env only — never hardcoded. `.env.example` documents both
 * vars. An optional bearer token is sent when the server is auth-protected.
 */
function resolveApiBase(explicit?: string | null): string | null {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const fromEnv = process.env.CRAWL4AI_API_URL;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null;
}

function resolveApiToken(): string | null {
  const fromEnv = process.env.CRAWL4AI_API_TOKEN;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null;
}

/**
 * Whether a usable Crawl4AI configuration is present (a base URL). The single
 * place a caller checks before attempting the fallback — set the env var and the
 * real client lights up with no code change.
 */
export function isCrawl4aiConfigured(): boolean {
  return resolveApiBase() !== null;
}

// ─── Degrade helper ──────────────────────────────────────────────────────────

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

// ─── HTTP ────────────────────────────────────────────────────────────────────

/**
 * POST JSON to a Crawl4AI endpoint with a hard timeout. Returns the parsed body
 * or throws — the caller wraps every call in try/catch and degrades, so a throw
 * here never reaches the enrichment caller.
 */
async function postJson(
  base: string,
  path: string,
  token: string | null,
  body: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`crawl4ai ${path} returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Response mapping (provider shape → markdown) ────────────────────────────

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Crawl4AI's `/md` returns the markdown under one of a few keys depending on
 * version (`markdown`, `result`, or a `results[0].markdown` array). Unwrap
 * defensively — we never trust shape.
 */
function mapMarkdownResponse(body: unknown, requestedUrl: string): ScrapeMarkdownResult | null {
  if (typeof body !== 'object' || body === null) return null;
  const obj = body as Record<string, unknown>;

  // Single-result shapes.
  let markdown = asString(obj.markdown) ?? asString(obj.result) ?? asString(obj.content);
  let fetchedUrl = asString(obj.url);

  // Array shape: { results: [{ markdown, url }] }.
  if (!markdown && Array.isArray(obj.results) && obj.results.length > 0) {
    const first = obj.results[0];
    if (typeof first === 'object' && first !== null) {
      const f = first as Record<string, unknown>;
      markdown = asString(f.markdown) ?? asString(f.content);
      fetchedUrl = fetchedUrl ?? asString(f.url);
    }
  }

  if (!markdown) return null;
  return { markdown, fetchedUrl: fetchedUrl ?? requestedUrl };
}

// ─── Real client ─────────────────────────────────────────────────────────────

function createRealCrawl4aiProvider(base: string): MarkdownProvider {
  const token = resolveApiToken();
  return {
    name: PROVIDER_NAME,
    async fetchCleanMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      try {
        const body = await postJson(base, '/md', token, { url });
        const mapped = mapMarkdownResponse(body, url);
        if (!mapped) return degradedMarkdown('crawl4ai: md returned no markdown');
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
          JSON.stringify({ level: 'error', event: 'ai.crawl4ai.md_failed', url, message }),
        );
        return degradedMarkdown(`crawl4ai: md error: ${message}`);
      }
    },
  };
}

// ─── Stub implementation (no config) ─────────────────────────────────────────

/**
 * The degrade-only fallback provider: returns a typed "unavailable" result with
 * no network. Used when CRAWL4AI_API_URL is absent and exposed directly so tests
 * can exercise the degrade path deterministically.
 */
export function createStubCrawl4aiProvider(opts: { note?: string } = {}): MarkdownProvider {
  const note = opts.note ?? 'crawl4ai: not configured (CRAWL4AI_API_URL absent)';
  return {
    name: PROVIDER_NAME,
    async fetchCleanMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      void url;
      return degradedMarkdown(note);
    },
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build the Crawl4AI markdown provider. Returns the REAL client when a base URL
 * is configured (explicit arg or `CRAWL4AI_API_URL`), otherwise the degrade-only
 * stub. Either way the result satisfies `MarkdownProvider` and never throws —
 * callers fall back to the deterministic baseline.
 *
 * @param opts.apiUrl override the env base URL (mainly for tests).
 */
export function createCrawl4aiProvider(opts: { apiUrl?: string | null } = {}): MarkdownProvider {
  const base = resolveApiBase(opts.apiUrl);
  if (!base) return createStubCrawl4aiProvider();
  return createRealCrawl4aiProvider(base);
}
