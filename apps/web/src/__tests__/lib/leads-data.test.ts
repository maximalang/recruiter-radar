/**
 * Tests for lead detail data fetching.
 *
 * Verifies that getLeadDetail returns full lead data including
 * evidence, reasons, opener, feedback state, and org info.
 */

import { getLeadDetail } from '@/lib/leads-data';
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

  it('returns null when pool is not available', async () => {
    mockGetPool.mockReturnValue(null);
    const result = await getLeadDetail({ candidateId: '1', ownerId: 'owner-1' });
    expect(result).toBeNull();
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
      confidence_gate: 'A',
      vacancies_count: 5,
      distinct_vacancy_names_count: 3,
      latest_published_at: '2026-06-01T10:00:00Z',
      reasons: [
        { component: 'intent' as const, key: 'intent.fresh-signals' },
        { component: 'intent' as const, key: 'intent.multiple-roles', params: { count: 3 } },
      ],
      opener: 'Здравствуйте! По Яндекс видно...',
      feedback_status: 'accepted',
      feedback_note: null,
      suppressed_until: null,
      cooldown_until: null,
      created_at: '2026-06-02T12:00:00Z',
      source_families: ['hh'],
      evidence_titles: ['Backend Developer', 'Frontend Engineer', 'Data Analyst'],
      location_names: ['Москва'],
      candidate_source_keys: ['yandex'],
      payload: { rank: 1, source_families: ['hh'], confidence_gate: 'A' },
    };

    mockQuery.mockResolvedValueOnce({ rows: [candidateRow] });

    const result = await getLeadDetail({ candidateId: '42', ownerId: 'owner-1' });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('42');
    expect(result!.clientProfileId).toBe('5');
    expect(result!.orgId).toBe('10');
    expect(result!.orgName).toBe('Яндекс');
    expect(result!.orgWebsite).toBe('https://yandex.ru');
    expect(result!.score).toBe(45);
    expect(result!.confidenceGate).toBe('A');
    expect(result!.vacanciesCount).toBe(5);
    expect(result!.reasons).toEqual(['Свежие сигналы найма (недели давности)', 'Несколько открытых ролей (3) — активный найм']);
    expect(result!.opener).toBe('Здравствуйте! По Яндекс видно...');
    expect(result!.feedbackStatus).toBe('accepted');
    expect(result!.evidenceTitles).toEqual(['Backend Developer', 'Frontend Engineer', 'Data Analyst']);
    expect(result!.locationNames).toEqual(['Москва']);
    expect(result!.orgWebsite).toBe('https://yandex.ru');
    expect(result!.feedbackNote).toBeNull();
    expect(result!.candidateSourceKeys).toEqual(['yandex']);
    expect(result!.payload).toEqual({ rank: 1, source_families: ['hh'], confidence_gate: 'A' });
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
        confidence_gate: 'B',
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
        evidence_titles: ['Engineer'],
        location_names: [],
        candidate_source_keys: [],
        payload: {},
      }],
    });

    const result = await getLeadDetail({ candidateId: '1', ownerId: 'owner-1' });
    expect(result).not.toBeNull();
    expect(result!.orgWebsite).toBeNull();
  });
});
