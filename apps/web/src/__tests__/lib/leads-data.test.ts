/**
 * Tests for lead detail data fetching.
 *
 * Verifies that getLeadDetail returns full lead data including
 * evidence, reasons, opener, feedback state, and org info.
 */

import { getLastRadarRunAt, getLeadDetail } from '@/lib/leads-data';
import { getPool } from '@/lib/db';

// Mock the DB pool
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

const mockQuery = jest.fn();
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

function makeMockPool() {
  mockGetPool.mockReturnValue({
    query: mockQuery,
  } as never);
}

describe('getLeadDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when the database is not available instead of returning a false not-found result', async () => {
    mockGetPool.mockReturnValue(null);
    await expect(getLeadDetail({ candidateId: '1', ownerId: 'owner-1' })).rejects.toThrow(
      'DATABASE_URL is not set.',
    );
  });

  it('returns null when candidate not found', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getLeadDetail({ candidateId: '999', ownerId: 'owner-1' });
    expect(result).toBeNull();
  });

  it('returns full lead detail for a found candidate', async () => {
    makeMockPool();

    const candidateRow = {
      id: '42',
      client_profile_id: '5',
      org_id: '10',
      org_name: 'Яндекс',
      org_website: 'https://yandex.ru',
      source_external_id: 'hh-12345',
      score: 45,
      vacancies_count: 5,
      distinct_vacancy_names_count: 3,
      latest_published_at: '2026-06-01T10:00:00Z',
      reasons: [
        { component: 'intent' as const, key: 'intent.fresh-signals' },
        { component: 'intent' as const, key: 'intent.multiple-roles', params: { count: 3 } },
      ],
      opener: 'Здравствуйте! По Яндекс видно...',
      feedback_status: 'contacted',
      feedback_note: null,
      suppressed_until: null,
      cooldown_until: null,
      created_at: '2026-06-02T12:00:00Z',
      source_families: ['hh'],
      candidate_source_keys: ['yandex'],
      // confidence gate + evidence titles + location names live in payload JSON,
      // NOT as real columns (no migration ever created them).
      payload: {
        rank: 1,
        source_families: ['hh'],
        confidence_gate: 'A',
        evidence_titles: ['Backend Developer', 'Frontend Engineer', 'Data Analyst'],
        location_names: ['Москва'],
      },
    };

    mockQuery.mockResolvedValueOnce({ rows: [candidateRow] });

    const result = await getLeadDetail({ candidateId: '42', ownerId: 'owner-1' });

    const detailQuery = String(mockQuery.mock.calls[0]?.[0] ?? '');
    expect(detailQuery).not.toContain('dc.candidate_source_keys');
    expect(detailQuery).toContain("dc.payload->'candidate_source_keys'");

    expect(result).not.toBeNull();
    expect(result!.id).toBe('42');
    expect(result!.clientProfileId).toBe('5');
    expect(result!.orgId).toBe('10');
    expect(result!.orgName).toBe('Яндекс');
    expect(result!.orgWebsite).toBe('https://yandex.ru');
    expect(result!.score).toBe(45);
    // Read from payload.confidence_gate
    expect(result!.confidenceGate).toBe('A');
    expect(result!.vacanciesCount).toBe(5);
    expect(result!.reasons).toEqual(['Свежие сигналы найма (недели давности)', 'Несколько открытых ролей (3) — активный найм']);
    expect(result!.opener).toBe('Здравствуйте! По Яндекс видно...');
    expect(result!.feedbackStatus).toBe('contacted');
    // Read from payload.evidence_titles / payload.location_names
    expect(result!.evidenceTitles).toEqual(['Backend Developer', 'Frontend Engineer', 'Data Analyst']);
    expect(result!.locationNames).toEqual(['Москва']);
    expect(result!.orgWebsite).toBe('https://yandex.ru');
    expect(result!.feedbackNote).toBeNull();
    expect(result!.candidateSourceKeys).toEqual(['yandex']);
  });

  it('reads confidence gate / evidence / locations from a camelCase payload too', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: '7',
        client_profile_id: '3',
        org_id: '9',
        org_name: 'КамелКейс',
        org_website: null,
        source_external_id: null,
        score: 30,
        vacancies_count: 2,
        distinct_vacancy_names_count: 2,
        latest_published_at: null,
        reasons: [],
        opener: '',
        feedback_status: 'none',
        feedback_note: null,
        suppressed_until: null,
        cooldown_until: null,
        created_at: '2026-06-01T00:00:00Z',
        source_families: ['career-pages'],
        candidate_source_keys: [],
        payload: {
          confidenceGate: 'B',
          evidenceTitles: ['QA инженер'],
          locationNames: ['Санкт-Петербург'],
        },
      }],
    });

    const result = await getLeadDetail({ candidateId: '7', ownerId: 'owner-1' });
    expect(result!.confidenceGate).toBe('B');
    expect(result!.evidenceTitles).toEqual(['QA инженер']);
    expect(result!.locationNames).toEqual(['Санкт-Петербург']);
  });

  it('degrades gracefully when payload lacks gate/evidence/location keys (no 500)', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: '8',
        client_profile_id: '3',
        org_id: '9',
        org_name: 'Тонкий пейлоад',
        org_website: null,
        source_external_id: null,
        score: 12,
        vacancies_count: 0,
        distinct_vacancy_names_count: 0,
        latest_published_at: null,
        reasons: [],
        opener: '',
        feedback_status: 'none',
        feedback_note: null,
        suppressed_until: null,
        cooldown_until: null,
        created_at: '2026-06-01T00:00:00Z',
        source_families: [],
        candidate_source_keys: [],
        // Mirrors real prod rows that only carry {rank, confidence_gate, source_families}
        // — here even thinner, with none of the three fields.
        payload: { rank: 5 },
      }],
    });

    const result = await getLeadDetail({ candidateId: '8', ownerId: 'owner-1' });
    expect(result).not.toBeNull();
    expect(result!.confidenceGate).toBe('');
    expect(result!.evidenceTitles).toEqual([]);
    expect(result!.locationNames).toEqual([]);
  });

  it('handles null org_website gracefully', async () => {
    makeMockPool();

    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: '1',
        client_profile_id: '3',
        org_id: '5',
        org_name: 'Тест',
        org_website: null,
        source_external_id: null,
        score: 20,
        vacancies_count: 1,
        distinct_vacancy_names_count: 1,
        latest_published_at: null,
        reasons: ['Вакансия'],
        opener: 'Здравствуйте!',
        feedback_status: 'none',
        feedback_note: null,
        suppressed_until: null,
        cooldown_until: null,
        created_at: '2026-06-01T00:00:00Z',
        source_families: ['hh'],
        candidate_source_keys: [],
        payload: { confidence_gate: 'B', evidence_titles: ['Engineer'], location_names: [] },
      }],
    });

    const result = await getLeadDetail({ candidateId: '1', ownerId: 'owner-1' });
    expect(result).not.toBeNull();
    expect(result!.orgWebsite).toBeNull();
  });
});

describe('getLastRadarRunAt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns no run without touching the database when there are no profiles', async () => {
    const result = await getLastRadarRunAt({ profileIds: [], ownerId: 'owner-1' });
    expect(result).toBeNull();
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  it('fails explicitly when run history cannot be read', async () => {
    mockGetPool.mockReturnValue(null);
    await expect(getLastRadarRunAt({ profileIds: ['7'], ownerId: 'owner-1' })).rejects.toThrow(
      'DATABASE_URL is not set.',
    );
  });

  it('owner-scopes the latest run query', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [{ lastRunAt: '2026-08-09T08:00:00.000Z' }] });

    await expect(getLastRadarRunAt({ profileIds: ['7', '8'], ownerId: 'owner-1' })).resolves.toBe(
      '2026-08-09T08:00:00.000Z',
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('profile.owner_id = $2'),
      [['7', '8'], 'owner-1'],
    );
  });
});
