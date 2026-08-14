const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Last-resort extraction provider chain for already-authorized public pages.
 * Crawl4AI is preferred when self-hosted; Firecrawl is used only when
 * configured. Provider output remains untrusted and must pass the caller's
 * deterministic record validation before persistence.
 */
export async function fetchExtractionMarkdown(url, options = {}) {
  const attempts = [];
  const crawl4aiApiUrl = options.crawl4aiApiUrl === null
    ? null
    : cleanBaseUrl(options.crawl4aiApiUrl ?? process.env.CRAWL4AI_API_URL);
  const firecrawlApiKey = options.firecrawlApiKey === null
    ? null
    : cleanText(options.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY);

  if (crawl4aiApiUrl) {
    try {
      const markdown = await fetchCrawl4aiMarkdown(url, {
        apiUrl: crawl4aiApiUrl,
        apiToken: options.crawl4aiApiToken ?? process.env.CRAWL4AI_API_TOKEN,
        fetchImpl: options.crawl4aiFetch ?? fetch,
        timeoutMs: options.timeoutMs,
      });
      if (markdown) {
        attempts.push({ provider: 'crawl4ai', outcome: 'parsed', reason: null });
        return { available: true, provider: 'crawl4ai', markdown, attempts };
      }
      attempts.push({ provider: 'crawl4ai', outcome: 'empty', reason: 'no-markdown' });
    } catch (error) {
      attempts.push({ provider: 'crawl4ai', outcome: 'error', reason: boundedReason(error) });
    }
  }

  if (firecrawlApiKey) {
    try {
      const scrape = options.firecrawlScrape ?? createFirecrawlScrape({
        apiKey: firecrawlApiKey,
        apiUrl: options.firecrawlApiUrl ?? process.env.FIRECRAWL_API_URL,
        timeoutMs: options.timeoutMs,
      });
      const document = await scrape(url);
      const markdown = cleanText(document?.markdown ?? document?.data?.markdown);
      if (markdown) {
        attempts.push({ provider: 'firecrawl', outcome: 'parsed', reason: null });
        return { available: true, provider: 'firecrawl', markdown, attempts };
      }
      attempts.push({ provider: 'firecrawl', outcome: 'empty', reason: 'no-markdown' });
    } catch (error) {
      attempts.push({ provider: 'firecrawl', outcome: 'error', reason: boundedReason(error) });
    }
  }

  return { available: false, provider: null, markdown: null, attempts };
}

async function fetchCrawl4aiMarkdown(url, { apiUrl, apiToken, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  timer.unref?.();
  try {
    const headers = { 'content-type': 'application/json' };
    const token = cleanText(apiToken);
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(`${apiUrl}/md`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`crawl4ai returned HTTP ${response.status}`);
    return mapMarkdownResponse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function createFirecrawlScrape({ apiKey, apiUrl, timeoutMs }) {
  return async (url) => {
    const FirecrawlApp = (await import('@mendable/firecrawl-js')).default;
    const app = new FirecrawlApp({
      apiKey,
      ...(cleanBaseUrl(apiUrl) ? { apiUrl: cleanBaseUrl(apiUrl) } : {}),
    });
    return app.scrapeUrl(url, {
      formats: ['markdown'],
      timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  };
}

function mapMarkdownResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const direct = cleanText(body.markdown ?? body.result ?? body.content);
  if (direct) return direct;
  const first = Array.isArray(body.results) ? body.results[0] : null;
  return cleanText(first?.markdown ?? first?.content);
}

function cleanBaseUrl(value) {
  const text = cleanText(value);
  return text ? text.replace(/\/+$/, '') : null;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boundedReason(error) {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown-error');
  return message.slice(0, 200);
}
