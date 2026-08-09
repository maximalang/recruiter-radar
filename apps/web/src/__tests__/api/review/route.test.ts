/**
 * Tests for GET /api/review — pending review candidates list.
 *
 * Verifies that reasons are properly formatted as Russian strings
 * regardless of storage format (legacy string[] or new ScoringReason[]).
 */

import { GET, POST } from '@/app/api/review/route';
import { getPool } from '@/lib/db';
import { updateDigestOrgStateFeedback } from '@/lib/digestFeedback';
import { hasFeatureAccess } from '@/lib/entitlements';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));
jest.mock('@/lib/digestFeedback', () => ({
  updateDigestOrgStateFeedback: jest.fn(),
  // statics referenced by the module path
  DIGEST_FEEDBACK_ACTIONS: ['accepted', 'badfit', 'dismissed', 'snooze', 'contacted', 'replied', 'won'],
  isDigestFeedbackAction: jest.fn((v: unknown) => typeof v === 'string' && ['accepted', 'badfit', 'dismissed', 'snooze', 'contacted', 'replied', 'won'].includes(v as string)),
  DEFAULT_BADFIT_SUPPRESSION_DAYS: 30,
  buildDigestFeedbackActionPlan: jest.fn(),
}));

// Owner-scope guard: the route now calls getOwnerIdFromSession() before touching
// the DB. Outside a Next request scope cookies() throws, so mock the session to a
// fixed owner — the route's owner-scoped SQL still runs against the mock pool.
jest.mock('@/lib/auth-v2/authorization', () => ({
  getAuthorizedOwnerId: jest.fn(async () => 'owner-1'),
}));
jest.mock('@/lib/entitlements', () => ({ hasFeatureAccess: jest.fn(async () => true) }));

const mockQuery = jest.fn();
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockFeatureAccess = hasFeatureAccess as jest.MockedFunction<typeof hasFeatureAccess>;

function makeMockPool() {
  mockGetPool.mockReturnValue({ query: mockQuery } as never);
}

describe('GET /api/review', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeRequest(clientProfileId: string) {
    return GET(new Request(`http://localhost/api/review?clientProfileId=${clientProfileId}`));
  }

  it('returns 400 when clientProfileId is missing', async () => {
    const res = await GET(new Request('http://localhost/api/review'));
    expect(res.status).toBe(400);
  });

  it('returns 503 when DB is not available', async () => {
    mockGetPool.mockReturnValue(null);
    const res = await makeRequest('1');
    expect(res.status).toBe(503);
  });

  it('returns 403 before touching the database when API entitlement is missing', async () => {
    mockFeatureAccess.mockResolvedValueOnce(false);
    const res = await makeRequest('1');
    expect(res.status).toBe(403);
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  it('formats ScoringReason[] objects as Russian strings', async () => {
    makeMockPool();

    mockQuery
      // count query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      // items query
      .mockResolvedValueOnce({
        rows: [{
          id: '42',
          org_id: '10',
          org_name: 'Яндекс',
          score: 45,
          confidence_gate: 'A',
          vacancies_count: 5,
          distinct_vacancy_names_count: 3,
          latest_published_at: '2026-06-01T10:00:00Z',
          reasons: [
            { component: 'intent', key: 'intent.fresh-signals' },
            { component: 'intent', key: 'intent.multiple-roles', params: { count: 3 } },
          ],
          source_families: ['hh'],
          evidence_titles: ['Backend Developer'],
          location_names: ['Москва'],
          created_at: '2026-06-02T12:00:00Z',
        }],
      });

    const res = await makeRequest('1');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].reasons).toEqual([
      'Свежие сигналы найма (недели давности)',
      'Несколько открытых ролей (3) — активный найм',
    ]);
  });

  it('passes through legacy string reasons unchanged', async () => {
    makeMockPool();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: '1',
          org_id: '5',
          org_name: 'Тест',
          score: 20,
          confidence_gate: 'B',
          vacancies_count: 1,
          distinct_vacancy_names_count: 1,
          latest_published_at: null,
          reasons: ['Вакансия в IT', 'Свежий сигнал'],
          source_families: ['hh'],
          evidence_titles: ['Engineer'],
          location_names: [],
          created_at: '2026-06-01T00:00:00Z',
        }],
      });

    const res = await makeRequest('1');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items[0].reasons).toEqual(['Вакансия в IT', 'Свежий сигнал']);
    expect(mockQuery.mock.calls.every(([sql]) => !String(sql).includes('owner_id IS NULL'))).toBe(true);
  });

  it('returns empty array for null reasons', async () => {
    makeMockPool();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: '2',
          org_id: '6',
          org_name: 'Без причин',
          score: 10,
          confidence_gate: 'C',
          vacancies_count: 0,
          distinct_vacancy_names_count: 0,
          latest_published_at: null,
          reasons: null,
          source_families: [],
          evidence_titles: [],
          location_names: [],
          created_at: '2026-06-01T00:00:00Z',
        }],
      });

    const res = await makeRequest('1');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items[0].reasons).toEqual([]);
  });
});

