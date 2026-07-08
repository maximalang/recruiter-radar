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
    remoteFriendly: false,
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

  it('flags a region mismatch when the lead has a different location', () => {
    const lines = buildWhyMatch(
      lead({ locationNames: ['Новосибирск'] }),
      profile({ targetCity: 'Москва' }),
    );
    expect(lines.some((l) => l.includes('Регион не ваш'))).toBe(true);
  });

  it('does not flag a region mismatch for a remote-friendly agency', () => {
    const lines = buildWhyMatch(
      lead({ locationNames: ['Новосибирск'] }),
      profile({ targetCity: 'Москва', remoteFriendly: true }),
    );
    expect(lines.some((l) => l.includes('Регион не ваш'))).toBe(false);
  });

  it('does not assert a mismatch when the lead has no location data', () => {
    const lines = buildWhyMatch(
      lead({ locationNames: [] }),
      profile({ targetCity: 'Москва' }),
    );
    expect(lines.some((l) => l.includes('Регион'))).toBe(false);
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

// ─── Mode-aware why-match (2026-07-06) ─────────────────────────────────────

describe('buildWhyMatch mode-aware', () => {
  it('executive mode leads with a seniority line when a senior title is present', () => {
    const lines = buildWhyMatch(
      lead({ evidenceTitles: ['Финансовый директор', 'CFO'] }),
      profile({ roles: ['executive'], hiringMode: 'executive' }),
    );
    expect(lines[0]).toContain('руководителя');
    expect(lines[0]).toContain('executive');
  });

  it('executive mode does NOT invent a seniority line when no senior title is present', () => {
    const lines = buildWhyMatch(
      lead({ evidenceTitles: ['Бариста', 'Кассир'] }),
      profile({ roles: ['executive'], hiringMode: 'executive' }),
    );
    expect(lines.some((l) => l.includes('руководителя'))).toBe(false);
    expect(lines.some((l) => l.includes('executive'))).toBe(false);
  });

  it('volume mode surfaces a hiring-scale line for 3+ open roles', () => {
    const lines = buildWhyMatch(
      lead({ vacanciesCount: 12 }),
      profile({ hiringMode: 'volume' }),
    );
    expect(lines.some((l) => l.includes('Масштаб найма'))).toBe(true);
    expect(lines.some((l) => l.includes('12'))).toBe(true);
  });

  it('volume mode does NOT surface a hiring-scale line for fewer than 3 roles', () => {
    const lines = buildWhyMatch(
      lead({ vacanciesCount: 1 }),
      profile({ hiringMode: 'volume' }),
    );
    expect(lines.some((l) => l.includes('Масштаб найма'))).toBe(false);
  });

  it('specialist mode (default) keeps the pre-mode order — no seniority/scale line', () => {
    const lines = buildWhyMatch(
      lead({ evidenceTitles: ['Финансовый директор'], vacanciesCount: 12 }),
      profile({ hiringMode: 'specialist' }),
    );
    expect(lines.some((l) => l.includes('руководителя'))).toBe(false);
    expect(lines.some((l) => l.includes('Масштаб найма'))).toBe(false);
  });

  it('volume mode with an explicit minOpenRoles still surfaces the scale line (not the generic one)', () => {
    const lines = buildWhyMatch(
      lead({ vacanciesCount: 8 }),
      profile({ hiringMode: 'volume', minOpenRoles: 3 }),
    );
    expect(lines.some((l) => l.includes('Масштаб найма'))).toBe(true);
    expect(lines.some((l) => l === 'Открыто ролей: 8')).toBe(false);
  });
});
