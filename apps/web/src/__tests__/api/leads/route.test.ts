/**
 * Tests for GET /api/leads — owner-scoped, paginated public lead list.
 *
 * Covers: no-session empty state, owner-scope pass-through, the clean public
 * projection (no raw internal fields leak), pagination params, and whyMatch.
 */

import { GET } from '@/app/api/leads/route';
import { getSession } from '@/lib/auth-v2/authorization';
import { getLeadsForAllProfiles, type LeadItem } from '@/lib/leads-data';
import { listClientProfiles } from '@/lib/clientProfiles';
import { hasFeatureAccess } from '@/lib/entitlements';

jest.mock('@/lib/auth-v2/authorization', () => ({
  getSession: jest.fn(),
}));
jest.mock('@/lib/clientProfiles', () => ({
  listClientProfiles: jest.fn(),
  // habr-keywords.ts runs a top-level guard over VALID_ROLES on import
  // (route → why-match → habr-keywords), so the mock must preserve it.
  VALID_ROLES: new Set([
    'it-engineering', 'data', 'product', 'sales', 'marketing',
    'hr', 'finance', 'operations', 'legal', 'executive', 'other',
  ]),
}));
jest.mock('@/lib/leads-data', () => ({
  getLeadsForAllProfiles: jest.fn(),
  VALID_FEEDBACK_STATUSES: new Set(['none', 'contacted', 'replied', 'won', 'badfit', 'snooze', 'dismissed']),
}));
jest.mock('@/lib/entitlements', () => ({ hasFeatureAccess: jest.fn() }));

const mockOwner = getSession as jest.MockedFunction<typeof getSession>;
const mockList = listClientProfiles as jest.MockedFunction<typeof listClientProfiles>;
const mockLeads = getLeadsForAllProfiles as jest.MockedFunction<typeof getLeadsForAllProfiles>;
const mockFeatureAccess = hasFeatureAccess as jest.MockedFunction<typeof hasFeatureAccess>;

function makeProfile(id: string) {
  return {
    id,
    agencyName: 'Агентство',
    telegramChatId: null,
    targetCity: 'Москва',
    specialization: null,
    includeKeywords: [],
    excludeKeywords: [],
    industries: [],
    companySizes: [],
    dailyDigestLimit: 5,
    isActive: true,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    contactPolicy: 'corporate_only' as const,
    roles: [],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: false,
    hiringIntentMin: null,
    signalFreshnessDays: null,
    minOpenRoles: 1,
    hiringMode: 'auto' as const,
  };
}

function makeLead(overrides: Partial<LeadItem> = {}): LeadItem {
  return {
    id: 'lead-1',
    orgId: 'org-1',
    clientProfileId: 'p1',
    orgName: 'Ромашка',
    sourceExternalId: 'secret-external-id',
    score: 320,
    confidenceGate: 'A',
    vacanciesCount: 3,
    distinctVacancyNamesCount: 2,
    latestPublishedAt: '2026-06-28T00:00:00Z',
    reasons: [],
    structuredReasons: [],
    whyNow: 'Открыли 3 вакансии',
    lawfulContactPath: 'Карьерная страница',
    negativeSignals: [],
    opener: 'СЕКРЕТНЫЙ черновик письма',
    feedbackStatus: null,
    suppressedUntil: null,
    createdAt: '2026-06-29T00:00:00Z',
    sourceFamilies: ['career-pages'],
    evidenceTitles: ['Backend', 'DevOps'],
    locationNames: ['Москва'],
    hasAiHint: true,
    isForeignEmployer: false,
    foreignMatchedDomain: null,
    contactPaths: [],
    reviewStatus: 'auto_approved',
    ...overrides,
  };
}

function req(qs = '') {
  return GET(new Request(`http://localhost/api/leads${qs}`) as never);
}

function sessionFor(dataOwnerId: string) {
  return { dataOwnerId, workspaceId: 'workspace-9' } as never;
}

