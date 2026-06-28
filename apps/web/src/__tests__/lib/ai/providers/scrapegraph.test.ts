/**
 * Tests for the ScrapeGraphAI provider (real client + degrade-only stub).
 *
 * What is under test (spec §1, §4):
 *   - Without an API key, the provider is the degrade-only stub: both methods
 *     return a typed "unavailable" result and make NO network call.
 *   - With an API key, the real client maps a ScrapeGraphAI /extract response onto
 *     the EnrichedHiringSignals contract, attaching our own provenance.
 *   - The real client NEVER throws: HTTP errors, timeouts, and malformed bodies
 *     all degrade to available:false.
 *   - The extraction instruction is centralized in product code (prompt
 *     versioning never lives in n8n).
 */

import {
  createScrapeGraphProvider,
  createStubScrapeGraphProvider,
  isScrapeGraphConfigured,
  CAREER_PAGE_EXTRACTION_INSTRUCTION,
  type ScrapeProvider,
} from '@/lib/ai/providers/scrapegraph';

// Mock fetch per-test; restore after each so cases don't leak.
const originalFetch = global.fetch;
const ORIGINAL_KEY = process.env.SCRAPEGRAPH_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  if (ORIGINAL_KEY === undefined) delete process.env.SCRAPEGRAPH_API_KEY;
  else process.env.SCRAPEGRAPH_API_KEY = ORIGINAL_KEY;
});

function mockFetchOnceJson(body: unknown, ok = true, status = 200): jest.Mock {
  const fn = jest.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as jest.Mock;
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

// ─── No key → degrade-only stub ──────────────────────────────────────────────

describe('createScrapeGraphProvider — no key → degrade-only stub', () => {
  beforeEach(() => {
    delete process.env.SCRAPEGRAPH_API_KEY;
  });

  it('returns a provider named scrapegraph implementing both methods', () => {
    const p: ScrapeProvider = createScrapeGraphProvider();
    expect(p.name).toBe('scrapegraph');
    expect(typeof p.scrapeToMarkdown).toBe('function');
    expect(typeof p.extractStructuredData).toBe('function');
  });

  it('scrapeToMarkdown degrades to unavailable without any network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const r = await createScrapeGraphProvider().scrapeToMarkdown('https://example.com/careers');
    expect(r.available).toBe(false);
    expect(r.data).toBeNull();
    expect(r.provider).toBe('scrapegraph');
    expect(r.capability).toBe('extract-weak-signal');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('extractStructuredData degrades to unavailable without any network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const r = await createScrapeGraphProvider().extractStructuredData({
      sourceUrl: 'https://example.com/careers',
      content: '# Careers\nWe are hiring.',
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });
    expect(r.available).toBe(false);
    expect(r.data).toBeNull();
    expect(r.provider).toBe('scrapegraph');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('createStubScrapeGraphProvider is always degrade-only', async () => {
    const stub = createStubScrapeGraphProvider();
    const r = await stub.extractStructuredData({
      sourceUrl: 'https://x.test',
      content: 'x',
      instruction: 'x',
    });
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/no API key/i);
  });
});

// ─── With key → real client maps the response ────────────────────────────────

describe('createScrapeGraphProvider — real client mapping', () => {
  it('maps a /extract response onto EnrichedHiringSignals with our provenance', async () => {
    const fetchSpy = mockFetchOnceJson({
      result: {
        detectedRoles: [
          { title: 'Backend Engineer', department: 'Engineering', confidence: 'high' },
          { title: 'QA', department: null, confidence: 'medium' },
          { department: 'NoTitle' }, // dropped — no title
        ],
        hiringUrgency: 'high',
        departments: ['Engineering', 'Engineering', 'QA'], // deduped on map
        locations: ['Москва'],
        hiringPatternSummary: 'Активный найм в инженерную команду.',
        confidence: 'high',
      },
    });

    const p = createScrapeGraphProvider({ apiKey: 'sk-test' });
    const r = await p.extractStructuredData({
      sourceUrl: 'https://weak.test/careers',
      content: '# Careers',
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Hits the /extract endpoint with our key header.
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/extract$/);
    expect((init as RequestInit).headers).toMatchObject({ 'SGAI-APIKEY': 'sk-test' });

    expect(r.available).toBe(true);
    expect(r.provider).toBe('scrapegraph');
    expect(r.data?.sourceUrl).toBe('https://weak.test/careers'); // OUR provenance
    expect(r.data?.provider).toBe('scrapegraph');
    expect(r.data?.detectedRoles).toHaveLength(2); // titleless role dropped
    expect(r.data?.detectedRoles[0].title).toBe('Backend Engineer');
    expect(r.data?.hiringUrgency).toBe('high');
    expect(r.data?.departments).toEqual(['Engineering', 'QA']); // deduped
  });

  it('degrades when /extract returns no usable signal (no roles, no summary)', async () => {
    mockFetchOnceJson({ result: { detectedRoles: [], hiringPatternSummary: '' } });
    const r = await createScrapeGraphProvider({ apiKey: 'sk-test' }).extractStructuredData({
      sourceUrl: 'https://weak.test/careers',
      content: '# Careers',
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/no usable signal/i);
  });

  it('degrades (does not throw) on an HTTP error', async () => {
    mockFetchOnceJson({}, false, 500);
    const r = await createScrapeGraphProvider({ apiKey: 'sk-test' }).extractStructuredData({
      sourceUrl: 'https://weak.test/careers',
      content: '# Careers',
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/error/i);
  });

  it('degrades (does not throw) when fetch rejects (timeout/abort)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('The operation was aborted');
    }) as unknown as typeof fetch;
    const r = await createScrapeGraphProvider({ apiKey: 'sk-test' }).scrapeToMarkdown(
      'https://weak.test/careers',
    );
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/error/i);
  });

  it('maps a /scrape response onto markdown', async () => {
    const fetchSpy = mockFetchOnceJson({ result: { markdown: '# Careers\nWe hire.' } });
    const r = await createScrapeGraphProvider({ apiKey: 'sk-test' }).scrapeToMarkdown(
      'https://weak.test/careers',
    );
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/scrape$/);
    expect(r.available).toBe(true);
    expect(r.data?.markdown).toContain('We hire');
    expect(r.data?.fetchedUrl).toBe('https://weak.test/careers');
  });
});

// ─── Config + prompt ─────────────────────────────────────────────────────────

describe('isScrapeGraphConfigured', () => {
  it('reflects the SCRAPEGRAPH_API_KEY env var', () => {
    delete process.env.SCRAPEGRAPH_API_KEY;
    expect(isScrapeGraphConfigured()).toBe(false);
    process.env.SCRAPEGRAPH_API_KEY = 'sk-live';
    expect(isScrapeGraphConfigured()).toBe(true);
  });
});

describe('extraction instruction (prompt lives in product code)', () => {
  it('asks for roles, department, location, urgency, and a pattern summary', () => {
    const i = CAREER_PAGE_EXTRACTION_INSTRUCTION.toLowerCase();
    expect(i).toContain('role');
    expect(i).toContain('department');
    expect(i).toContain('location');
    expect(i).toContain('urgency');
    expect(i).toContain('pattern');
  });

  it('forbids inventing facts (trust boundary in the prompt itself)', () => {
    expect(CAREER_PAGE_EXTRACTION_INSTRUCTION.toLowerCase()).toContain('do not invent');
  });
});
