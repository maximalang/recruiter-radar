/**
 * Tests for the Crawl4AI markdown fallback provider (real client + stub).
 *
 * What is under test (spec §2.2):
 *   - Without CRAWL4AI_API_URL the provider is the degrade-only stub: the method
 *     returns a typed "unavailable" result and makes NO network call.
 *   - With a base URL the real client maps a Crawl4AI /md response onto the shared
 *     ScrapeMarkdownResult, attaching the requested URL as provenance.
 *   - The real client NEVER throws: HTTP errors, timeouts, and malformed bodies
 *     all degrade to available:false.
 *   - It satisfies the SAME markdown seam as ScrapeGraphAI (swappable provider).
 */

import {
  createCrawl4aiProvider,
  createStubCrawl4aiProvider,
  isCrawl4aiConfigured,
  type MarkdownProvider,
} from '@/lib/ai/providers/crawl4ai';

const originalFetch = global.fetch;
const ORIGINAL_URL = process.env.CRAWL4AI_API_URL;
const ORIGINAL_TOKEN = process.env.CRAWL4AI_API_TOKEN;

afterEach(() => {
  global.fetch = originalFetch;
  if (ORIGINAL_URL === undefined) delete process.env.CRAWL4AI_API_URL;
  else process.env.CRAWL4AI_API_URL = ORIGINAL_URL;
  if (ORIGINAL_TOKEN === undefined) delete process.env.CRAWL4AI_API_TOKEN;
  else process.env.CRAWL4AI_API_TOKEN = ORIGINAL_TOKEN;
});

function mockFetchOnceJson(body: unknown, ok = true, status = 200): jest.Mock {
  const fn = jest.fn(async () => ({ ok, status, json: async () => body })) as unknown as jest.Mock;
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

// ─── No config → degrade-only stub ───────────────────────────────────────────

describe('createCrawl4aiProvider — no config → degrade-only stub', () => {
  beforeEach(() => {
    delete process.env.CRAWL4AI_API_URL;
  });

  it('returns a provider named crawl4ai implementing the markdown seam', () => {
    const p: MarkdownProvider = createCrawl4aiProvider();
    expect(p.name).toBe('crawl4ai');
    expect(typeof p.fetchCleanMarkdown).toBe('function');
  });

  it('degrades to unavailable without any network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const r = await createCrawl4aiProvider().fetchCleanMarkdown('https://weak.test/careers');
    expect(r.available).toBe(false);
    expect(r.data).toBeNull();
    expect(r.provider).toBe('crawl4ai');
    expect(r.note).toMatch(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('isCrawl4aiConfigured reflects the CRAWL4AI_API_URL env var', () => {
    delete process.env.CRAWL4AI_API_URL;
    expect(isCrawl4aiConfigured()).toBe(false);
    process.env.CRAWL4AI_API_URL = 'https://crawl.local';
    expect(isCrawl4aiConfigured()).toBe(true);
  });

  it('createStubCrawl4aiProvider is always degrade-only', async () => {
    const r = await createStubCrawl4aiProvider().fetchCleanMarkdown('https://x.test');
    expect(r.available).toBe(false);
  });
});

// ─── With config → real client maps the response ─────────────────────────────

describe('createCrawl4aiProvider — real client mapping', () => {
  it('maps a /md response onto markdown with our provenance', async () => {
    const fetchSpy = mockFetchOnceJson({ markdown: '# Careers\nWe are hiring.' });
    const p = createCrawl4aiProvider({ apiUrl: 'https://crawl.local' });
    const r = await p.fetchCleanMarkdown('https://weak.test/careers');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/md$/);
    expect(r.available).toBe(true);
    expect(r.provider).toBe('crawl4ai');
    expect(r.data?.markdown).toContain('We are hiring');
    expect(r.data?.fetchedUrl).toBe('https://weak.test/careers');
  });

  it('unwraps the array { results: [{ markdown }] } shape', async () => {
    mockFetchOnceJson({ results: [{ markdown: '# From array', url: 'https://final.test' }] });
    const r = await createCrawl4aiProvider({ apiUrl: 'https://crawl.local' }).fetchCleanMarkdown(
      'https://weak.test/careers',
    );
    expect(r.available).toBe(true);
    expect(r.data?.markdown).toBe('# From array');
    expect(r.data?.fetchedUrl).toBe('https://final.test');
  });

  it('sends a bearer token when CRAWL4AI_API_TOKEN is set', async () => {
    process.env.CRAWL4AI_API_TOKEN = 'tok-123';
    const fetchSpy = mockFetchOnceJson({ markdown: '# x' });
    await createCrawl4aiProvider({ apiUrl: 'https://crawl.local' }).fetchCleanMarkdown(
      'https://weak.test/careers',
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-123' });
  });

  it('degrades when /md returns no markdown', async () => {
    mockFetchOnceJson({ results: [] });
    const r = await createCrawl4aiProvider({ apiUrl: 'https://crawl.local' }).fetchCleanMarkdown(
      'https://weak.test/careers',
    );
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/no markdown/i);
  });

  it('degrades (does not throw) on an HTTP error', async () => {
    mockFetchOnceJson({}, false, 502);
    const r = await createCrawl4aiProvider({ apiUrl: 'https://crawl.local' }).fetchCleanMarkdown(
      'https://weak.test/careers',
    );
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/error/i);
  });

  it('degrades (does not throw) when fetch rejects (timeout/abort)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('The operation was aborted');
    }) as unknown as typeof fetch;
    const r = await createCrawl4aiProvider({ apiUrl: 'https://crawl.local' }).fetchCleanMarkdown(
      'https://weak.test/careers',
    );
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/error/i);
  });
});
