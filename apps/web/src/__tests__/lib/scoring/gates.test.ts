import { selectConfidenceGate } from '@/lib/scoring/gates'
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

  it('returns A when one direct and one corroboration with clean match', () => {
    const gate = selectConfidenceGate({
      evidence: [direct('career-page'), corroboration('hh')],
      entityMatch: 'clean',
    })
    expect(gate).toBe('A')
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
