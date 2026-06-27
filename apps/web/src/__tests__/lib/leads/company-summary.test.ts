/**
 * Focused unit tests for the deterministic company/hiring summary builder.
 *
 * Contract under test (spec §2.B, §4, §5):
 *   - Every sentence is gated on a concrete field; thin evidence ⇒ says LESS.
 *   - No hiring claim without vacancy evidence (anti-hallucination gate).
 *   - agencyRelevance only when there is a real signal AND strength isn't weak.
 *   - Strength classification follows gate + multi-source + roles.
 */

import {
  buildCompanySummary,
  type CompanySummaryInput,
} from '@/lib/leads/company-summary';

function input(overrides: Partial<CompanySummaryInput> = {}): CompanySummaryInput {
  return {
    orgName: 'ООО Пример',
    confidenceGate: 'A',
    vacanciesCount: 0,
    distinctVacancyNamesCount: 0,
    evidenceTitles: [],
    sourceFamilies: [],
    locationNames: [],
    latestPublishedAt: null,
    ...overrides,
  };
}

describe('buildCompanySummary', () => {
  it('builds an identity line from the first location', () => {
    const s = buildCompanySummary(input({ locationNames: ['Москва'] }));
    expect(s.identity).toContain('ООО Пример');
    expect(s.identity).toContain('Москва');
  });

  it('falls back to a source-attributed identity when no location is known', () => {
    const s = buildCompanySummary(input({ sourceFamilies: ['career-pages'] }));
    expect(s.identity).toContain('career-pages');
  });

  it('returns no identity when neither location nor source is known', () => {
    const s = buildCompanySummary(input());
    expect(s.identity).toBeNull();
  });

  it('makes NO hiring claim without vacancy evidence (isThin)', () => {
    const s = buildCompanySummary(
      input({ confidenceGate: 'A', sourceFamilies: ['career-pages', 'hh'], vacanciesCount: 0 }),
    );
    expect(s.hiringMotion).toBeNull();
    expect(s.isThin).toBe(true);
    // No hiring motion ⇒ no agency relevance either.
    expect(s.agencyRelevance).toBeNull();
  });

  it('describes broad hiring when there are 3+ distinct roles', () => {
    const s = buildCompanySummary(
      input({
        confidenceGate: 'A',
        sourceFamilies: ['career-pages', 'hh'],
        vacanciesCount: 7,
        distinctVacancyNamesCount: 4,
      }),
    );
    expect(s.hiringMotion).toContain('7');
    expect(s.hiringMotion).toContain('4');
    expect(s.isThin).toBe(false);
  });

  it('is honest about a likely repost: many postings, one role', () => {
    const s = buildCompanySummary(
      input({ confidenceGate: 'B', sourceFamilies: ['hh'], vacanciesCount: 5, distinctVacancyNamesCount: 1 }),
    );
    expect(s.hiringMotion).toContain('5');
    expect(s.hiringMotion).toContain('одной роли');
  });

  it('classifies strong: gate A/B + multi-source + roles', () => {
    const s = buildCompanySummary(
      input({
        confidenceGate: 'A',
        sourceFamilies: ['career-pages', 'hh'],
        vacanciesCount: 4,
        distinctVacancyNamesCount: 3,
      }),
    );
    expect(s.strength).toBe('strong');
    // Strong + hiring ⇒ multi-source relevance.
    expect(s.agencyRelevance).toContain('независимых источников');
  });

  it('classifies weak for gate D and withholds agency relevance', () => {
    const s = buildCompanySummary(
      input({
        confidenceGate: 'D',
        sourceFamilies: ['egrul-fns'],
        vacanciesCount: 2,
        distinctVacancyNamesCount: 1,
      }),
    );
    expect(s.strength).toBe('weak');
    // Even with a hiring motion, weak strength must NOT oversell relevance.
    expect(s.agencyRelevance).toBeNull();
  });

  it('classifies weak when there are no distinct roles regardless of gate', () => {
    const s = buildCompanySummary(
      input({
        confidenceGate: 'A',
        sourceFamilies: ['career-pages', 'hh'],
        vacanciesCount: 1,
        distinctVacancyNamesCount: 0,
      }),
    );
    expect(s.strength).toBe('weak');
  });

  it('classifies moderate: single source, gate B, with roles', () => {
    const s = buildCompanySummary(
      input({
        confidenceGate: 'B',
        sourceFamilies: ['hh'],
        vacanciesCount: 2,
        distinctVacancyNamesCount: 2,
      }),
    );
    expect(s.strength).toBe('moderate');
  });

  it('appends the latest publication date when present', () => {
    const s = buildCompanySummary(
      input({
        confidenceGate: 'A',
        sourceFamilies: ['career-pages', 'hh'],
        vacanciesCount: 4,
        distinctVacancyNamesCount: 3,
        latestPublishedAt: '2026-06-20T10:00:00.000Z',
      }),
    );
    expect(s.hiringMotion).toContain('последняя публикация');
  });

  it('ignores an invalid publication date without crashing', () => {
    const s = buildCompanySummary(
      input({
        confidenceGate: 'A',
        sourceFamilies: ['career-pages', 'hh'],
        vacanciesCount: 4,
        distinctVacancyNamesCount: 3,
        latestPublishedAt: 'not-a-date',
      }),
    );
    expect(s.hiringMotion).not.toBeNull();
    expect(s.hiringMotion).not.toContain('последняя публикация');
  });
});
