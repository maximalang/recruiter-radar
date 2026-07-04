/**
 * Regression tests for the payload-field contract.
 *
 * Confidence gate, evidence titles, and location names are NOT real columns on
 * digest_candidates — they live inside the payload JSON (the digest writer
 * persists them as snake_case). Several readers (the /leads list, the Telegram
 * delivery card, the /api/review queue, the dashboard gate distribution) must
 * therefore read them out of payload, never as `dc.confidence_gate` etc.
 *
 * Commit 9cb72f1 fixed only leads-data; this suite locks the contract for the
 * canonical extractor AND guards the raw SQL of the other readers so the phantom
 * columns cannot silently creep back in (a fresh-DB 500 / prod blank-field bug).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractPayloadFields } from '@/lib/leads-data';

describe('extractPayloadFields (canonical payload reader)', () => {
  it('reads snake_case keys (how the digest writer persists)', () => {
    const out = extractPayloadFields({
      confidence_gate: 'A',
      evidence_titles: ['Backend', 'Frontend'],
      location_names: ['Москва'],
    });
    expect(out).toEqual({
      confidenceGate: 'A',
      evidenceTitles: ['Backend', 'Frontend'],
      locationNames: ['Москва'],
      isForeignEmployer: false,
      foreignMatchedDomain: null,
    });
  });

  it('reads camelCase keys too (tolerance)', () => {
    const out = extractPayloadFields({
      confidenceGate: 'B',
      evidenceTitles: ['QA'],
      locationNames: ['Санкт-Петербург'],
    });
    expect(out).toEqual({
      confidenceGate: 'B',
      evidenceTitles: ['QA'],
      locationNames: ['Санкт-Петербург'],
      isForeignEmployer: false,
      foreignMatchedDomain: null,
    });
  });

  it('degrades to "" / [] when keys are absent (thin payload, no throw)', () => {
    const out = extractPayloadFields({ rank: 5 });
    expect(out).toEqual({ confidenceGate: '', evidenceTitles: [], locationNames: [], isForeignEmployer: false, foreignMatchedDomain: null });
  });

  it('reads the foreign-employer flag + matched domain from payload', () => {
    expect(extractPayloadFields({ is_foreign_employer: true, foreign_matched_domain: 'greenhouse.io' }))
      .toMatchObject({ isForeignEmployer: true, foreignMatchedDomain: 'greenhouse.io' });
    expect(extractPayloadFields({ isForeignEmployer: true, foreignMatchedDomain: 'lever.co' }))
      .toMatchObject({ isForeignEmployer: true, foreignMatchedDomain: 'lever.co' });
  });

  it('degrades on a null / non-object / array payload', () => {
    const empty = { confidenceGate: '', evidenceTitles: [], locationNames: [], isForeignEmployer: false, foreignMatchedDomain: null };
    expect(extractPayloadFields(null)).toEqual(empty);
    expect(extractPayloadFields(undefined)).toEqual(empty);
    expect(extractPayloadFields('nope')).toEqual(empty);
    expect(extractPayloadFields(['a', 'b'])).toEqual(empty);
  });

  it('filters non-string array entries out of evidence/location', () => {
    const out = extractPayloadFields({
      evidence_titles: ['ok', 1, null, 'two', {}],
      location_names: [true, 'Казань'],
    });
    expect(out.evidenceTitles).toEqual(['ok', 'two']);
    expect(out.locationNames).toEqual(['Казань']);
  });

  it('ignores a non-string confidence gate', () => {
    expect(extractPayloadFields({ confidence_gate: 42 }).confidenceGate).toBe('');
  });
});

describe('no reader references phantom digest_candidates columns', () => {
  // These three identifiers are NOT columns on digest_candidates. Any `dc.<name>`
  // (or `<name> AS`) reference in a reader is the regression we are guarding.
  const PHANTOM = ['confidence_gate', 'evidence_titles', 'location_names'] as const;
  const ROOT = resolve(__dirname, '..', '..', '..');

  const readers = [
    'lib/db.ts',
    'lib/dashboard-data.ts',
    'app/api/review/route.ts',
  ];

  for (const rel of readers) {
    it(`${rel} reads gate/evidence/location from payload, not phantom columns`, () => {
      const src = readFileSync(resolve(ROOT, rel), 'utf8');
      for (const col of PHANTOM) {
        // A column read looks like `dc.confidence_gate` or `confidence_gate AS`.
        // payload reads (`payload->>'confidence_gate'`) are fine and expected.
        expect(src).not.toMatch(new RegExp(`dc\\.${col}\\b`));
        expect(src).not.toMatch(new RegExp(`\\b${col}\\s+AS\\b`));
      }
    });
  }
});
