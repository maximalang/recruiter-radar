import { selectConfidenceGate, deriveReviewStatus } from '@/lib/scoring/gates'
import type { FiurEvidenceItem } from '@/lib/scoring/fiur'

const direct = (source = 'career-page'): FiurEvidenceItem => ({ tier: 'direct', source })
const corroboration = (source = 'hh'): FiurEvidenceItem => ({
  tier: 'corroboration',
  source,
})
const context = (source = 'company-website'): FiurEvidenceItem => ({
  tier: 'context',
  source,
})

describe('selectConfidenceGate', () => {
  it('returns A when two independent direct evidence items and entity match is clean', () => {
    const gate = selectConfidenceGate({
      evidence: [direct('career-page'), direct('company-api')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('A')
  })

  it('does not promote duplicate direct evidence from one source family to A', () => {
    const gate = selectConfidenceGate({
      evidence: [direct('career-page'), direct('career-page')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('B')
  })

  it('returns A when one direct and one corroboration with clean match', () => {
    const gate = selectConfidenceGate({
      evidence: [direct('career-page'), corroboration('hh')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('A')
  })

  it('does not treat direct and corroboration records from one source family as independent', () => {
    const gate = selectConfidenceGate({
      evidence: [direct('career-page'), corroboration('career-page')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('B')
  })

  it('returns B with single direct evidence and enrichment, clean match', () => {
    const gate = selectConfidenceGate({
      evidence: [direct('career-page'), context('company-website')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('B')
  })

  it('returns C when only platform aggregation (corroboration) is available', () => {
    const gate = selectConfidenceGate({
      evidence: [corroboration('hh'), corroboration('linkedin')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('C')
  })

  it('returns C when entity match is questionable, even with direct evidence', () => {
    const gate = selectConfidenceGate({
      evidence: [direct('career-page'), corroboration('hh')],
      entityMatch: 'questionable',
    })
    expect(gate).toBe('C')
  })

  it('returns D when only context layers are present (no hiring proof)', () => {
    const gate = selectConfidenceGate({
      evidence: [context('company-website'), context('news')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('D')
  })

  it('returns D for empty evidence', () => {
    const gate = selectConfidenceGate({ evidence: [], entityMatch: 'clean' })
    expect(gate).toBe('D')
  })

  it('returns D when there is no direct or corroboration evidence', () => {
    const gate = selectConfidenceGate({
      evidence: [context('website')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('D')
  })

  it('drops single-direct + nothing-else to B (still has hiring proof)', () => {
    const gate = selectConfidenceGate({
      evidence: [direct('career-page')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('B')
  })
})

describe('deriveReviewStatus', () => {
  /**
   * deriveReviewStatus wires the /review queue. Contract (docs/инфо о проекте.md
   * §"обязательный analyst review" + lib/scoring/gates.ts): gate C, foreign
   * employer, or single source → pending_review; otherwise auto_approved.
   * Pure function — the digest writer calls it per candidate.
   */
  it('routes gate C to pending_review even with multiple sources', () => {
    expect(
      deriveReviewStatus({ confidenceGate: 'C', isForeignEmployer: false, sourceFamilies: ['career-pages', 'habr'] }),
    ).toBe('pending_review')
  })

  it('routes foreign employers to pending_review regardless of gate', () => {
    expect(
      deriveReviewStatus({ confidenceGate: 'A', isForeignEmployer: true, sourceFamilies: ['career-pages', 'habr'] }),
    ).toBe('pending_review')
  })

  it('routes single-source candidates to pending_review (no corroboration)', () => {
    expect(
      deriveReviewStatus({ confidenceGate: 'B', isForeignEmployer: false, sourceFamilies: ['hh'] }),
    ).toBe('pending_review')
  })

  it('routes empty source list to pending_review', () => {
    expect(
      deriveReviewStatus({ confidenceGate: 'B', isForeignEmployer: false, sourceFamilies: [] }),
    ).toBe('pending_review')
  })

  it('auto-approves gate A/B with 2+ sources and no foreign flag', () => {
    expect(
      deriveReviewStatus({ confidenceGate: 'A', isForeignEmployer: false, sourceFamilies: ['career-pages', 'habr'] }),
    ).toBe('auto_approved')
    expect(
      deriveReviewStatus({ confidenceGate: 'B', isForeignEmployer: false, sourceFamilies: ['career-pages', 'hh'] }),
    ).toBe('auto_approved')
  })

  it('gate D falls through to auto_approved (gate D means no lead is created at all)', () => {
    // Gate D candidates are filtered out of the digest before reaching the
    // writer; if one ever reached deriveReviewStatus the review_status is moot.
    // The rule only inspects gate C, so D falls through to auto_approved.
    expect(
      deriveReviewStatus({ confidenceGate: 'D', isForeignEmployer: false, sourceFamilies: ['career-pages', 'habr'] }),
    ).toBe('auto_approved')
  })
})
