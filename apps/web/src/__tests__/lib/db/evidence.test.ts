import {
  buildEvidenceRecord,
  evidenceContentHash,
  isEvidenceTier,
  type EvidenceItemInput,
} from '@/lib/db/evidence'

const baseInput: EvidenceItemInput = {
  source: 'career-page',
  url: 'https://acme.example.com/jobs/backend',
  fetchedAt: '2026-05-01T10:00:00.000Z',
  tier: 'direct',
}

describe('evidenceContentHash', () => {
  it('is deterministic for the same logical input', () => {
    expect(evidenceContentHash(baseInput)).toBe(evidenceContentHash({ ...baseInput }))
  })

  it('matches the canonical hash shared with the .mjs writer', () => {
    // Regression guard: packages/db/scripts/lib/evidence-writer.mjs must
    // produce the exact same digest for the exact same input. If you
    // change the recipe, change both files and update this digest.
    expect(evidenceContentHash(baseInput)).toBe(
      'ad99e496e24ffbcef8e3e60368b12316849b169d029fa257a31eeb1c03769ce9'
    )
  })

  it('ignores URL fragment and trailing slash differences', () => {
    const a = evidenceContentHash(baseInput)
    const b = evidenceContentHash({
      ...baseInput,
      url: 'https://acme.example.com/jobs/backend/#anchor',
    })
    expect(a).toBe(b)
  })

  it('is case-insensitive on source name', () => {
    const a = evidenceContentHash(baseInput)
    const b = evidenceContentHash({ ...baseInput, source: 'Career-Page' })
    expect(a).toBe(b)
  })

  it('changes when the tier changes', () => {
    const a = evidenceContentHash(baseInput)
    const b = evidenceContentHash({ ...baseInput, tier: 'corroboration' })
    expect(a).not.toBe(b)
  })

  it('changes when the fetch timestamp changes', () => {
    const a = evidenceContentHash(baseInput)
    const b = evidenceContentHash({
      ...baseInput,
      fetchedAt: '2026-05-01T10:00:01.000Z',
    })
    expect(a).not.toBe(b)
  })

  it('accepts Date instances and ISO strings interchangeably', () => {
    const fromString = evidenceContentHash(baseInput)
    const fromDate = evidenceContentHash({
      ...baseInput,
      fetchedAt: new Date(baseInput.fetchedAt as string),
    })
    expect(fromString).toBe(fromDate)
  })

  it('rejects invalid tier', () => {
    expect(() =>
      evidenceContentHash({ ...baseInput, tier: 'bogus' as unknown as 'direct' })
    ).toThrow(/tier/i)
  })

  it('rejects blank source / url / invalid date', () => {
    expect(() => evidenceContentHash({ ...baseInput, source: '   ' })).toThrow(/source/i)
    expect(() => evidenceContentHash({ ...baseInput, url: '' })).toThrow(/url/i)
    expect(() => evidenceContentHash({ ...baseInput, fetchedAt: 'not-a-date' })).toThrow(
      /fetchedAt/i
    )
  })
})

describe('isEvidenceTier', () => {
  it('accepts the three known tiers', () => {
    expect(isEvidenceTier('direct')).toBe(true)
    expect(isEvidenceTier('corroboration')).toBe(true)
    expect(isEvidenceTier('context')).toBe(true)
  })

  it('rejects unknown / non-string values', () => {
    expect(isEvidenceTier('platform')).toBe(false)
    expect(isEvidenceTier('')).toBe(false)
    expect(isEvidenceTier(null)).toBe(false)
    expect(isEvidenceTier(undefined)).toBe(false)
    expect(isEvidenceTier(42)).toBe(false)
  })
})

describe('buildEvidenceRecord', () => {
  it('normalises fetchedAt to ISO and attaches content hash', () => {
    const rec = buildEvidenceRecord({
      ...baseInput,
      fetchedAt: new Date('2026-05-01T10:00:00.000Z'),
    })
    expect(rec.fetchedAt).toBe('2026-05-01T10:00:00.000Z')
    expect(rec.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('preserves payloadRef and FK ids', () => {
    const rec = buildEvidenceRecord({
      ...baseInput,
      payloadRef: { vacancyId: 'v-1' },
      orgId: 42,
      leadId: 7,
    })
    expect(rec.payloadRef).toEqual({ vacancyId: 'v-1' })
    expect(rec.orgId).toBe(42)
    expect(rec.leadId).toBe(7)
  })
})
