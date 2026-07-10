/**
 * Unit tests for gate-pipeline.ts — digest confidence-gate eligibility filter.
 */

import { isDigestEligibleGate } from '@/lib/scoring/gate-pipeline';

type GateItem = { org_id: string; confidence_gate?: string | null };

const item = (org_id: string, confidence_gate?: string | null): GateItem => ({
  org_id,
  confidence_gate,
});

describe('isDigestEligibleGate — A/B eligible, C/D excluded', () => {
  it('gate A is eligible', () => {
    expect(isDigestEligibleGate(item('1', 'A'))).toBe(true);
  });

  it('gate B is eligible', () => {
    expect(isDigestEligibleGate(item('1', 'B'))).toBe(true);
  });

  it('gate C is excluded', () => {
    expect(isDigestEligibleGate(item('1', 'C'))).toBe(false);
  });

  it('gate D is excluded', () => {
    expect(isDigestEligibleGate(item('1', 'D'))).toBe(false);
  });
});

describe('isDigestEligibleGate — pre-gate items pass through', () => {
  it('null confidence_gate is eligible (scored downstream)', () => {
    expect(isDigestEligibleGate(item('1', null))).toBe(true);
  });

  it('undefined confidence_gate is eligible (scored downstream)', () => {
    expect(isDigestEligibleGate(item('1'))).toBe(true);
  });

  it('empty string confidence_gate is eligible (scored downstream)', () => {
    expect(isDigestEligibleGate(item('1', ''))).toBe(true);
  });
});

describe('isDigestEligibleGate — backward compat for unexpected values', () => {
  it('passes unexpected gate values with a warning', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isDigestEligibleGate(item('1', 'X'))).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"digest.confidence_gate_unexpected"'),
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"gate":"X"'));
    spy.mockRestore();
  });

  it('does not warn for valid A/B gates', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    isDigestEligibleGate(item('1', 'A'));
    isDigestEligibleGate(item('2', 'B'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('isDigestEligibleGate — used as Array.filter predicate', () => {
  it('keeps only A and B from a mixed list', () => {
    const rows = [
      item('1', 'A'),
      item('2', 'B'),
      item('3', 'C'),
      item('4', 'D'),
    ];
    const result = rows.filter(isDigestEligibleGate);
    expect(result.map((r) => r.org_id)).toEqual(['1', '2']);
  });

  it('keeps pre-gate (null/empty) items alongside A/B', () => {
    const rows = [
      item('1', null),
      item('2', 'A'),
      item('3', 'C'),
      item('4', ''),
    ];
    const result = rows.filter(isDigestEligibleGate);
    expect(result.map((r) => r.org_id)).toEqual(['1', '2', '4']);
  });

  it('handles empty array', () => {
    expect(([] as GateItem[]).filter(isDigestEligibleGate)).toHaveLength(0);
  });
});
