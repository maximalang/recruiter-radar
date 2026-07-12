/**
 * Unit tests for computeProfileCompletion (lib/profileCompletion.ts).
 *
 * Pure function: maps a ClientProfile to the filled/total breakdown that drives
 * the completion progress bar + checklist on /profile.
 */

import { computeProfileCompletion } from '@/lib/profileCompletion';
import type { ClientProfile } from '@/lib/clientProfiles';

function profile(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return {
    id: '1',
    agencyName: 'Агентство',
    telegramChatId: null,
    targetCity: null,
    specialization: null,
    includeKeywords: [],
    excludeKeywords: [],
    industries: [],
    companySizes: [],
    dailyDigestLimit: 10,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contactPolicy: 'unrestricted',
    roles: [],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: false,
    hiringIntentMin: null,
    signalFreshnessDays: null,
    minOpenRoles: null,
    hiringMode: 'auto',
    ...overrides,
  };
}

describe('computeProfileCompletion', () => {
  it('reports an empty profile as only the hiringMode group filled', () => {
    // hiringMode defaults to 'auto' (a deliberate infer-from-roles choice),
    // so it counts as filled even on an otherwise-empty profile.
    const c = computeProfileCompletion(profile());
    expect(c.groups.find((g) => g.key === 'hiringMode')?.filled).toBe(true);
    expect(c.groups.find((g) => g.key === 'roles')?.filled).toBe(false);
    expect(c.isComplete).toBe(false);
    expect(c.groups).toHaveLength(c.totalCount);
  });

  it('counts each filled targeting group', () => {
    const c = computeProfileCompletion(
      profile({ roles: ['it-engineering'], industries: ['it'], targetCity: 'Москва' }),
    );
    // 3 explicit groups + hiringMode (always filled by default 'auto') = 4.
    expect(c.filledCount).toBe(4);
    expect(c.groups.find((g) => g.key === 'roles')?.filled).toBe(true);
    expect(c.groups.find((g) => g.key === 'companySizes')?.filled).toBe(false);
  });

  it('treats remoteFriendly as satisfying the region group', () => {
    const c = computeProfileCompletion(profile({ remoteFriendly: true }));
    expect(c.groups.find((g) => g.key === 'region')?.filled).toBe(true);
  });

  it('treats a set hiringIntentMin as satisfying the intent group', () => {
    const c = computeProfileCompletion(profile({ hiringIntentMin: 2.5 }));
    expect(c.groups.find((g) => g.key === 'intent')?.filled).toBe(true);
  });

  it('reports a fully-filled profile as complete (ratio 1)', () => {
    const c = computeProfileCompletion(
      profile({
        roles: ['it-engineering'],
        industries: ['it'],
        targetCity: 'Москва',
        companySizes: ['medium'],
        hiringIntentMin: 2.0,
      }),
    );
    expect(c.isComplete).toBe(true);
    expect(c.ratio).toBe(1);
    expect(c.filledCount).toBe(c.totalCount);
  });

  it('ignores whitespace-only targetCity', () => {
    const c = computeProfileCompletion(profile({ targetCity: '   ' }));
    expect(c.groups.find((g) => g.key === 'region')?.filled).toBe(false);
  });
});
