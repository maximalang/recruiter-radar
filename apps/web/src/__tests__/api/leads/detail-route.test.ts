/**
 * Tests for GET /api/leads/:id — owner-scoped lead detail.
 *
 * Covers: 404 without session, 404 for a lead the owner cannot see, and the
 * deterministic/AI separation in the response shape.
 */

import { GET } from '@/app/api/leads/[id]/route';
import { getLeadDetail, type LeadDetail } from '@/lib/leads-data';
import { getClientProfileById } from '@/lib/clientProfiles';
import { getOwnerIdFromSession } from '@/lib/session';

jest.mock('@/lib/session', () => ({
  getOwnerIdFromSession: jest.fn(),
}));
jest.mock('@/lib/clientProfiles', () => ({
  getClientProfileById: jest.fn(),
}));
jest.mock('@/lib/leads-data', () => ({
  getLeadDetail: jest.fn(),
  formatLawfulContactPath: (v: string | null) => v,
}));

const mockOwner = getOwnerIdFromSession as jest.MockedFunction<typeof getOwnerIdFromSession>;
const mockDetail = getLeadDetail as jest.MockedFunction<typeof getLeadDetail>;
const mockProfile = getClientProfileById as jest.MockedFunction<typeof getClientProfileById>;

function makeDetail(overrides: Partial<LeadDetail> = {}): LeadDetail {
  return {
    id: 'lead-1',
    orgId: 'org-1',
    clientProfileId: 'p1',
    orgName: 'Ромашка',
    sourceExternalId: 'secret',
    score: 340,
    confidenceGate: 'A',
    vacanciesCount: 4,
    distinctVacancyNamesCount: 3,
    latestPublishedAt: '2026-06-28T00:00:00Z',
    reasons: [],
    structuredReasons: [],
    whyNow: 'Активный найm',
    lawfulContactPath: 'Карьерная страница',
    negativeSignals: [],
    opener: 'СЕКРЕТ',
    feedbackStatus: null,
    suppressedUntil: null,
    createdAt: '2026-06-29T00:00:00Z',
    sourceFamilies: ['career-pages'],
    evidenceTitles: ['Backend'],
    locationNames: ['Москва'],
    hasAiHint: true,
    orgWebsite: 'https://romashka.ru',
    orgInn: '7700000000',
    orgOgrn: null,
    orgDomain: 'romashka.ru',
    careerPageUrl: 'https://romashka.ru/careers',
    feedbackNote: null,
    cooldownUntil: null,
    candidateSourceKeys: ['secret-key'],
    payload: { secret: true },
    aiEnrichment: {
      schemaVersion: 1,
      detectedRoles: [{ title: 'SRE', department: null, confidence: 'medium' }],
      hiringUrgency: 'high',
      departments: [],
      locations: [],
      hiringPatternSummary: 'Строят SRE-команду',
      confidence: 'medium',
      provider: 'scrapegraph',
      sourceUrl: 'https://romashka.ru/careers',
      enrichedAt: '2026-06-30T00:00:00Z',
    } as never,
    ...overrides,
  };
}

function call(id = 'lead-1') {
  return GET(new Request(`http://localhost/api/leads/${id}`) as never, {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/leads/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404s without a session (never leaks existence)', async () => {
    mockOwner.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockDetail).not.toHaveBeenCalled();
  });

  it('404s when the owner-scoped lookup returns null', async () => {
    mockOwner.mockResolvedValue('owner-1');
    mockDetail.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockDetail).toHaveBeenCalledWith({ candidateId: 'lead-1', ownerId: 'owner-1' });
  });

  it('separates deterministic evidence from the AI layer and hides raw fields', async () => {
    mockOwner.mockResolvedValue('owner-1');
    mockDetail.mockResolvedValue(makeDetail());
    mockProfile.mockResolvedValue(null);

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Deterministic evidence block
    expect(body.evidence.titles).toEqual(['Backend']);
    expect(body.evidence.vacanciesCount).toBe(4);
    expect(body.signalStrength).toBe('3.4');

    // AI layer present and attributed, kept separate from evidence
    expect(body.aiEnrichment.hiringPatternSummary).toBe('Строят SRE-команду');
    expect(body.evidence.aiEnrichment).toBeUndefined();

    // Raw internal fields must NOT leak
    expect(body.opener).toBeUndefined();
    expect(body.payload).toBeUndefined();
    expect(body.candidateSourceKeys).toBeUndefined();
    expect(body.sourceExternalId).toBeUndefined();
  });

  it('returns aiEnrichment: null when none was persisted', async () => {
    mockOwner.mockResolvedValue('owner-1');
    mockDetail.mockResolvedValue(makeDetail({ aiEnrichment: null }));
    mockProfile.mockResolvedValue(null);

    const res = await call();
    const body = await res.json();
    expect(body.aiEnrichment).toBeNull();
  });
});
