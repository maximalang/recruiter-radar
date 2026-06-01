/**
 * Unit tests for gate-pipeline.ts — TS/SQL gate divergence audit.
 * Tests the auditDigestGate, filterGatesForDigest, needsGateReview functions.
 */

import { auditDigestGate, filterGatesForDigest, needsGateReview } from '@/lib/scoring/gate-pipeline';

describe('auditDigestGate — SQL gate matches TS gate', () => {
  it('direct_hiring_proof + 2+ families → SQL A, TS A (aligned)', () => {
    const result = auditDigestGate('A', 'direct_hiring_proof', ['hh', 'career-pages']);
    expect(result.sql_gate).toBe('A');
    expect(result.ts_gate).toBe('A');
    expect(result.resolved_gate).toBe('A');
    expect(result.divergence_detected).toBe(false);
  });

  it('direct_hiring_proof + 1 family → SQL B, TS B (aligned)', () => {
    const result = auditDigestGate('B', 'direct_hiring_proof', ['hh']);
    expect(result.sql_gate).toBe('B');
    expect(result.ts_gate).toBe('B');
    expect(result.resolved_gate).toBe('B');
    expect(result.divergence_detected).toBe(false);
  });

  it('platform_aggregation without direct evidence → TS C (intentional divergence from SQL B)', () => {
    // This is the documented divergence: TS requires direct tier for B; SQL accepts
    // platform_aggregation without direct as B. TS is stricter here.
    const result = auditDigestGate('B', 'platform_aggregation', ['hh', 'linkedin']);
    expect(result.sql_gate).toBe('B');
    expect(result.ts_gate).toBe('C'); // TS: no direct tier → C
    expect(result.divergence_detected).toBe(false); // no entityMatch override
    expect(result.resolved_gate).toBe('B'); // SQL gate used since no explicit questionable
  });

  it('enrichment_context → SQL D, TS D (aligned)', () => {
    const result = auditDigestGate('D', 'enrichment_context', ['unknown']);
    expect(result.sql_gate).toBe('D');
    expect(result.ts_gate).toBe('D');
    expect(result.resolved_gate).toBe('D');
    expect(result.divergence_detected).toBe(false);
  });

  it('null evidence_quality treated as context', () => {
    const result = auditDigestGate('D', null, []);
    expect(result.sql_gate).toBe('D');
    expect(result.ts_gate).toBe('D');
    expect(result.resolved_gate).toBe('D');
  });
});

describe('auditDigestGate — divergence detected', () => {
  it('SQL B + questionable entityMatch → TS overrides to C', () => {
    const result = auditDigestGate(
      'B',
      'direct_hiring_proof',
      ['hh'],
      'questionable'
    );
    expect(result.sql_gate).toBe('B');
    expect(result.ts_gate).toBe('C'); // questionable entity match forces C
    expect(result.divergence_detected).toBe(true);
    expect(result.divergence_reason).toContain('overrides');
    expect(result.resolved_gate).toBe('C'); // TS gate wins on questionable
  });

  it('SQL A + questionable entityMatch → TS overrides to C', () => {
    const result = auditDigestGate(
      'A',
      'direct_hiring_proof',
      ['hh', 'career-pages'],
      'questionable'
    );
    expect(result.sql_gate).toBe('A');
    expect(result.ts_gate).toBe('C');
    expect(result.divergence_detected).toBe(true);
    expect(result.resolved_gate).toBe('C');
  });

  it('SQL B + clean entityMatch → no divergence', () => {
    const result = auditDigestGate('B', 'platform_aggregation', ['hh'], 'clean');
    expect(result.divergence_detected).toBe(false);
    expect(result.resolved_gate).toBe('B');
  });

  it('invalid gate string defaults to D for sql_gate, TS evaluates evidence independently', () => {
    // sql_gate: 'X' is not A/B/C/D → normalized to 'D'
    // ts_gate: single direct without corroboration = 'B' (not enough for A)
    // resolved_gate: no explicit questionable → SQL gate wins
    const result = auditDigestGate('X' as never, 'direct_hiring_proof', ['hh']);
    expect(result.sql_gate).toBe('D'); // invalid gate normalized to D
    expect(result.ts_gate).toBe('B'); // 1 direct, 0 corroboration → B
    expect(result.divergence_detected).toBe(false); // no explicit questionable
    expect(result.resolved_gate).toBe('D'); // SQL gate wins for invalid input
  });
});

