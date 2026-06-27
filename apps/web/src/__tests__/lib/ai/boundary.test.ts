/**
 * Focused unit tests for the AI-assist boundary contract.
 *
 * Contract under test (spec §2.C, §5, §6):
 *   - assertNoOverride throws on any protected-field mutation; passes when the
 *     core fields come through untouched (including deep array/object equality).
 *   - The capability / prohibition contract is frozen and complete.
 *   - isAllowedCapability rejects typos and unknown capabilities.
 */

import {
  AI_CAPABILITIES,
  AI_PROHIBITIONS,
  PROTECTED_LEAD_FIELDS,
  AiBoundaryViolation,
  assertNoOverride,
  isAllowedCapability,
} from '@/lib/ai/boundary';

describe('AI boundary — capability/prohibition contract', () => {
  it('freezes the exact capability set', () => {
    expect([...AI_CAPABILITIES]).toEqual([
      'summarize',
      'explain-fit',
      'draft-opener',
      'highlight-missing-info',
      'classify-intent',
      'extract-weak-signal',
    ]);
  });

  it('freezes the exact prohibition set — the hard trust boundary', () => {
    expect([...AI_PROHIBITIONS]).toEqual([
      'change-gate',
      'change-score',
      'invent-evidence',
      'bypass-contact-policy',
      'auto-send',
      'mutate-suppression',
    ]);
  });

  it('protects score, gate, and the evidence surface', () => {
    expect([...PROTECTED_LEAD_FIELDS]).toEqual([
      'score',
      'confidenceGate',
      'evidenceTitles',
      'reasons',
      'structuredReasons',
      'negativeSignals',
      'lawfulContactPath',
    ]);
  });
});

describe('isAllowedCapability', () => {
  it('accepts a known capability', () => {
    expect(isAllowedCapability('explain-fit')).toBe(true);
  });

  it('rejects a typo / unknown capability rather than silently passing', () => {
    expect(isAllowedCapability('explain_fit')).toBe(false);
    expect(isAllowedCapability('rewrite-score')).toBe(false);
    expect(isAllowedCapability('')).toBe(false);
  });
});

describe('assertNoOverride', () => {
  const original = {
    score: 3.2,
    confidenceGate: 'A',
    evidenceTitles: ['Карьерная страница', 'HH'],
    reasons: ['r1', 'r2'],
    structuredReasons: [{ component: 'fit', key: 'fit.industry.match' }],
    negativeSignals: [],
    lawfulContactPath: 'Карьерная страница',
  };

  it('passes when the proposed object only adds non-protected fields', () => {
    expect(() =>
      assertNoOverride(original, {
        // AI draft fields are free to differ; protected fields are simply absent.
        ...{} as Record<string, unknown>,
      }),
    ).not.toThrow();
  });

  it('passes when protected fields are present but deep-equal', () => {
    expect(() =>
      assertNoOverride(original, {
        score: 3.2,
        confidenceGate: 'A',
        evidenceTitles: ['Карьерная страница', 'HH'],
        structuredReasons: [{ component: 'fit', key: 'fit.industry.match' }],
      }),
    ).not.toThrow();
  });

  it('throws when the AI layer tries to change the score', () => {
    expect(() => assertNoOverride(original, { score: 4 })).toThrow(AiBoundaryViolation);
  });

  it('throws when the AI layer tries to change the gate', () => {
    try {
      assertNoOverride(original, { confidenceGate: 'B' });
      throw new Error('expected AiBoundaryViolation');
    } catch (e) {
      expect(e).toBeInstanceOf(AiBoundaryViolation);
      expect((e as AiBoundaryViolation).field).toBe('confidenceGate');
    }
  });

  it('throws when the AI layer mutates an evidence array (deep inequality)', () => {
    expect(() =>
      assertNoOverride(original, { evidenceTitles: ['Карьерная страница', 'HH', 'выдумка'] }),
    ).toThrow(AiBoundaryViolation);
  });

  it('throws when the AI layer mutates a nested structured reason', () => {
    expect(() =>
      assertNoOverride(original, {
        structuredReasons: [{ component: 'fit', key: 'fit.industry.excluded' }],
      }),
    ).toThrow(AiBoundaryViolation);
  });

  it('does not throw on reordering-free identical nested arrays', () => {
    expect(() =>
      assertNoOverride(original, { reasons: ['r1', 'r2'] }),
    ).not.toThrow();
  });
});
