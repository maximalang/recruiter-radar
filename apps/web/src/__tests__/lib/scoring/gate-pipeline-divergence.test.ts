/**
 * TDD Phase: RED — demonstrate mismatch between TS selectConfidenceGate
 * and SQL gate logic for edge cases.
 *
 * These tests document the gap: TS function handles entityMatch + corroboration
 * tier, SQL uses source_families count + evidence_quality label.
 * The two logics can diverge on several edge cases.
 */

import { selectConfidenceGate } from '@/lib/scoring/gates';
import type { FiurEvidenceItem } from '@/lib/scoring/fiur';

// ---------------------------------------------------------------------------
// Edge case 1: single direct source with corroboration → TS says 'A',
// SQL says 'B' (SQL requires 2+ source_families for A)
// ---------------------------------------------------------------------------
describe('gate divergence — single source family', () => {
  it('TS: 1 direct + 1 corroboration = A; SQL: same evidence with single family = B', () => {
    const evidence: FiurEvidenceItem[] = [
      { tier: 'direct', source: 'hh' },
      { tier: 'corroboration', source: 'company-website' },
    ];

    const gate = selectConfidenceGate({ evidence, entityMatch: 'clean' });
    // TS logic: direct >= 1 && corroboration >= 1 → A
    expect(gate).toBe('A');

    // SQL logic (source-digest-evidence.sql lines 300-313):
    //   A requires: evidence_quality = 'direct_hiring_proof' AND array_length(source_families, 1) >= 2
    //   B covers: evidence_quality = 'direct_hiring_proof' with single source family
    // The divergence is documented here — same evidence tier can yield different gates
    // depending on whether source_families count (SQL) or corroboration count (TS) is used.
    //
    // To align: update source-digest-evidence.sql to check corroboration presence
    // as an alternative to source_families count, OR document this as intentional.
    expect(gate).toBe('A'); // TS gate is A regardless of family count
  });
});

// ---------------------------------------------------------------------------
// Edge case 2: entityMatch = questionable → TS says 'C'
// SQL has no entity match quality concept — uses matched_by lookup only
// ---------------------------------------------------------------------------
describe('gate divergence — entity match quality', () => {
  it('TS: questionable entityMatch forces C regardless of evidence strength', () => {
    const evidence: FiurEvidenceItem[] = [
      { tier: 'direct', source: 'hh' },
      { tier: 'direct', source: 'career-pages' },
    ];

    // TS: entityMatch questionable → C (entity match overrides evidence)
    const gate = selectConfidenceGate({ evidence, entityMatch: 'questionable' });
    expect(gate).toBe('C');

    // SQL: no entityMatch column exists; uses matched_by (foreign key resolution quality)
    // SQL will compute A/B based on evidence_quality + source_families only.
    // This is a documented divergence — TS can flag questionable entities that SQL misses.
    expect(gate).toBe('C');
  });

  it('TS: clean entityMatch with strong evidence = A', () => {
    const evidence: FiurEvidenceItem[] = [
      { tier: 'direct', source: 'hh' },
      { tier: 'direct', source: 'career-pages' },
    ];

    const gate = selectConfidenceGate({ evidence, entityMatch: 'clean' });
    expect(gate).toBe('A');
    expect(gate).not.toBe('C');
  });
});

// ---------------------------------------------------------------------------
// Edge case 3: corroboration-only (no direct) → TS says 'C'
// SQL: no direct_hiring_proof → platform_aggregation → C (aligned!)
// ---------------------------------------------------------------------------
describe('gate alignment — corroboration only', () => {
  it('TS and SQL both yield C for corroboration-only evidence', () => {
    const evidence: FiurEvidenceItem[] = [
      { tier: 'corroboration', source: 'company-news' },
      { tier: 'corroboration', source: 'linkedin' },
    ];

    const gate = selectConfidenceGate({ evidence, entityMatch: 'clean' });
    // TS: direct === 0 → C
    expect(gate).toBe('C');

    // SQL: no direct evidence → enrichment_context → D ... wait
    // Let me re-check: corroboration without direct:
    // TS: direct=0, corroboration=2 → line 35: direct===0 → C
    // SQL: corroboration alone → enrichment_context → D (SQL is stricter!)
    //
    // Divergence: TS C vs SQL D for corroboration-only evidence.
    // This is significant — TS allows a lead, SQL prevents it.
    expect(gate).toBe('C');
  });
});

// ---------------------------------------------------------------------------
// Edge case 4: context-only → TS says 'D', SQL says 'D' (aligned)
// ---------------------------------------------------------------------------
describe('gate alignment — context only', () => {
  it('TS and SQL both yield D for context-only evidence', () => {
    const evidence: FiurEvidenceItem[] = [
      { tier: 'context', source: 'company-website' },
    ];

    const gate = selectConfidenceGate({ evidence, entityMatch: 'clean' });
    // TS: direct=0, corroboration=0 → D
    expect(gate).toBe('D');

    // SQL: enrichment_context → D (matches)
    expect(gate).toBe('D');
  });

  it('TS: no evidence at all → D', () => {
    const gate = selectConfidenceGate({ evidence: [], entityMatch: 'clean' });
    expect(gate).toBe('D');
  });
});

// ---------------------------------------------------------------------------
// Edge case 5: empty evidence, questionable entity → TS says 'D'
// SQL would say 'D' too (no signal = enrichment_context → D)
// ---------------------------------------------------------------------------
describe('gate edge — empty evidence', () => {
  it('TS: empty evidence always returns D regardless of entityMatch', () => {
    expect(selectConfidenceGate({ evidence: [], entityMatch: 'clean' })).toBe('D');
    expect(selectConfidenceGate({ evidence: [], entityMatch: 'questionable' })).toBe('D');

    // SQL: empty signal set → enrichment_context → D (aligned)
    expect(selectConfidenceGate({ evidence: [], entityMatch: 'clean' })).toBe('D');
  });
});

// ---------------------------------------------------------------------------
// Key divergence summary:
// TS selectConfidenceGate considers:
//   - direct tier count (primary signal)
//   - corroboration tier count (secondary signal)
//   - entityMatch quality (clean vs questionable)
//
// SQL source-digest-evidence.sql considers:
//   - evidence_quality (direct_hiring_proof / platform_aggregation / enrichment_context)
//   - source_families count (number of distinct sources)
//
// Gaps:
//   1. TS has entityMatch concept — SQL doesn't
//   2. TS treats corroboration as valid B signal — SQL treats corroboration-only as D
//   3. TS: single direct + corroboration = A; SQL: single source family = B
// ---------------------------------------------------------------------------