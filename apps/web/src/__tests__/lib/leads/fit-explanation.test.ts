/**
 * Focused unit tests for the deterministic fit-explanation builder.
 *
 * Contract under test (spec §2.A, §4, §5):
 *   - Every emitted line traces to a concrete input via `basis`.
 *   - No line is produced without a supporting scoring key or profile↔lead match.
 *   - Order is stable: industry → role → region → contact-policy → reachability → exclusions.
 *   - Empty evidence ⇒ isEmpty, no invented lines.
 */

import {
  buildFitExplanation,
  FIT_DIMENSION_ICON,
  type FitDimension,
  type FitLeadInput,
  type FitProfileInput,
} from '@/lib/leads/fit-explanation';
import type { ScoringReason } from '@/lib/scoring/scoring-reasons';

function reason(key: string, params?: Record<string, string | number>): ScoringReason {
  // component is irrelevant to the builder (it matches on key); pick a valid one.
  return { component: 'fit', key, params };
}

function lead(overrides: Partial<FitLeadInput> = {}): FitLeadInput {
  return {
    structuredReasons: [],
    locationNames: [],
    lawfulContactPath: null,
    sourceFamilies: [],
    careerPageUrl: null,
    orgDomain: null,
    ...overrides,
  };
}

function profile(overrides: Partial<FitProfileInput> = {}): FitProfileInput {
  return {
    industries: [],
    roles: [],
    excludedIndustries: [],
    excludedLocations: [],
    contactPolicy: 'unrestricted',
    remoteFriendly: false,
    targetCity: null,
    ...overrides,
  };
}

/** Guard used across every case: nothing is emitted without a basis. */
function everyLineHasBasis(fit: ReturnType<typeof buildFitExplanation>): void {
  for (const line of fit.lines) {
    expect(typeof line.basis).toBe('string');
    expect(line.basis.length).toBeGreaterThan(0);
    expect(FIT_DIMENSION_ICON[line.dimension]).toBeDefined();
  }
}

