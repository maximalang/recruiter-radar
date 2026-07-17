/**
 * Tests for career-page URL discovery — the "LLM сам собирать инфу" step that
 * visits a company site and finds its careers/vacancies page when none is
 * recorded.
 *
 * Focus: the pure validation + link-parse guards (same-site, http(s), keyword
 * match, relative-URL resolution). The scrape provider is mocked so no network
 * runs. The trust contract (only career_page_url is written, never score/gate)
 * is locked by the persist SQL naming a single column.
 */

import {
  discoverCareerPageUrls,
  assertDiscoveryDoesNotTouchEvidence,
} from '@/lib/ai/enrichment/careerPageDiscovery';
import { getPool } from '@/lib/db';
import { tryConsumeEnrichmentQuota } from '@/lib/ai/enrichment/enrichmentRateLimit';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/ai/enrichment/enrichmentRateLimit', () => ({
  tryConsumeEnrichmentQuota: jest.fn(),
  logEnrichmentApiCall: jest.fn(),
}));
jest.mock('@/lib/runtime', () => ({
  logError: jest.fn(),
  logEvent: jest.fn(),
  logWarn: jest.fn(),
}));

const mockGetPool = jest.mocked(getPool);
const mockQuota = jest.mocked(tryConsumeEnrichmentQuota);

function makeProvider(markdown: string, fetchedUrl?: string) {
  return {
    name: 'firecrawl' as const,
    scrapeToMarkdown: jest.fn().mockResolvedValue({
      available: true,
      capability: 'extract-weak-signal',
      provider: 'firecrawl',
      confidence: 'medium',
      data: { markdown, fetchedUrl: fetchedUrl ?? 'https://acme.test/' },
    }),
    extractStructuredData: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuota.mockResolvedValue({ allowed: true, consumedAt: Date.now() } as never);
});

describe('careerPageDiscovery — same-site + protocol validation', () => {
  it('discovers a careers link on the same domain and persists it', async () => {
    const mockQuery = jest.fn()
      // discovery candidate query
      .mockResolvedValueOnce({ rows: [{ orgId: '10', websiteUrl: 'https://acme.test/', domain: 'acme.test' }] })
      // persist UPDATE
      .mockResolvedValueOnce({ rowCount: 1 });
    mockGetPool.mockReturnValue({ query: mockQuery } as never);

    const provider = makeProvider(
      'Welcome to Acme. [Join us](https://acme.test/careers) — see open roles.',
    );

    const result = await discoverCareerPageUrls('run-1', provider);

    expect(result).toEqual({ ran: true, considered: 1, discovered: 1 });
    // Persist named ONLY career_page_url — the trust contract.
    const persistCall = mockQuery.mock.calls[1];
    expect(persistCall[0]).toContain('UPDATE orgs');
    expect(persistCall[0]).toContain('career_page_url = $1');
    expect(persistCall[0]).not.toContain('total_score');
    expect(persistCall[0]).not.toContain('confidence_gate');
    expect(persistCall[1]).toEqual(['https://acme.test/careers', '10']);
  });

  it('rejects a discovered URL on a DIFFERENT domain (no cross-site leak)', async () => {
    const mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ orgId: '10', websiteUrl: 'https://acme.test/', domain: 'acme.test' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    mockGetPool.mockReturnValue({ query: mockQuery } as never);

    // The link points off-site — must NOT be persisted even if it matches keywords.
    const provider = makeProvider('[Careers](https://evil.example/jobs)');

    const result = await discoverCareerPageUrls('run-1', provider);

    expect(result.discovered).toBe(0);
    // persist never called (no acceptable URL found)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('resolves a relative careers href against the fetched base URL', async () => {
    const mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ orgId: '11', websiteUrl: 'https://acme.test/', domain: 'acme.test' }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    mockGetPool.mockReturnValue({ query: mockQuery } as never);

    const provider = makeProvider(
      'About us. <a href="/vacancies">Вакансии</a> are open.',
      'https://acme.test/',
    );

    const result = await discoverCareerPageUrls('run-1', provider);

    expect(result.discovered).toBe(1);
    expect(mockQuery.mock.calls[1][1]).toEqual(['https://acme.test/vacancies', '11']);
  });

  it('discovers via Russian «вакансии» keyword link', async () => {
    const mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ orgId: '12', websiteUrl: 'https://acme.test/', domain: 'acme.test' }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    mockGetPool.mockReturnValue({ query: mockQuery } as never);

    const provider = makeProvider('[Вакансии](https://acme.test/careers)');

    const result = await discoverCareerPageUrls('run-1', provider);
    expect(result.discovered).toBe(1);
  });
});

