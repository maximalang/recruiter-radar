/**
 * Unit tests for buildWhyMatch (lib/leads/why-match.ts).
 *
 * Pure function: the 2–3 concrete filter criteria a lead satisfies for an
 * agency's profile, shown on the Telegram card. Asserts it states only true
 * matches, respects the limit, and orders strongest-signal-first.
 */

import { buildWhyMatch, type WhyMatchLead, type WhyMatchProfile } from '@/lib/leads/why-match';

function lead(overrides: Partial<WhyMatchLead> = {}): WhyMatchLead {
  return {
    orgName: 'Ромашка',
    evidenceTitles: ['Backend разработчик', 'DevOps инженер'],
    locationNames: ['Москва'],
    vacanciesCount: 4,
    score: 3.2,
    latestSignalAt: new Date().toISOString(),
    ...overrides,
  };
}

function profile(overrides: Partial<WhyMatchProfile> = {}): WhyMatchProfile {
  return {
    roles: [],
    industries: [],
    targetCity: null,
    minOpenRoles: null,
    hiringIntentMin: null,
    ...overrides,
  };
}

describe('buildWhyMatch', () => {
  it('returns empty when nothing concrete matches', () => {
    expect(buildWhyMatch(lead({ evidenceTitles: ['Бариста'], orgName: 'Кофейня' }), profile())).toEqual([]);
  });

  it('reports a role match from the hiring signal', () => {
    const lines = buildWhyMatch(lead(), profile({ roles: ['it-engineering'] }));
    expect(lines.some((l) => l.includes('по вашему профилю'))).toBe(true);
  });

  it('reports a region match when the target city appears in locations', () => {
    const lines = buildWhyMatch(lead({ locationNames: ['Москва'] }), profile({ targetCity: 'Москва' }));
    expect(lines).toContain('Регион: Москва');
  });

  it('reports open-role volume only when the min threshold is set and met', () => {
    expect(buildWhyMatch(lead({ vacanciesCount: 4 }), profile({ minOpenRoles: 3 }))).toContain('Открыто ролей: 4');
    expect(buildWhyMatch(lead({ vacanciesCount: 1 }), profile({ minOpenRoles: 3 })).some((l) => l.includes('Открыто ролей'))).toBe(false);
    expect(buildWhyMatch(lead({ vacanciesCount: 4 }), profile({ minOpenRoles: null })).some((l) => l.includes('Открыто ролей'))).toBe(false);
  });

  it('reports intent strength only when the floor is set and cleared', () => {
    expect(buildWhyMatch(lead({ score: 3.2 }), profile({ hiringIntentMin: 3.0 })).some((l) => l.includes('Сила сигнала'))).toBe(true);
    expect(buildWhyMatch(lead({ score: 1.0 }), profile({ hiringIntentMin: 3.0 })).some((l) => l.includes('Сила сигнала'))).toBe(false);
  });

  it('caps the number of lines to the limit, strongest first', () => {
    const lines = buildWhyMatch(
      lead({ evidenceTitles: ['Backend разработчик'], locationNames: ['Москва'], vacanciesCount: 5, score: 3.5 }),
      profile({ roles: ['it-engineering'], industries: ['it'], targetCity: 'Москва', minOpenRoles: 2, hiringIntentMin: 3 }),
      2,
    );
    expect(lines).toHaveLength(2);
    // Role is the strongest signal → first.
    expect(lines[0]).toContain('по вашему профилю');
  });
});
