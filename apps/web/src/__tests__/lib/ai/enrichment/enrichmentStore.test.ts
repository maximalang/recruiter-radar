/**
 * Tests for the AI-enrichment persistence serializer/parser (spec Block 1 §2).
 *
 * Pure-function coverage only (no DB): the round-trip between a
 * CareerPageEnrichmentResult and the StoredAiEnrichment JSON shape, plus the
 * defensive parse path that protects the lead page from malformed rows.
 * The actual UPDATE is exercised by integration, not here.
 */

import {
  toStoredEnrichment,
  parseStoredEnrichment,
  AI_ENRICHMENT_SCHEMA_VERSION,
} from '@/lib/ai/enrichment/enrichmentStore';
import { emptyEnrichmentResult, type CareerPageEnrichmentResult } from '@/lib/ai/enrichment/careerPages';
import type { EnrichedHiringSignals } from '@/lib/ai/enrichment/careerPages';

function availableResult(overrides: Partial<EnrichedHiringSignals> = {}): CareerPageEnrichmentResult {
  const data: EnrichedHiringSignals = {
    detectedRoles: [{ title: 'Backend', department: 'Eng', confidence: 'medium' }],
    hiringUrgency: 'high',
    departments: ['Eng'],
    locations: ['Москва'],
    hiringPatternSummary: 'Активный найм в инженерную команду.',
    confidence: 'medium',
    sourceUrl: 'https://weak.test/careers',
    provider: 'scrapegraph',
    ...overrides,
  };
  return {
    available: true,
    capability: 'extract-weak-signal',
    provider: 'scrapegraph',
    confidence: 'medium',
    data,
  };
}

describe('toStoredEnrichment', () => {
  it('stamps schemaVersion + enrichedAt onto a successful result', () => {
    const now = new Date('2026-06-29T12:00:00.000Z');
    const stored = toStoredEnrichment(availableResult(), now);
    expect(stored).not.toBeNull();
    expect(stored?.schemaVersion).toBe(AI_ENRICHMENT_SCHEMA_VERSION);
    expect(stored?.enrichedAt).toBe('2026-06-29T12:00:00.000Z');
    expect(stored?.provider).toBe('scrapegraph');
    expect(stored?.detectedRoles[0].title).toBe('Backend');
  });

  it('returns null for a degraded/empty result (so the column stays NULL)', () => {
    expect(toStoredEnrichment(emptyEnrichmentResult('no provider'))).toBeNull();
  });
});

describe('parseStoredEnrichment', () => {
  it('round-trips a stored payload', () => {
    const stored = toStoredEnrichment(availableResult());
    const parsed = parseStoredEnrichment(stored);
    expect(parsed).toEqual(stored);
  });

  it('parses a JSON string column value', () => {
    const stored = toStoredEnrichment(availableResult());
    const parsed = parseStoredEnrichment(JSON.stringify(stored));
    expect(parsed?.sourceUrl).toBe('https://weak.test/careers');
  });

  it('returns null for NULL / undefined', () => {
    expect(parseStoredEnrichment(null)).toBeNull();
    expect(parseStoredEnrichment(undefined)).toBeNull();
  });

  it('returns null for malformed JSON string', () => {
    expect(parseStoredEnrichment('not json{{{')).toBeNull();
  });

  it('returns null when provenance (provider/sourceUrl) is missing', () => {
    expect(parseStoredEnrichment({ detectedRoles: [], hiringPatternSummary: 'x' })).toBeNull();
    expect(parseStoredEnrichment({ provider: 'scrapegraph' })).toBeNull();
  });

  it('tolerates a partial row, filling safe defaults', () => {
    const parsed = parseStoredEnrichment({
      provider: 'crawl4ai',
      sourceUrl: 'https://x.test',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.detectedRoles).toEqual([]);
    expect(parsed?.hiringUrgency).toBe('unknown');
    expect(parsed?.confidence).toBe('low');
    expect(parsed?.schemaVersion).toBe(0); // unknown legacy shape
  });
});
