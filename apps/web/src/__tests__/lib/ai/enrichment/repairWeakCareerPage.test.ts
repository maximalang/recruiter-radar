/**
 * Behavioral tests for the weak-career-page enrichment repair step (spec §3).
 *
 * The product-critical contract here:
 *   - WEAK source evidence  → the enrichment provider IS invoked.
 *   - STRONG source evidence → the provider is NOT touched (deterministic lead
 *     left alone; AI cannot dilute a clean lead).
 *   - No URL → not an enrichment candidate (nothing to read).
 *   - The step always returns a SEPARATE enrichment result and never mutates the
 *     deterministic inputs.
 */

import {
  isWeakCareerPage,
  repairWeakCareerPage,
  assertEnrichmentDoesNotTouchEvidence,
  WEAK_CAREER_PAGE_QUALITY_THRESHOLD,
  type WeakCareerPageCandidate,
} from '@/lib/ai/enrichment/repairWeakCareerPage';
import { AiBoundaryViolation } from '@/lib/ai/boundary';
import type { ScrapeProvider, ScrapeMarkdownResult } from '@/lib/ai/providers/scrapegraph';
import type { EnrichedHiringSignals } from '@/lib/ai/enrichment/careerPages';
import type { AssistResult } from '@/lib/ai/assist-types';

// ─── Fakes ───────────────────────────────────────────────────────────────────

/** A provider that records its calls and returns canned, available results. */
function makeRecordingProvider(): {
  provider: ScrapeProvider;
  calls: { scrape: string[]; extract: { sourceUrl: string; content: string; instruction: string }[] };
} {
  const calls = { scrape: [] as string[], extract: [] as { sourceUrl: string; content: string; instruction: string }[] };

  const enriched: EnrichedHiringSignals = {
    detectedRoles: [{ title: 'Backend', department: 'Eng', confidence: 'medium' }],
    hiringUrgency: 'medium',
    departments: ['Eng'],
    locations: ['Москва'],
    hiringPatternSummary: 'Найм в инженерную команду.',
    confidence: 'medium',
    sourceUrl: 'https://weak.test/careers',
    provider: 'scrapegraph',
  };

  const provider: ScrapeProvider = {
    name: 'scrapegraph',
    async scrapeToMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      calls.scrape.push(url);
      return {
        available: true,
        capability: 'extract-weak-signal',
        provider: 'scrapegraph',
        confidence: 'medium',
        data: { markdown: '# Careers', fetchedUrl: url },
      };
    },
    async extractStructuredData(input): Promise<AssistResult<EnrichedHiringSignals>> {
      calls.extract.push(input);
      return {
        available: true,
        capability: 'extract-weak-signal',
        provider: 'scrapegraph',
        confidence: 'medium',
        data: enriched,
      };
    },
  };

  return { provider, calls };
}

// ─── Candidates ──────────────────────────────────────────────────────────────

/** Weak: a bare URL with no vacancies, no contact, no freshness → quality ~0.1. */
function weakCandidate(overrides: Partial<WeakCareerPageCandidate> = {}): WeakCareerPageCandidate {
  return {
    orgId: 'org-1',
    careerPageUrl: 'https://weak.test/careers',
    qualityInput: { url: 'https://weak.test/careers', vacancyCount: 0 },
    knownRoleTitles: [],
    confidenceGate: 'C',
    ...overrides,
  };
}

/** Strong: rich page — vacancies + HR contact + fresh → quality well above 0.4. */
function strongCandidate(overrides: Partial<WeakCareerPageCandidate> = {}): WeakCareerPageCandidate {
  return {
    orgId: 'org-2',
    careerPageUrl: 'https://strong.test/careers',
    qualityInput: {
      url: 'https://strong.test/careers',
      vacancyCount: 5,
      contactPaths: [{ category: 'hr-email', value: 'hr@strong.test', confidence: 'high' }],
      lastModifiedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    },
    knownRoleTitles: ['Backend', 'QA'],
    confidenceGate: 'A',
    ...overrides,
  };
}

// ─── isWeakCareerPage ──────────────────────────────────────────────────────

describe('isWeakCareerPage', () => {
  it('flags a thin career page as weak', () => {
    expect(isWeakCareerPage(weakCandidate())).toBe(true);
  });

  it('does NOT flag a rich career page as weak', () => {
    expect(isWeakCareerPage(strongCandidate())).toBe(false);
  });

  it('is not a candidate when there is no career-page URL', () => {
    expect(isWeakCareerPage(weakCandidate({ careerPageUrl: null }))).toBe(false);
  });

  it('uses the documented threshold boundary', () => {
    expect(WEAK_CAREER_PAGE_QUALITY_THRESHOLD).toBeGreaterThan(0);
    expect(WEAK_CAREER_PAGE_QUALITY_THRESHOLD).toBeLessThan(1);
  });
});

// ─── repairWeakCareerPage — weak path ──────────────────────────────────────

