/**
 * OpenAI-compatible LLM provider configuration — the single source of truth for
 * which LLM backs Firecrawl structured extraction (and any future in-app LLM
 * call). CodeXoid is the configured provider; OpenAI remains the fallback.
 *
 * Architecture (keep this honest):
 *   - This module is the LLM PROVIDER layer (model + credentials + base URL).
 *   - Firecrawl (`./firecrawl`) and Crawl4AI (`./crawl4ai`) are TOOL /
 *     extraction layers with their own auth — they are NOT OpenAI-compatible and
 *     are not routed through here. (Firecrawl consumes these env vars at the
 *     container level for its OWN LLM calls; this module exposes them to Next.js
 *     code for any future in-app LLM call.)
 *   - Firecrawl (docker-compose) consumes these env vars directly at the
 *     container level; this module exposes them to Next.js code for any future
 *     in-app LLM call and to make the configuration testable.
 *
 * Read from process.env only — secrets are never hardcoded. `.env.example`
 * documents every variable.
 */

/** Default OpenAI base URL, used when OPENAI_BASE_URL is unset. */
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Default OpenAI model, used when no model env var is set. */
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/**
 * Resolve the LLM API key. Read from OPENAI_API_KEY only — never hardcoded.
 * Returns null when unset, so callers can gate (no key ⇒ no LLM call).
 */
export function resolveLlmApiKey(explicit?: string | null): string | null {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const fromEnv = process.env.OPENAI_API_KEY;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null;
}

/**
 * Resolve the OpenAI-compatible base URL. Defaults to OpenAI; pointing
 * OPENAI_BASE_URL at https://codexoid.duckdns.org/v1 switches to CodeXoid with
 * no code change. Never throws.
 */
export function resolveLlmBaseUrl(explicit?: string | null): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const fromEnv = process.env.OPENAI_BASE_URL;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : DEFAULT_OPENAI_BASE_URL;
}

/**
 * Resolve the model name. Precedence: explicit arg → CODEXOID_MODEL (when set,
 * signals CodeXoid is the intended provider) → FIRECRAWL_LLM_MODEL → OpenAI
 * default. Returns the model a caller should pass to the LLM explicitly, so
 * no consumer has to hardcode a model name.
 */
export function resolveLlmModel(explicit?: string | null): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const codexoid = process.env.CODEXOID_MODEL;
  if (typeof codexoid === 'string' && codexoid.length > 0) return codexoid;
  const firecrawl = process.env.FIRECRAWL_LLM_MODEL;
  if (typeof firecrawl === 'string' && firecrawl.length > 0) return firecrawl;
  return DEFAULT_OPENAI_MODEL;
}

/** Whether any LLM credentials are configured (OPENAI_API_KEY is set). */
export function isLlmConfigured(): boolean {
  return resolveLlmApiKey() !== null;
}

/**
 * Whether the configured LLM provider is CodeXoid (OPENAI_BASE_URL points at the
 * CodeXoid host). Exposed so callers can attribute the provider in logs/UI and
 * so tests can assert the CodeXoid path is selected without inspecting secrets.
 */
export function isCodeXoidProvider(): boolean {
  const base = resolveLlmBaseUrl().toLowerCase();
  return base.includes('codexoid');
}

/** A snapshot of the resolved LLM configuration (no secret value). For logs. */
export interface LlmProviderConfig {
  /** The base URL requests go to. */
  baseUrl: string;
  /** The model name to pass explicitly. */
  model: string;
  /** Which provider this resolves to. */
  provider: 'codexoid' | 'openai' | 'unknown';
  /** True when an API key is present. */
  configured: boolean;
}

/**
 * Resolve the full LLM provider config. Pure + synchronous; reads env only.
 * Never includes the API key — callers fetch that separately via
 * `resolveLlmApiKey()` so it never leaks into logs.
 */
export function resolveLlmProviderConfig(): LlmProviderConfig {
  const baseUrl = resolveLlmBaseUrl();
  const configured = isLlmConfigured();
  return {
    baseUrl,
    model: resolveLlmModel(),
    provider: isCodeXoidProvider() ? 'codexoid' : baseUrl.includes('openai.com') ? 'openai' : 'unknown',
    configured,
  };
}
