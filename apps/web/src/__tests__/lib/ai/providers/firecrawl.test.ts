/**
 * Tests for the Firecrawl provider (real client + degrade-only stub).
 *
 * What is under test (spec §1, §4):
 *   - Without an API key, the provider is the degrade-only stub: both methods
 *     return a typed "unavailable" result and make NO network call.
 *   - With an API key, the real client maps a Firecrawl /v2/scrape json response
 *     onto the EnrichedHiringSignals contract, attaching our own provenance.
 *   - Structured extraction rides on /v2/scrape formats:[json] — SYNCHRONOUS,
 *     one POST returns { data: { json, markdown } }, no job id / polling.
 *   - /v2/scrape formats:[markdown] returns markdown synchronously.
 *   - The real client NEVER throws: HTTP errors, timeouts, and malformed bodies
 *     all degrade to available:false.
 *   - The extraction instruction is centralized in product code (prompt
 *     versioning never lives in n8n).
 */

import {
  createFirecrawlProvider,
  createStubFirecrawlProvider,
  isFirecrawlConfigured,
  CAREER_PAGE_EXTRACTION_INSTRUCTION,
  type ScrapeProvider,
} from '@/lib/ai/providers/firecrawl';

// Mock fetch per-test; restore after each so cases don't leak.
const originalFetch = global.fetch;
const ORIGINAL_KEY = process.env.FIRECRAWL_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  if (ORIGINAL_KEY === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = ORIGINAL_KEY;
  jest.restoreAllMocks();
});