describe('repairWeakCareerPage — weak source → enrichment attempted', () => {
  it('invokes the provider and returns its enriched result', async () => {
    const { provider, calls } = makeRecordingProvider();
    const result = await repairWeakCareerPage(weakCandidate(), provider);

    expect(calls.extract).toHaveLength(1);
    expect(result.available).toBe(true);
    expect(result.data?.detectedRoles[0].title).toBe('Backend');
    expect(result.provider).toBe('scrapegraph');
  });

  it('passes the centralized extraction instruction through to the provider', async () => {
    const { provider, calls } = makeRecordingProvider();
    await repairWeakCareerPage(weakCandidate(), provider);
    expect(calls.extract[0].instruction.toLowerCase()).toContain('do not invent');
  });

  it('reuses caller-supplied markdown instead of re-scraping', async () => {
    const { provider, calls } = makeRecordingProvider();
    await repairWeakCareerPage(weakCandidate({ markdown: '# Pre-fetched' }), provider);
    expect(calls.scrape).toHaveLength(0); // no re-scrape
    expect(calls.extract[0].content).toBe('# Pre-fetched');
  });

  it('scrapes for content when none is supplied', async () => {
    const { provider, calls } = makeRecordingProvider();
    await repairWeakCareerPage(weakCandidate(), provider);
    expect(calls.scrape).toEqual(['https://weak.test/careers']);
  });
});

// ─── repairWeakCareerPage — strong path ────────────────────────────────────

describe('repairWeakCareerPage — strong source → enrichment skipped', () => {
  it('never touches the provider for a strong lead', async () => {
    const { provider, calls } = makeRecordingProvider();
    const result = await repairWeakCareerPage(strongCandidate(), provider);

    expect(calls.scrape).toHaveLength(0);
    expect(calls.extract).toHaveLength(0);
    expect(result.available).toBe(false);
    expect(result.note).toMatch(/strong|no career page/i);
  });

  it('skips a lead with no career-page URL', async () => {
    const { provider, calls } = makeRecordingProvider();
    const result = await repairWeakCareerPage(weakCandidate({ careerPageUrl: null }), provider);
    expect(calls.extract).toHaveLength(0);
    expect(result.available).toBe(false);
  });
});

// ─── repairWeakCareerPage — degrade + safety ───────────────────────────────

describe('repairWeakCareerPage — graceful degradation', () => {
  it('degrades when no provider is supplied (Stage-1 default path)', async () => {
    const result = await repairWeakCareerPage(weakCandidate());
    expect(result.available).toBe(false);
    expect(result.note).toMatch(/no enrichment provider/i);
  });

  it('degrades (does not throw) when the provider errors', async () => {
    const throwing: ScrapeProvider = {
      name: 'scrapegraph',
      async scrapeToMarkdown() {
        throw new Error('boom');
      },
      async extractStructuredData() {
        throw new Error('boom');
      },
    };
    const result = await repairWeakCareerPage(weakCandidate(), throwing);
    expect(result.available).toBe(false);
    expect(result.note).toMatch(/provider error/i);
  });

  it('does not mutate the deterministic candidate inputs', async () => {
    const { provider } = makeRecordingProvider();
    const candidate = weakCandidate();
    const snapshot = JSON.stringify(candidate);
    await repairWeakCareerPage(candidate, provider);
    expect(JSON.stringify(candidate)).toBe(snapshot);
  });
});

// ─── Evidence-separation guarantee at the (future) merge site ──────────────
//
// repairWeakCareerPage returns a disjoint result and never touches a lead, so the
// separation is structural here. The load-bearing runtime guard lives at the
// merge site — the caller that attaches the enrichment result to a lead object.
// These tests lock that guard: attaching enrichment leaves the deterministic core
// byte-identical (passes), and overwriting any protected field is rejected.

describe('assertEnrichmentDoesNotTouchEvidence — protected-field separation', () => {
  /** A deterministic lead snapshot exposing every protected-core field. */
  function leadSnapshot() {
    return {
      score: 2.7,
      confidenceGate: 'B',
      evidenceTitles: ['Открыта вакансия Backend', 'Карьерная страница активна'],
      reasons: ['свежие вакансии', 'прямой корпоративный домен'],
      structuredReasons: [{ component: 'fit', detail: 'ICP match' }],
      negativeSignals: [],
      lawfulContactPath: 'hr@acme.test',
    };
  }

  it('passes when enrichment is attached to a NEW auxiliary field', async () => {
    const { provider } = makeRecordingProvider();
    const original = leadSnapshot();
    const enrichment = await repairWeakCareerPage(weakCandidate(), provider);

    // Merge-site shape: deterministic core untouched, enrichment in its own field.
    const enrichedLead = { ...original, enrichment };

    expect(() =>
      assertEnrichmentDoesNotTouchEvidence(original, enrichedLead),
    ).not.toThrow();
    // Auxiliary field actually carried the AI result through.
    expect(enrichedLead.enrichment.data?.detectedRoles[0].title).toBe('Backend');
  });

  it('throws if a merge site overwrites evidenceTitles with enriched roles', () => {
    const original = leadSnapshot();
    // A buggy merge that promotes AI roles straight into deterministic evidence.
    const contaminated = {
      ...original,
      evidenceTitles: ['Backend (AI)', 'QA (AI)'],
    };

    expect(() =>
      assertEnrichmentDoesNotTouchEvidence(original, contaminated),
    ).toThrow(AiBoundaryViolation);
  });

  it('throws if a merge site nudges the deterministic score or gate', () => {
    const original = leadSnapshot();

    expect(() =>
      assertEnrichmentDoesNotTouchEvidence(original, { ...original, score: 3.4 }),
    ).toThrow(AiBoundaryViolation);
    expect(() =>
      assertEnrichmentDoesNotTouchEvidence(original, { ...original, confidenceGate: 'A' }),
    ).toThrow(AiBoundaryViolation);
  });
});
