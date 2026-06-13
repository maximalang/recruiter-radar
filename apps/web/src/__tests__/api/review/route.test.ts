/**
 * Tests for GET /api/review — pending review candidates list.
 *
 * Verifies that reasons are properly formatted as Russian strings
 * regardless of storage format (legacy string[] or new ScoringReason[]).
 */

import { GET } from '@/app/api/review/route';
import { getPool } from '@/lib/db';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

const mockQuery = jest.fn();
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

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
