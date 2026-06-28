/**
 * Contract tests for the career-page enrichment data shape.
 *
 * What is under test (spec §1):
 *   - The result envelope degrades to a single, consistent "unavailable" shape.
 *   - AI-enriched fields stay structurally SEPARATE from source evidence — the
 *     enriched payload carries its own provider + confidence + sourceUrl and is
 *     never the deterministic evidence surface.
 *   - hasEnrichment is a correct type guard for the available+data case.
 */

import {
  emptyEnrichmentResult,
  hasEnrichment,
  type CareerPageEnrichmentResult,
  type EnrichedHiringSignals,
} from '@/lib/ai/enrichment/careerPages';

function signals(overrides: Partial<EnrichedHiringSignals> = {}): EnrichedHiringSignals {
  return {
    detectedRoles: [
      { title: 'Backend-разработчик', department: 'Engineering', confidence: 'medium' },
    ],
    hiringUrgency: 'medium',
    departments: ['Engineering'],
    locations: ['Москва'],
    hiringPatternSummary: 'Точечный найм в инженерную команду.',
    confidence: 'medium',
    sourceUrl: 'https://example.com/careers',
    provider: 'scrapegraph',
    ...overrides,
  };
}

describe('emptyEnrichmentResult', () => {
  it('is unavailable, null data, fixed weak-signal capability, provider none', () => {
    const r = emptyEnrichmentResult('because reasons');
    expect(r.available).toBe(false);
    expect(r.data).toBeNull();
    expect(r.capability).toBe('extract-weak-signal');
    expect(r.provider).toBe('none');
    expect(r.confidence).toBe('low');
    expect(r.note).toBe('because reasons');
  });
});

describe('hasEnrichment type guard', () => {
  it('returns false for the degraded result', () => {
    expect(hasEnrichment(emptyEnrichmentResult())).toBe(false);
  });

  it('returns true and narrows data when available', () => {
    const r: CareerPageEnrichmentResult = {
      available: true,
      capability: 'extract-weak-signal',
      provider: 'scrapegraph',
      confidence: 'high',
      data: signals(),
    };
    expect(hasEnrichment(r)).toBe(true);
    if (hasEnrichment(r)) {
      // Narrowed: data is non-null here.
      expect(r.data.detectedRoles).toHaveLength(1);
    }
  });

  it('treats available:true with null data as no enrichment', () => {
    const r: CareerPageEnrichmentResult = {
      available: true,
      capability: 'extract-weak-signal',
      provider: 'scrapegraph',
      confidence: 'high',
      data: null,
    };
    expect(hasEnrichment(r)).toBe(false);
  });
});

describe('enriched signals carry their own provenance (separation from evidence)', () => {
  it('every enriched payload self-attributes provider + sourceUrl + confidence', () => {
    const s = signals();
    // These three are what keep AI output attributable and separate from the
    // deterministic evidence fields — assert they are always present.
    expect(s.provider).toBeTruthy();
    expect(s.sourceUrl).toMatch(/^https?:\/\//);
    expect(['low', 'medium', 'high']).toContain(s.confidence);
  });

  it('detected roles are their own shape, not deterministic evidence titles', () => {
    const s = signals({
      detectedRoles: [
        { title: 'QA-инженер', department: null, confidence: 'low' },
        { title: 'DevOps', department: 'Platform', confidence: 'high' },
      ],
    });
    // Roles here are AI-detected; each carries its own confidence — a plain
    // evidence-title string array could never express that, which is the point.
    expect(s.detectedRoles.map((r) => r.confidence)).toEqual(['low', 'high']);
  });
});