describe('buildFitExplanation', () => {
  it('emits an industry line on a direct industry match, with the industry name', () => {
    const fit = buildFitExplanation(
      lead({ structuredReasons: [reason('fit.industry.match', { industry: 'Финтех' })] }),
      profile({ industries: ['Финтех'] }),
    );
    const industry = fit.lines.find((l) => l.dimension === 'industry');
    expect(industry).toBeDefined();
    expect(industry!.basis).toBe('fit.industry.match');
    expect(industry!.text).toContain('Финтех');
    everyLineHasBasis(fit);
  });

  it('honors the reweighted industry-match key', () => {
    const fit = buildFitExplanation(
      lead({ structuredReasons: [reason('fit.industry.match.reweighted', { industry: 'Ритейл' })] }),
      profile(),
    );
    expect(fit.lines.some((l) => l.dimension === 'industry')).toBe(true);
    everyLineHasBasis(fit);
  });

  it('emits a role line from fit.role.match with the matched count', () => {
    const fit = buildFitExplanation(
      lead({ structuredReasons: [reason('fit.role.match', { count: 4 })] }),
      profile({ roles: ['Backend'] }),
    );
    const role = fit.lines.find((l) => l.dimension === 'role');
    expect(role).toBeDefined();
    expect(role!.basis).toBe('fit.role.match');
    expect(role!.text).toContain('4');
    everyLineHasBasis(fit);
  });

  it('emits a region line on a location match including the target city', () => {
    const fit = buildFitExplanation(
      lead({ structuredReasons: [reason('fit.location.match')] }),
      profile({ targetCity: 'Москва' }),
    );
    const region = fit.lines.find((l) => l.dimension === 'region');
    expect(region).toBeDefined();
    expect(region!.basis).toBe('fit.location.match');
    expect(region!.text).toContain('Москва');
  });

  it('emits a remote-friendly region line when there is a location but no explicit match', () => {
    const fit = buildFitExplanation(
      lead({ locationNames: ['Казань'] }),
      profile({ remoteFriendly: true }),
    );
    const region = fit.lines.find((l) => l.dimension === 'region');
    expect(region).toBeDefined();
    expect(region!.basis).toBe('profile.remoteFriendly');
  });

  it('does NOT claim region fit when not remote-friendly and no location match', () => {
    const fit = buildFitExplanation(
      lead({ locationNames: ['Казань'] }),
      profile({ remoteFriendly: false }),
    );
    expect(fit.lines.some((l) => l.dimension === 'region')).toBe(false);
  });

  it('asserts a contact-policy line for corporate_only when a lawful path exists', () => {
    const fit = buildFitExplanation(
      lead({ lawfulContactPath: 'Карьерная страница' }),
      profile({ contactPolicy: 'corporate_only' }),
    );
    const policy = fit.lines.find((l) => l.dimension === 'contact-policy');
    expect(policy).toBeDefined();
    expect(policy!.basis).toBe('contactPolicy.corporate_only');
  });

  it('makes NO contact-policy claim for unrestricted policy', () => {
    const fit = buildFitExplanation(
      lead({ lawfulContactPath: 'Карьерная страница' }),
      profile({ contactPolicy: 'unrestricted' }),
    );
    expect(fit.lines.some((l) => l.dimension === 'contact-policy')).toBe(false);
  });

  it('makes NO contact-policy claim when there is no lawful path', () => {
    const fit = buildFitExplanation(
      lead({ lawfulContactPath: null }),
      profile({ contactPolicy: 'corporate_only' }),
    );
    expect(fit.lines.some((l) => l.dimension === 'contact-policy')).toBe(false);
  });

  it('emits a reachability line from a career-page scoring key', () => {
    const fit = buildFitExplanation(
      lead({ structuredReasons: [reason('reachability.career-page')] }),
      profile(),
    );
    const reach = fit.lines.find((l) => l.dimension === 'reachability');
    expect(reach).toBeDefined();
    expect(reach!.basis).toBe('reachability.career-page');
  });

  it('claims exclusions-avoided ONLY when the agency has exclusions and none are hit', () => {
    const fit = buildFitExplanation(
      lead({ locationNames: ['Москва'] }),
      profile({ excludedIndustries: ['Гемблинг'], excludedLocations: ['Сочи'] }),
    );
    const excl = fit.lines.find((l) => l.dimension === 'exclusions');
    expect(excl).toBeDefined();
    expect(excl!.basis).toBe('profile.exclusions.cleared');
  });

  it('does NOT claim exclusions-avoided when the lead hits an excluded location', () => {
    const fit = buildFitExplanation(
      lead({ locationNames: ['Сочи'] }),
      profile({ excludedLocations: ['Сочи'] }),
    );
    expect(fit.lines.some((l) => l.dimension === 'exclusions')).toBe(false);
  });

  it('does NOT claim exclusions-avoided when the scorer flagged an excluded industry', () => {
    const fit = buildFitExplanation(
      lead({ structuredReasons: [reason('fit.industry.excluded', { industry: 'Гемблинг' })] }),
      profile({ excludedIndustries: ['Гемблинг'] }),
    );
    expect(fit.lines.some((l) => l.dimension === 'exclusions')).toBe(false);
  });

  it('does NOT emit a vacuous exclusions line when the agency has no exclusions', () => {
    const fit = buildFitExplanation(
      lead({ locationNames: ['Москва'] }),
      profile({ excludedIndustries: [], excludedLocations: [] }),
    );
    expect(fit.lines.some((l) => l.dimension === 'exclusions')).toBe(false);
  });

  it('returns isEmpty with no lines when there is no supporting evidence at all', () => {
    const fit = buildFitExplanation(lead(), profile());
    expect(fit.lines).toHaveLength(0);
    expect(fit.isEmpty).toBe(true);
  });

  it('keeps a stable dimension order across a rich lead', () => {
    const fit = buildFitExplanation(
      lead({
        structuredReasons: [
          reason('reachability.career-page'),
          reason('fit.location.match'),
          reason('fit.role.match', { count: 2 }),
          reason('fit.industry.match', { industry: 'Финтех' }),
        ],
        lawfulContactPath: 'Карьерная страница',
        locationNames: ['Москва'],
      }),
      profile({
        contactPolicy: 'corporate_only',
        excludedIndustries: ['Гемблинг'],
        targetCity: 'Москва',
      }),
    );

    const order: FitDimension[] = [
      'industry',
      'role',
      'region',
      'contact-policy',
      'reachability',
      'exclusions',
    ];
    const seen = fit.lines.map((l) => l.dimension);
    // The emitted dimensions must appear in canonical order (subset, but ordered).
    const positions = seen.map((d) => order.indexOf(d));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
    expect(fit.isEmpty).toBe(false);
    everyLineHasBasis(fit);
  });
});