describe('GET /api/leads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatureAccess.mockResolvedValue(true);
  });

  it('returns an empty list without a session (no leak, no 401)', async () => {
    mockOwner.mockResolvedValue(null);
    const res = await req();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leads).toEqual([]);
    expect(body.total).toBe(0);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('denies a signed-in workspace without API entitlement before reading profiles', async () => {
    mockOwner.mockResolvedValue(sessionFor('owner-42'));
    mockFeatureAccess.mockResolvedValue(false);
    const res = await req();
    expect(res.status).toBe(403);
    expect(mockFeatureAccess).toHaveBeenCalledWith('owner-42', 'api', { workspaceId: 'workspace-9' });
    expect(mockList).not.toHaveBeenCalled();
  });

  it('reports an unavailable entitlement check without returning a false empty list', async () => {
    mockOwner.mockResolvedValue(sessionFor('owner-42'));
    mockFeatureAccess.mockRejectedValue(new Error('database unavailable'));
    const res = await req();
    expect(res.status).toBe(503);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('scopes the read to the session owner', async () => {
    mockOwner.mockResolvedValue(sessionFor('owner-42'));
    mockList.mockResolvedValue([makeProfile('p1')]);
    mockLeads.mockResolvedValue({ leads: [makeLead()], total: 1 });

    await req();

    expect(mockList).toHaveBeenCalledWith('owner-42');
    expect(mockLeads).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-42', profileIds: ['p1'] }),
    );
  });

  it('returns a clean projection without raw internal fields', async () => {
    mockOwner.mockResolvedValue(sessionFor('owner-42'));
    mockList.mockResolvedValue([makeProfile('p1')]);
    mockLeads.mockResolvedValue({ leads: [makeLead()], total: 1 });

    const res = await req();
    const body = await res.json();
    const lead = body.leads[0];

    // Present, clean fields
    expect(lead.orgName).toBe('Ромашка');
    expect(lead.scoreBand.label).toBeDefined();
    expect(lead.signalStrength).toBe('3.2');
    expect(lead.hasAiHint).toBe(true);
    expect(lead.topEvidence).toEqual(['Backend', 'DevOps']);

    // Raw internal fields must NOT leak.
    expect(lead.opener).toBeUndefined();
    expect(lead.sourceExternalId).toBeUndefined();
    expect(lead.structuredReasons).toBeUndefined();
    expect(lead.reasons).toBeUndefined();
    expect(lead.suppressedUntil).toBeUndefined();
  });

  it('computes whyMatch from the owning profile filters', async () => {
    mockOwner.mockResolvedValue(sessionFor('owner-42'));
    mockList.mockResolvedValue([makeProfile('p1')]);
    mockLeads.mockResolvedValue({ leads: [makeLead()], total: 1 });

    const res = await req();
    const body = await res.json();
    // Region (Москва) + open roles (3 >= 1) both match.
    expect(body.leads[0].whyMatch).toEqual(
      expect.arrayContaining(['Регион: Москва']),
    );
  });

  it('clamps pageSize and passes limit/offset', async () => {
    mockOwner.mockResolvedValue(sessionFor('owner-42'));
    mockList.mockResolvedValue([makeProfile('p1')]);
    mockLeads.mockResolvedValue({ leads: [], total: 0 });

    await req('?page=3&pageSize=999');

    expect(mockLeads).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 200 }),
    );
  });

  it('ignores a ?profile= that the owner does not own', async () => {
    mockOwner.mockResolvedValue(sessionFor('owner-42'));
    mockList.mockResolvedValue([makeProfile('p1')]);
    mockLeads.mockResolvedValue({ leads: [], total: 0 });

    await req('?profile=not-mine');

    // Falls back to all active owned profiles, never the foreign id.
    expect(mockLeads).toHaveBeenCalledWith(
      expect.objectContaining({ profileIds: ['p1'] }),
    );
  });
});
