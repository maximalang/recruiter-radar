/**
 * Tests for the ScrapeGraphAI provider wrapper (Stage-1 stub).
 *
 * What is under test (spec §2):
 *   - The provider implements the swappable ScrapeProvider interface.
 *   - Both methods degrade to a typed "unavailable" result (no network wired).
 *   - The result is always attributed to the scrapegraph provider.
 *   - The extraction instruction is centralized in product code (prompt
 *     versioning never lives in n8n).
 */

import {
  createScrapeGraphProvider,
  isScrapeGraphConfigured,
  CAREER_PAGE_EXTRACTION_INSTRUCTION,
  type ScrapeProvider,
} from '@/lib/ai/providers/scrapegraph';

describe('createScrapeGraphProvider — interface + degrade', () => {
  it('returns a provider named scrapegraph implementing both methods', () => {
    const p: ScrapeProvider = createScrapeGraphProvider();
    expect(p.name).toBe('scrapegraph');
    expect(typeof p.scrapeToMarkdown).toBe('function');
    expect(typeof p.extractStructuredData).toBe('function');
  });

  it('scrapeToMarkdown degrades to unavailable, attributed result', async () => {
    const p = createScrapeGraphProvider();
    const r = await p.scrapeToMarkdown('https://example.com/careers');
    expect(r.available).toBe(false);
    expect(r.data).toBeNull();
    expect(r.provider).toBe('scrapegraph');
    expect(r.capability).toBe('extract-weak-signal');
  });

  it('extractStructuredData degrades to unavailable, attributed result', async () => {
    const p = createScrapeGraphProvider();
    const r = await p.extractStructuredData({
      sourceUrl: 'https://example.com/careers',
      content: '# Careers\nWe are hiring.',
      instruction: CAREER_PAGE_EXTRACTION_INSTRUCTION,
    });
    expect(r.available).toBe(false);
    expect(r.data).toBeNull();
    expect(r.provider).toBe('scrapegraph');
  });

  it('notes a missing API key vs a configured-but-unwired client', async () => {
    const noKey = await createScrapeGraphProvider().scrapeToMarkdown('https://x.test');
    expect(noKey.note).toMatch(/no API key/i);

    const withKey = await createScrapeGraphProvider({ apiKey: 'sk-test' }).scrapeToMarkdown(
      'https://x.test',
    );
    expect(withKey.note).toMatch(/not wired/i);
  });
});

describe('extraction instruction (prompt lives in product code)', () => {
  it('asks for roles, department, location, urgency, and a pattern summary', () => {
    const i = CAREER_PAGE_EXTRACTION_INSTRUCTION.toLowerCase();
    expect(i).toContain('role');
    expect(i).toContain('department');
    expect(i).toContain('location');
    expect(i).toContain('urgency');
    expect(i).toContain('pattern');
  });

  it('forbids inventing facts (trust boundary in the prompt itself)', () => {
    expect(CAREER_PAGE_EXTRACTION_INSTRUCTION.toLowerCase()).toContain('do not invent');
  });
});

describe('isScrapeGraphConfigured', () => {
  it('is false in Stage 1 (no real client wired)', () => {
    expect(isScrapeGraphConfigured()).toBe(false);
  });
});
