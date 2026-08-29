/**
 * Tests for GET /api/review — the new `isForeignEmployer` field (Phase 4 T4.5).
 *
 * The route derives it from extractPayloadFields(row.payload) — no new SQL/JOIN.
 * The field is backward-compatible (new + optional; existing callers that ignore
 * it are unaffected). A foreign-employer candidate surfaces `isForeignEmployer:
 * true` so the review card can show the foreign reason chip instead of the
 * previously-hardcoded `isForeign={false}`.
 */
import { GET } from '@/app/api/review/route';
import { getPool } from '@/lib/db';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/digestFeedback', () => ({
  updateDigestOrgStateFeedback: jest.fn(),
  DIGEST_FEEDBACK_ACTIONS: ['accepted', 'badfit', 'dismissed', 'snooze', 'contacted', 'replied', 'meeting', 'won'],
  isDigestFeedbackAction: jest.fn(),
  DEFAULT_BADFIT_SUPPRESSION_DAYS: 30,
  buildDigestFeedbackActionPlan: jest.fn(),
}));
jest.mock('@/lib/auth-v2/authorization', () => ({
  getSession: jest.fn(async () => ({ dataOwnerId: 'owner-1', workspaceId: 'workspace-9' })),
}));
jest.mock('@/lib/entitlements', () => ({ hasFeatureAccess: jest.fn(async () => true) }));

const mockQuery = jest.fn();
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

describe('GET /api/review — isForeignEmployer field (T4.5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
  });

  it('surfaces isForeignEmployer=true when the payload carries the foreign flag', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: '77',
          org_id: '20',
          org_name: 'ForeignCo',
          score: 40,
          confidence_gate: 'B',
          vacancies_count: 2,
          distinct_vacancy_names_count: 2,
          latest_published_at: '2026-06-01T10:00:00Z',
          reasons: [],
          source_families: ['hh'],
          evidence_titles: ['Engineer'],
          location_names: ['Berlin'],
          created_at: '2026-06-02T12:00:00Z',
          payload: { isForeignEmployer: true, confidenceGate: 'B', evidence_titles: ['Engineer'], location_names: ['Berlin'] },
        }],
      });

    const res = await GET(new Request('http://localhost/api/review?clientProfileId=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].isForeignEmployer).toBe(true);
  });

  it('defaults isForeignEmployer=false when the payload has no foreign flag', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: '78',
          org_id: '21',
          org_name: 'DomesticCo',
          score: 40,
          confidence_gate: 'C',
          vacancies_count: 1,
          distinct_vacancy_names_count: 1,
          latest_published_at: null,
          reasons: [],
          source_families: ['career-pages'],
          evidence_titles: ['QA'],
          location_names: ['Москва'],
          created_at: '2026-06-02T12:00:00Z',
          payload: { confidenceGate: 'C', evidence_titles: ['QA'], location_names: ['Москва'] },
        }],
      });

    const res = await GET(new Request('http://localhost/api/review?clientProfileId=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].isForeignEmployer).toBe(false);
  });
});
