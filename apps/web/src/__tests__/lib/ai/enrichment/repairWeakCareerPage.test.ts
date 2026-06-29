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
import { __resetEnrichmentQuotaForTests } from '@/lib/ai/enrichment/enrichmentRateLimit';
import type { ScrapeProvider, ScrapeMarkdownResult } from '@/lib/ai/providers/scrapegraph';
import type { MarkdownProvider } from '@/lib/ai/providers/crawl4ai';
import type { EnrichedHiringSignals } from '@/lib/ai/enrichment/careerPages';
import type { AssistResult } from '@/lib/ai/assist-types';

// Reset the per-org cost quota before each test so cases don't leak the in-memory
// window into one another (every weak attempt consumes quota by default).
beforeEach(() => {
  __resetEnrichmentQuotaForTests();
});

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

/** A provider whose extract returns NO usable signal (degraded), to drive the fallback. */
function makeEmptyExtractProvider(): ScrapeProvider {
  return {
    name: 'scrapegraph',
    async scrapeToMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      return {
        available: true,
        capability: 'extract-weak-signal',
        provider: 'scrapegraph',
        confidence: 'medium',
        data: { markdown: '# Careers', fetchedUrl: url },
      };
    },
    async extractStructuredData(): Promise<AssistResult<EnrichedHiringSignals>> {
      return {
        available: false,
        capability: 'extract-weak-signal',
        provider: 'scrapegraph',
        confidence: 'low',
        data: null,
        note: 'no usable signal',
      };
    },
  };
}

/**
 * A provider whose extract is EMPTY on the first (raw) content but SUCCEEDS when
 * re-run on the clean fallback markdown — models the real "noisy page parses
 * cleanly once reduced to markdown" win. Records every extract content seen.
 */
function makeEmptyThenSucceedProvider(cleanMarkdown = '# Clean markdown'): {
  provider: ScrapeProvider;
  extractContents: string[];
} {
  const extractContents: string[] = [];
  const enriched: EnrichedHiringSignals = {
    detectedRoles: [{ title: 'Recovered Role', department: null, confidence: 'medium' }],
    hiringUrgency: 'medium',
    departments: [],
    locations: [],
    hiringPatternSummary: 'Recovered from clean markdown.',
    confidence: 'medium',
    sourceUrl: 'https://weak.test/careers',
    provider: 'scrapegraph',
  };
  const provider: ScrapeProvider = {
    name: 'scrapegraph',
    async scrapeToMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      return {
        available: true,
        capability: 'extract-weak-signal',
        provider: 'scrapegraph',
        confidence: 'medium',
        data: { markdown: '# Raw', fetchedUrl: url },
      };
    },
    async extractStructuredData(input): Promise<AssistResult<EnrichedHiringSignals>> {
      extractContents.push(input.content);
      // Only the clean fallback markdown yields signal.
      if (input.content === cleanMarkdown) {
        return {
          available: true,
          capability: 'extract-weak-signal',
          provider: 'scrapegraph',
          confidence: 'medium',
          data: enriched,
        };
      }
      return {
        available: false,
        capability: 'extract-weak-signal',
        provider: 'scrapegraph',
        confidence: 'low',
        data: null,
        note: 'no usable signal',
      };
    },
  };
  return { provider, extractContents };
}