describe('careerPageDiscovery — quota + degradation', () => {
  it('skips an org when the per-org 1/24h quota is exhausted', async () => {
    const mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ orgId: '20', websiteUrl: 'https://acme.test/', domain: 'acme.test' }] });
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
    mockQuota.mockResolvedValue({ allowed: false } as never);

    const provider = makeProvider('[Careers](https://acme.test/careers)');

    const result = await discoverCareerPageUrls('run-1', provider);

    expect(result).toEqual({ ran: true, considered: 1, discovered: 0 });
    // provider never scraped because quota blocked first
    expect(provider.scrapeToMarkdown).not.toHaveBeenCalled();
  });

  it('returns ran:false when no provider is given', async () => {
    const result = await discoverCareerPageUrls('run-1', undefined);
    expect(result).toEqual({ ran: false, considered: 0, discovered: 0 });
  });

  it('returns ran:true with zero considered when no candidates have a website gap', async () => {
    const mockQuery = jest.fn().mockResolvedValueOnce({ rows: [] });
    mockGetPool.mockReturnValue({ query: mockQuery } as never);

    const result = await discoverCareerPageUrls('run-1', makeProvider(''));
    expect(result).toEqual({ ran: true, considered: 0, discovered: 0 });
  });

  it('a per-org scrape failure never aborts the rest', async () => {
    const mockQuery = jest.fn()
      .mockResolvedValueOnce({
        rows: [
          { orgId: '30', websiteUrl: 'https://a.test/', domain: 'a.test' },
          { orgId: '31', websiteUrl: 'https://b.test/', domain: 'b.test' },
        ],
      })
      // first org: no persist (scrape fails); second org: persist
      .mockResolvedValueOnce({ rowCount: 1 });
    mockGetPool.mockReturnValue({ query: mockQuery } as never);

    const provider = {
      name: 'firecrawl' as const,
      scrapeToMarkdown: jest
        .fn()
        // first org: unavailable
        .mockResolvedValueOnce({ available: false, data: null, capability: 'extract-weak-signal', provider: 'firecrawl', confidence: 'low' })
        // second org: ok
        .mockResolvedValueOnce({
          available: true, capability: 'extract-weak-signal', provider: 'firecrawl', confidence: 'medium',
          data: { markdown: '[Jobs](https://b.test/careers)', fetchedUrl: 'https://b.test/' },
        }),
      extractStructuredData: jest.fn(),
    };

    const result = await discoverCareerPageUrls('run-1', provider);

    expect(result.considered).toBe(2);
    expect(result.discovered).toBe(1);
  });
});

describe('careerPageDiscovery — trust boundary', () => {
  it('assertDiscoveryDoesNotTouchEvidence passes when no protected field changed', () => {
    const original = { score: 300, confidenceGate: 'B' } as never;
    const after = { score: 300, confidenceGate: 'B' } as never;
    expect(() => assertDiscoveryDoesNotTouchEvidence(original, after)).not.toThrow();
  });

  it('assertDiscoveryDoesNotTouchEvidence throws when a protected field changed', () => {
    const original = { score: 300, confidenceGate: 'B' } as never;
    const after = { score: 400, confidenceGate: 'B' } as never; // score changed
    expect(() => assertDiscoveryDoesNotTouchEvidence(original, after)).toThrow();
  });
});