describe('POST /api/review', () => {
  const mockSuppress = updateDigestOrgStateFeedback as jest.MockedFunction<typeof updateDigestOrgStateFeedback>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeMockPool() {
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
  }

  it('rejects an invalid action', async () => {
    const res = await POST(
      new Request('http://localhost/api/review', {
        method: 'POST',
        body: JSON.stringify({ candidateId: '1', action: 'bogus', clientProfileId: '1' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('approve sets review_status=approved and does NOT touch feedback/suppression', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '1', org_id: '10', review_status: 'approved' }],
    });

    const res = await POST(
      new Request('http://localhost/api/review', {
        method: 'POST',
        body: JSON.stringify({ candidateId: '1', action: 'approve', clientProfileId: '1' }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.candidate.review_status).toBe('approved');
    // The approve path must not call the suppression/feedback writer.
    expect(mockSuppress).not.toHaveBeenCalled();
    // The UPDATE wrote 'approved' into review_status.
    expect(mockQuery.mock.calls[0][1]).toContain('approved');
    expect(String(mockQuery.mock.calls[0][0])).toContain('cp.owner_id = $4');
    expect(String(mockQuery.mock.calls[0][0])).not.toContain('owner_id IS NULL');
  });

  it('reject sets review_status=rejected AND suppresses the org (badfit, 30d)', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '1', org_id: '10', review_status: 'rejected' }],
    });
    mockSuppress.mockResolvedValueOnce({
      clientProfileId: '1', orgId: '10', feedbackStatus: 'badfit',
      feedbackAt: '2026-07-06T00:00:00Z', feedbackNote: null,
      cooldownUntil: null, suppressedUntil: '2026-08-05T00:00:00Z',
      lastDigestCandidateId: '1', lastDigestRunId: null, updatedAt: '2026-07-06T00:00:00Z',
    } as never);

    const res = await POST(
      new Request('http://localhost/api/review', {
        method: 'POST',
        body: JSON.stringify({ candidateId: '1', action: 'reject', clientProfileId: '1' }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidate.review_status).toBe('rejected');
    // Reject MUST call the suppression writer with the badfit action so the
    // org does not reappear as a fresh lead in /leads.
    expect(mockSuppress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'badfit', orgId: '10', digestCandidateId: '1' }),
    );
  });

  it('reject still returns ok when suppression fails (review_status already persisted)', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '1', org_id: '10', review_status: 'rejected' }],
    });
    mockSuppress.mockRejectedValueOnce(new Error('boom'));

    const res = await POST(
      new Request('http://localhost/api/review', {
        method: 'POST',
        body: JSON.stringify({ candidateId: '1', action: 'reject', clientProfileId: '1' }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.warning).toMatch(/suppression failed/);
  });

  it('returns 404 when the candidate is not pending_review', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(
      new Request('http://localhost/api/review', {
        method: 'POST',
        body: JSON.stringify({ candidateId: '999', action: 'approve', clientProfileId: '1' }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