/** A Crawl4AI-compatible markdown fallback that records its calls. */
function makeRecordingFallback(available = true): {
  fallback: MarkdownProvider;
  calls: string[];
} {
  const calls: string[] = [];
  const fallback: MarkdownProvider = {
    name: 'crawl4ai',
    async fetchCleanMarkdown(url: string): Promise<AssistResult<ScrapeMarkdownResult>> {
      calls.push(url);
      return {
        available,
        capability: 'extract-weak-signal',
        provider: 'crawl4ai',
        confidence: 'medium',
        data: available ? { markdown: '# Clean markdown', fetchedUrl: url } : null,
      };
    },
  };
  return { fallback, calls };
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

// ─── repairWeakCareerPage — per-org cost quota (spec §2) ────────────────────

describe('repairWeakCareerPage — cost quota (1 call per org / 24h)', () => {
  it('blocks the second enrichment for the same org within the window', async () => {
    const { provider, calls } = makeRecordingProvider();

    const first = await repairWeakCareerPage(weakCandidate({ orgId: 'org-quota' }), provider);
    expect(first.available).toBe(true);
    expect(calls.extract).toHaveLength(1);

    // Second weak lead for the SAME org, same window → blocked, provider untouched.
    const second = await repairWeakCareerPage(weakCandidate({ orgId: 'org-quota' }), provider);
    expect(second.available).toBe(false);
    expect(second.note).toMatch(/quota/i);
    expect(calls.extract).toHaveLength(1); // no second provider call
  });

  it('does not consume quota when the lead is skipped (strong / no provider)', async () => {
    const { provider, calls } = makeRecordingProvider();

    // A strong lead is skipped before quota is touched...
    await repairWeakCareerPage(strongCandidate({ orgId: 'org-spend' }), provider);
    // ...so a later weak lead for the same org still gets its one allowed call.
    const weak = await repairWeakCareerPage(weakCandidate({ orgId: 'org-spend' }), provider);
    expect(weak.available).toBe(true);
    expect(calls.extract).toHaveLength(1);
  });

  it('can be disabled for tests via enforceQuota:false', async () => {
    const { provider, calls } = makeRecordingProvider();
    await repairWeakCareerPage(weakCandidate({ orgId: 'o' }), provider, { enforceQuota: false });
    await repairWeakCareerPage(weakCandidate({ orgId: 'o' }), provider, { enforceQuota: false });
    expect(calls.extract).toHaveLength(2); // both passed — quota not enforced
  });
});

// ─── repairWeakCareerPage — Crawl4AI markdown fallback (spec §2.2/§2.3) ──────

describe('repairWeakCareerPage — Crawl4AI re-extract when primary extract is empty', () => {
  it('re-extracts from clean fallback markdown and returns the recovered signal', async () => {
    const { fallback, calls } = makeRecordingFallback();
    const { provider, extractContents } = makeEmptyThenSucceedProvider();
    const result = await repairWeakCareerPage(weakCandidate(), provider, {
      fallbackProvider: fallback,
    });

    // Fallback fetched clean markdown for the same page...
    expect(calls).toEqual(['https://weak.test/careers']);
    // ...and the provider re-extracted from that clean markdown.
    expect(extractContents).toEqual(['# Raw', '# Clean markdown']);
    // The recovered signal is returned (not the empty primary result).
    expect(result.available).toBe(true);
    expect(result.data?.detectedRoles[0].title).toBe('Recovered Role');
  });

  it('returns the empty primary result when the fallback also yields nothing', async () => {
    const { fallback, calls } = makeRecordingFallback();
    const result = await repairWeakCareerPage(weakCandidate(), makeEmptyExtractProvider(), {
      fallbackProvider: fallback,
    });

    // Fallback ran for the same page...
    expect(calls).toEqual(['https://weak.test/careers']);
    // ...but re-extract still found nothing → empty primary result flows out.
    expect(result.available).toBe(false);
    expect(result.data).toBeNull();
  });

  it('does NOT run the fallback when the primary extract succeeds', async () => {
    const { provider } = makeRecordingProvider();
    const { fallback, calls } = makeRecordingFallback();
    const result = await repairWeakCareerPage(weakCandidate(), provider, {
      fallbackProvider: fallback,
    });

    expect(result.available).toBe(true);
    expect(calls).toHaveLength(0); // primary succeeded → no fallback
  });

  it('does not crash and still degrades when no fallback is supplied', async () => {
    const result = await repairWeakCareerPage(weakCandidate(), makeEmptyExtractProvider());
    expect(result.available).toBe(false);
  });

  it('shares the single org quota — fallback re-extract does not consume a second slot', async () => {
    const { fallback } = makeRecordingFallback();
    // First weak lead: primary empty + fallback re-extract, consumes the one org slot.
    await repairWeakCareerPage(weakCandidate({ orgId: 'org-fb' }), makeEmptyExtractProvider(), {
      fallbackProvider: fallback,
    });
    // Second weak lead same org/window → blocked regardless of the fallback.
    const second = await repairWeakCareerPage(
      weakCandidate({ orgId: 'org-fb' }),
      makeEmptyExtractProvider(),
      { fallbackProvider: fallback },
    );
    expect(second.available).toBe(false);
    expect(second.note).toMatch(/quota/i);
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
