/**
 * Tests for the profile API routes:
 *   GET   /api/profile/preview      — match count + completion for the owner
 *   PATCH /api/profile/preferences  — owner-scoped delivery preference update
 */

import { GET as previewGET } from '@/app/api/profile/preview/route';
import { PATCH as preferencesPATCH } from '@/app/api/profile/preferences/route';
import { getClientProfileByOwnerId } from '@/lib/clientProfiles';
import { countMatchingCandidatesForProfile } from '@/lib/digest';
import {
  getDeliveryPreferencesByOwnerId,
  saveDeliveryPreferencesByOwnerId,
} from '@/lib/deliveryPreferences';
import { getOwnerIdFromSession } from '@/lib/session';

jest.mock('@/lib/session', () => ({ getOwnerIdFromSession: jest.fn() }));
jest.mock('@/lib/clientProfiles', () => ({ getClientProfileByOwnerId: jest.fn() }));
jest.mock('@/lib/digest', () => ({ countMatchingCandidatesForProfile: jest.fn() }));
jest.mock('@/lib/deliveryPreferences', () => ({
  getDeliveryPreferencesByOwnerId: jest.fn(),
  saveDeliveryPreferencesByOwnerId: jest.fn(),
}));

const mockOwner = getOwnerIdFromSession as jest.MockedFunction<typeof getOwnerIdFromSession>;
const mockProfile = getClientProfileByOwnerId as jest.MockedFunction<typeof getClientProfileByOwnerId>;
const mockCount = countMatchingCandidatesForProfile as jest.MockedFunction<typeof countMatchingCandidatesForProfile>;
const mockGetPrefs = getDeliveryPreferencesByOwnerId as jest.MockedFunction<typeof getDeliveryPreferencesByOwnerId>;
const mockSavePrefs = saveDeliveryPreferencesByOwnerId as jest.MockedFunction<typeof saveDeliveryPreferencesByOwnerId>;

function makeProfile() {
  return {
    id: 'p1',
    agencyName: 'Агентство',
    telegramChatId: null,
    targetCity: 'Москва',
    specialization: null,
    includeKeywords: [],
    excludeKeywords: [],
    industries: ['it'],
    companySizes: [],
    dailyDigestLimit: 5,
    isActive: true,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    contactPolicy: 'corporate_only' as const,
    roles: ['it-engineering'],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: true,
    hiringIntentMin: 2,
    signalFreshnessDays: null,
    minOpenRoles: null,
  };
}

describe('GET /api/profile/preview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns hasProfile:false without a session', async () => {
    mockOwner.mockResolvedValue(null);
    const res = await previewGET();
    const body = await res.json();
    expect(body.hasProfile).toBe(false);
    expect(body.matchCount).toBeNull();
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it('returns hasProfile:false when the owner has no profile', async () => {
    mockOwner.mockResolvedValue('owner-1');
    mockProfile.mockResolvedValue(null);
    const res = await previewGET();
    const body = await res.json();
    expect(body.hasProfile).toBe(false);
  });

  it('returns the match count and completion for the owner profile', async () => {
    mockOwner.mockResolvedValue('owner-1');
    mockProfile.mockResolvedValue(makeProfile());
    mockCount.mockResolvedValue({ count: 12, capped: false });

    const res = await previewGET();
    const body = await res.json();
    expect(body.hasProfile).toBe(true);
    expect(body.matchCount).toEqual({ count: 12, capped: false });
    expect(body.completion.totalCount).toBeGreaterThan(0);
    expect(mockProfile).toHaveBeenCalledWith('owner-1');
  });

  it('degrades matchCount to null when counting throws', async () => {
    mockOwner.mockResolvedValue('owner-1');
    mockProfile.mockResolvedValue(makeProfile());
    mockCount.mockRejectedValue(new Error('db down'));

    const res = await previewGET();
    const body = await res.json();
    expect(body.hasProfile).toBe(true);
    expect(body.matchCount).toBeNull();
  });
});

function patchReq(body: unknown) {
  return preferencesPATCH(
    new Request('http://localhost/api/profile/preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as never,
  );
}

describe('PATCH /api/profile/preferences', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401s without a session', async () => {
    mockOwner.mockResolvedValue(null);
    const res = await patchReq({ webPushEnabled: true });
    expect(res.status).toBe(401);
    expect(mockSavePrefs).not.toHaveBeenCalled();
  });

  it('400s on a bad field type', async () => {
    mockOwner.mockResolvedValue('owner-1');
    const res = await patchReq({ webPushEnabled: 'yes' });
    expect(res.status).toBe(400);
    expect(mockSavePrefs).not.toHaveBeenCalled();
  });

  it('404s when the owner has no preferences row', async () => {
    mockOwner.mockResolvedValue('owner-1');
    mockGetPrefs.mockResolvedValue(null);
    const res = await patchReq({ webPushEnabled: true });
    expect(res.status).toBe(404);
  });

  it('merges omitted fields and saves scoped to the owner', async () => {
    mockOwner.mockResolvedValue('owner-1');
    mockGetPrefs.mockResolvedValue({
      webPushEnabled: false,
      emailDigestEnabled: true,
      digestEmail: 'a@b.co',
    });
    mockSavePrefs.mockResolvedValue({
      ok: true,
      preferences: { webPushEnabled: true, emailDigestEnabled: true, digestEmail: 'a@b.co' },
    });

    const res = await patchReq({ webPushEnabled: true });
    expect(res.status).toBe(200);
    // Omitted fields keep current values; write is scoped to session owner.
    expect(mockSavePrefs).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      webPushEnabled: true,
      emailDigestEnabled: true,
      digestEmail: 'a@b.co',
    });
  });

  it('surfaces a save validation failure as 400', async () => {
    mockOwner.mockResolvedValue('owner-1');
    mockGetPrefs.mockResolvedValue({
      webPushEnabled: false,
      emailDigestEnabled: false,
      digestEmail: null,
    });
    mockSavePrefs.mockResolvedValue({ ok: false, reason: 'email_required' });

    const res = await patchReq({ emailDigestEnabled: true });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('email_required');
  });
});