/** Drive fetch to return the given JSON bodies in sequence, one per call. */
function mockFetchSequence(bodies: Array<{ body: unknown; ok?: boolean; status?: number }>): jest.Mock {
  const calls = bodies.map((b) => ({
    ok: b.ok ?? true,
    status: b.status ?? 200,
    json: async () => b.body,
  }));
  const fn = jest.fn(async () => calls.shift()!) as unknown as jest.Mock;
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchOnceJson(body: unknown, ok = true, status = 200): jest.Mock {
  return mockFetchSequence([{ body, ok, status }]);
}

// ─── No key → degrade-only stub ──────────────────────────────────────────────

describe('createFirecrawlProvider — no key → degrade-only stub', () => {
  beforeEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
  });

  it('returns a provider named firecrawl implementing both methods', () => {
    const p: ScrapeProvider = createFirecrawlProvider();
    expect(p.name).toBe('firecrawl');
    expect(typeof p.scrapeToMarkdown).toBe('function');
    expect(typeof p.extractStructuredData).toBe('function');
  });

  it('scrapeToMarkdown degrades to unavailable without any network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const r = await createFirecrawlProvider().scrapeToMarkdown('https://example.com/careers');
    expect(r.available).toBe(false);
    expect(r.data).toBeNull();
    expect(r.provider).toBe('firecrawl');
    expect(r.capability).toBe('extract-weak-signal');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('extractStructuredData degrades to unavailable without any network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const r = await createFirecrawlProvider().extractStructuredData({
      sourceUrl: 'https://example.com/careers',
      content: '# Careers\nWe are hiring.',
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });
    expect(r.available).toBe(false);
    expect(r.data).toBeNull();
    expect(r.provider).toBe('firecrawl');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('createStubFirecrawlProvider is always degrade-only', async () => {
    const stub = createStubFirecrawlProvider();
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

describe('createFirecrawlProvider — real client mapping', () => {
  it('maps a synchronous /v2/scrape json response onto EnrichedHiringSignals', async () => {
    const fetchSpy = mockFetchSequence([
      // POST /v2/scrape formats:[json] → synchronous { data: { json } }
      {
        body: {
          success: true,
          data: {
            json: {
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
          },
        },
      },
    ]);

    const p = createFirecrawlProvider({ apiKey: 'fc-test' });
    const r = await p.extractStructuredData({
      sourceUrl: 'https://weak.test/careers',
      content: '# Careers',
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1); // synchronous — no polling
    // POST /v2/scrape with Bearer auth and a json format entry.
    const [url1, init1] = fetchSpy.mock.calls[0];
    expect(String(url1)).toMatch(/\/v2\/scrape$/);
    expect((init1 as RequestInit).method).toBe('POST');
    expect((init1 as RequestInit).headers).toMatchObject({ Authorization: 'Bearer fc-test' });
    const sentBody = JSON.parse(String((init1 as RequestInit).body));
    expect(sentBody.url).toBe('https://weak.test/careers');
    expect(sentBody.formats[0].type).toBe('json');
    expect(sentBody.formats[0].prompt).toBe(CAREER_PAGE_EXTRACTION_INSTRUCTION);
    expect(sentBody.formats[0].schema).toBeDefined();

    expect(r.available).toBe(true);
    expect(r.provider).toBe('firecrawl');
    expect(r.data?.sourceUrl).toBe('https://weak.test/careers'); // OUR provenance
    expect(r.data?.provider).toBe('firecrawl');
    expect(r.data?.detectedRoles).toHaveLength(2); // titleless role dropped
    expect(r.data?.detectedRoles[0].title).toBe('Backend Engineer');
    expect(r.data?.hiringUrgency).toBe('high');
    expect(r.data?.departments).toEqual(['Engineering', 'QA']); // deduped
  });

  it('accepts a json result inlined at data (no nested json key)', async () => {
    const fetchSpy = mockFetchOnceJson({
      data: {
        detectedRoles: [{ title: 'Recruiter' }],
        hiringUrgency: 'medium',
        hiringPatternSummary: 'Небольшой найм.',
      },
    });
    const r = await createFirecrawlProvider({ apiKey: 'fc-test' }).extractStructuredData({
      sourceUrl: 'https://weak.test/careers',
      content: '# Careers',
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.available).toBe(true);
    expect(r.data?.detectedRoles[0].title).toBe('Recruiter');
  });

  it('degrades when /v2/scrape json returns no usable signal (no roles, no summary)', async () => {
    mockFetchOnceJson({ data: { json: { detectedRoles: [], hiringPatternSummary: '' } } });
    const r = await createFirecrawlProvider({ apiKey: 'fc-test' }).extractStructuredData({
      sourceUrl: 'https://weak.test/careers',
      content: '# Careers',
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/no usable signal/i);
  });

  it('degrades (does not throw) on an HTTP error', async () => {
    mockFetchOnceJson({}, false, 500);
    const r = await createFirecrawlProvider({ apiKey: 'fc-test' }).extractStructuredData({
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
    const r = await createFirecrawlProvider({ apiKey: 'fc-test' }).scrapeToMarkdown(
      'https://weak.test/careers',
    );
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/error/i);
  });

  it('maps a /v2/scrape response onto markdown', async () => {
    const fetchSpy = mockFetchOnceJson({ data: { markdown: '# Careers\nWe hire.', url: 'https://weak.test/careers' } });
    const r = await createFirecrawlProvider({ apiKey: 'fc-test' }).scrapeToMarkdown(
      'https://weak.test/careers',
    );
    const [url1, init1] = fetchSpy.mock.calls[0];
    expect(String(url1)).toMatch(/\/v2\/scrape$/);
    const sentBody = JSON.parse(String((init1 as RequestInit).body));
    expect(sentBody.formats).toEqual(['markdown']);
    expect(r.available).toBe(true);
    expect(r.data?.markdown).toContain('We hire');
    expect(r.data?.fetchedUrl).toBe('https://weak.test/careers');
  });
});

// ─── Config + prompt ─────────────────────────────────────────────────────────

describe('isFirecrawlConfigured', () => {
  it('reflects the FIRECRAWL_API_KEY env var', () => {
    delete process.env.FIRECRAWL_API_KEY;
    expect(isFirecrawlConfigured()).toBe(false);
    process.env.FIRECRAWL_API_KEY = 'fc-live';
    expect(isFirecrawlConfigured()).toBe(true);
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