describe('filterGatesForDigest — pipeline filter', () => {
  const mockRows = (gates: string[]) =>
    gates.map((gate, i) => ({
      org_id: String(i + 1),
      rank: i + 1,
      confidence_gate: gate,
      evidence_quality: 'direct_hiring_proof' as const,
      source_families: ['hh'] as string[],
      source_external_id: null,
      source_display_name: null,
      evidence_titles: [] as string[],
      latest_published_at: null,
    }));

  it('passes only A and B gates', () => {
    const rows = mockRows(['A', 'B', 'C', 'D']);
    const result = filterGatesForDigest(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.confidence_gate)).toEqual(['A', 'B']);
  });

  it('excludes all C and D', () => {
    const rows = mockRows(['A', 'C', 'B', 'D', 'A']);
    const result = filterGatesForDigest(rows);
    expect(result.every((r) => r.confidence_gate === 'A' || r.confidence_gate === 'B')).toBe(true);
  });

  it('handles empty array', () => {
    expect(filterGatesForDigest([])).toHaveLength(0);
  });

  it('handles all gate types', () => {
    const rows = mockRows(['A', 'B', 'C', 'D', 'A', 'B']);
    const result = filterGatesForDigest(rows);
    expect(result).toHaveLength(4);
  });

  it('passes items with null confidence_gate (eligible, scored downstream)', () => {
    const rows = [
      { org_id: '1', rank: 1, confidence_gate: null, evidence_quality: 'direct_hiring_proof', source_families: ['hh'], source_external_id: null, source_display_name: null, evidence_titles: [], latest_published_at: null },
      { org_id: '2', rank: 2, confidence_gate: 'A', evidence_quality: 'direct_hiring_proof', source_families: ['hh'], source_external_id: null, source_display_name: null, evidence_titles: [], latest_published_at: null },
      { org_id: '3', rank: 3, confidence_gate: 'C', evidence_quality: 'platform_aggregation', source_families: ['hh'], source_external_id: null, source_display_name: null, evidence_titles: [], latest_published_at: null },
    ];
    const result = filterGatesForDigest(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.org_id)).toEqual(['1', '2']);
  });

  it('passes items with empty string confidence_gate (eligible, scored downstream)', () => {
    const rows = [
      { org_id: '1', rank: 1, confidence_gate: '', evidence_quality: 'direct_hiring_proof', source_families: ['hh'], source_external_id: null, source_display_name: null, evidence_titles: [], latest_published_at: null },
      { org_id: '2', rank: 2, confidence_gate: 'D', evidence_quality: 'enrichment_context', source_families: ['unknown'], source_external_id: null, source_display_name: null, evidence_titles: [], latest_published_at: null },
    ];
    const result = filterGatesForDigest(rows);
    expect(result).toHaveLength(1);
    expect(result[0].org_id).toBe('1');
  });

  it('passes unexpected gate values with warning (backward compat)', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = [
      { org_id: '1', rank: 1, confidence_gate: 'X', evidence_quality: 'direct_hiring_proof', source_families: ['hh'], source_external_id: null, source_display_name: null, evidence_titles: [], latest_published_at: null },
    ];
    const result = filterGatesForDigest(rows);
    expect(result).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('unexpected confidence_gate'));
    spy.mockRestore();
  });
});

describe('needsGateReview — review flagging', () => {
  it('gate C always needs review', () => {
    expect(needsGateReview('C', null, 'platform_aggregation')).toBe(true);
    expect(needsGateReview('C', 'external_id', 'direct_hiring_proof')).toBe(true);
  });

  it('gate B with no matched_by needs review', () => {
    expect(needsGateReview('B', null, 'direct_hiring_proof')).toBe(true);
    expect(needsGateReview('B', undefined, 'platform_aggregation')).toBe(true);
  });

  it('gate B with matched_by does not need review', () => {
    expect(needsGateReview('B', 'external_id', 'direct_hiring_proof')).toBe(false);
    expect(needsGateReview('B', 'source_alias_key', 'platform_aggregation')).toBe(false);
  });

  it('gate A never needs review', () => {
    expect(needsGateReview('A', null, 'direct_hiring_proof')).toBe(false);
  });

  it('gate D never needs review (never reaches digest)', () => {
    expect(needsGateReview('D', null, 'enrichment_context')).toBe(false);
  });

  it('platform aggregation without matched_by needs review', () => {
    expect(needsGateReview('B', null, 'platform_aggregation')).toBe(true);
  });
});