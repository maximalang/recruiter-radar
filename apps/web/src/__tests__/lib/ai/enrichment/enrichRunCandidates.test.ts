/**
 * Tests for the daily-pipeline AI enrichment step (enrichRunCandidates).
 *
 * This is the production wiring that was previously missing: the daily radar
 * committed candidates and delivered them WITHOUT ever running enrichment, so
 * ai_enrichment stayed NULL for every real lead. These tests lock the contract:
 *   - PROVIDER-GATED: no key ⇒ ran:false and ZERO database work.
 *   - HAPPY PATH: a weak career page ⇒ provider runs ⇒ enrichment persisted.
 *   - ISOLATION: a per-candidate failure never aborts the run.
 */

import { enrichRunCandidates } from '@/lib/ai/enrichment/enrichRunCandidates';
import { getPool } from '@/lib/db';
import {
  isFirecrawlConfigured,
  isCrawl4aiConfigured,
  createFirecrawlProvider,
  repairWeakCareerPage,
  persistEnrichmentForCandidate,
  hasEnrichment,
} from '@/lib/ai';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/ai', () => ({
  isFirecrawlConfigured: jest.fn(),
  isCrawl4aiConfigured: jest.fn(),
  createFirecrawlProvider: jest.fn(),
  createCrawl4aiProvider: jest.fn(),
  repairWeakCareerPage: jest.fn(),
  persistEnrichmentForCandidate: jest.fn(),
  hasEnrichment: jest.fn(),
}));

const mockQuery = jest.fn();
const mockGetPool = jest.mocked(getPool);
const mockIsFirecrawlConfigured = jest.mocked(isFirecrawlConfigured);
const mockIsCrawl4aiConfigured = jest.mocked(isCrawl4aiConfigured);
const mockCreateProvider = jest.mocked(createFirecrawlProvider);
const mockRepair = jest.mocked(repairWeakCareerPage);
const mockPersist = jest.mocked(persistEnrichmentForCandidate);
const mockHasEnrichment = jest.mocked(hasEnrichment);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPool.mockReturnValue({ query: mockQuery } as never);
  mockIsCrawl4aiConfigured.mockReturnValue(false);
  mockCreateProvider.mockReturnValue({ name: 'firecrawl' } as never);
});

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    candidate_id: '1',
    org_id: '10',
    client_profile_id: '5',
    career_page_url: 'https://weak.test/careers',
    vacancies_count: 1,
    latest_published_at: '2026-06-01T00:00:00Z',
    payload: { confidence_gate: 'C', evidence_titles: ['QA'] },
    ...overrides,
  };
}

describe('enrichRunCandidates — provider gate', () => {
  it('returns ran:false and does NO database work when no provider is configured', async () => {
    mockIsFirecrawlConfigured.mockReturnValue(false);

    const result = await enrichRunCandidates('run-1');

    expect(result).toEqual({ ran: false, considered: 0, enriched: 0 });
    expect(mockGetPool).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockRepair).not.toHaveBeenCalled();
  });

  it('returns ran:false when configured but there is no pool', async () => {
    mockIsFirecrawlConfigured.mockReturnValue(true);
    mockGetPool.mockReturnValue(null);

    const result = await enrichRunCandidates('run-1');
    expect(result.ran).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('enrichRunCandidates — happy path', () => {
  beforeEach(() => {
    mockIsFirecrawlConfigured.mockReturnValue(true);
  });

  it('persists enrichment for a candidate whose page yields signal', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [candidateRow()] });
    mockRepair.mockResolvedValue({ available: true, data: {} } as never);
    mockHasEnrichment.mockReturnValue(true);
    mockPersist.mockResolvedValue(1);

    const result = await enrichRunCandidates('run-1');

    expect(result).toEqual({ ran: true, considered: 1, enriched: 1 });
    expect(mockRepair).toHaveBeenCalledTimes(1);
    // Persisted against the natural (clientProfileId, orgId) key — never an
    // arbitrary candidate id — so the UPDATE matches the right row.
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({ clientProfileId: '5', orgId: '10' }),
    );
  });

  it('does not persist when the provider returns no usable signal', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [candidateRow()] });
    mockRepair.mockResolvedValue({ available: false, data: null } as never);
    mockHasEnrichment.mockReturnValue(false);

    const result = await enrichRunCandidates('run-1');

    expect(result).toEqual({ ran: true, considered: 1, enriched: 0 });
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('reports ran:true with zero considered when the run has no enrichable candidates', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await enrichRunCandidates('run-1');
    expect(result).toEqual({ ran: true, considered: 0, enriched: 0 });
    expect(mockRepair).not.toHaveBeenCalled();
  });
});

describe('enrichRunCandidates — isolation', () => {
  beforeEach(() => {
    mockIsFirecrawlConfigured.mockReturnValue(true);
  });

  it('a failure on one candidate does not abort the others', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        candidateRow({ candidate_id: '1', org_id: '10' }),
        candidateRow({ candidate_id: '2', org_id: '20' }),
      ],
    });
    mockHasEnrichment.mockReturnValue(true);
    mockPersist.mockResolvedValue(1);
    // First candidate throws inside repair; second succeeds.
    mockRepair
      .mockRejectedValueOnce(new Error('provider blew up'))
      .mockResolvedValueOnce({ available: true, data: {} } as never);

    const result = await enrichRunCandidates('run-1');

    expect(result.ran).toBe(true);
    expect(result.considered).toBe(2);
    expect(result.enriched).toBe(1);
  });

  it('swallows a query failure and reports ran:true / nothing enriched', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    const result = await enrichRunCandidates('run-1');
    expect(result).toEqual({ ran: true, considered: 0, enriched: 0 });
  });
});
