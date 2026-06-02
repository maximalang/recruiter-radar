import { EntityResolver } from '@/lib/lead-discovery/lead-aggregator'
import type { MultiSourceLead } from '@/lib/lead-discovery/multi-source-lead-generator'

function makeLead(overrides: Partial<MultiSourceLead> = {}): MultiSourceLead {
  return {
    id: 'lead-1',
    companyId: 'co-1',
    companyName: 'Test Company',
    score: 0.5,
    confidence: 'B',
    sources: [],
    signals: [],
    nextAction: 'reach out',
    reasons: [],
    detectedAt: new Date(),
    enrichment: {},
    ...overrides,
  }
}

describe('EntityResolver', () => {
  let resolver: EntityResolver

  beforeEach(() => {
    resolver = new EntityResolver()
  })

  describe('INN-based resolution', () => {
    it('uses INN prefix when valid 10-digit INN provided', async () => {
      const leads = [makeLead({ inn: '7707083893', companyName: 'Сбербанк' })]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toBe('inn-7707083893')
    })

    it('uses INN prefix when valid 12-digit INN provided', async () => {
      const leads = [makeLead({ inn: '770708389300', companyName: 'ИП Иванов' })]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toBe('inn-770708389300')
    })

    it('falls back to name-based ID when INN is empty', async () => {
      const leads = [makeLead({ inn: '', companyName: 'OOO Ромашка' })]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toMatch(/^co-/)
    })

    it('falls back to name-based ID when INN is invalid (wrong length)', async () => {
      const leads = [makeLead({ inn: '12345', companyName: 'Some Company' })]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toMatch(/^co-/)
    })

    it('falls back to name-based ID when INN contains non-digits', async () => {
      const leads = [makeLead({ inn: '7707abc893', companyName: 'Bad INN Corp' })]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toMatch(/^co-/)
    })

    it('INN with whitespace is still valid after trimming', async () => {
      const leads = [makeLead({ inn: ' 7707083893 ', companyName: 'Trimmed INN Corp' })]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toBe('inn-7707083893')
    })
  })

  describe('normalizeCompanyName', () => {
    it('resolves same name to same canonical ID (deterministic)', async () => {
      const leads = [
        makeLead({ id: 'l1', companyName: 'Яндекс' }),
        makeLead({ id: 'l2', companyName: 'Яндекс' }),
      ]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toBe(resolved[1].canonicalCompanyId)
    })

    it('resolves different names to different canonical IDs', async () => {
      const leads = [
        makeLead({ id: 'l1', companyName: 'Яндекс' }),
        makeLead({ id: 'l2', companyName: 'Сбербанк' }),
      ]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).not.toBe(resolved[1].canonicalCompanyId)
    })

    it('expands ООО abbreviation', async () => {
      const leads = [
        makeLead({ id: 'l1', companyName: 'ООО Ромашка' }),
        makeLead({ id: 'l2', companyName: 'Ромашка' }),
      ]
      const resolved = await resolver.resolveAll(leads)
      // ООО gets expanded, so these should NOT resolve to the same ID
      // (Ромашка without ООО ≠ "ooo ромашка" after normalization)
      // Actually: "ooo ромашка" → "limited liability company ромашка", while "ромашка" stays as-is
      // So they should be different
      expect(resolved[0].canonicalCompanyId).not.toBe(resolved[1].canonicalCompanyId)
    })

    it('expands АО abbreviation', async () => {
      const leads = [makeLead({ companyName: 'АО Газпром' })]
      const resolved = await resolver.resolveAll(leads)
      // Should not crash, should resolve to a co- ID
      expect(resolved[0].canonicalCompanyId).toMatch(/^co-/)
    })

    it('expands ОАO abbreviation', async () => {
      const leads = [makeLead({ companyName: 'ОАО РЖД' })]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toMatch(/^co-/)
    })

    it('expands ИП abbreviation', async () => {
      const leads = [makeLead({ companyName: 'ИП Иванов А.Б.' })]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toMatch(/^co-/)
    })

    it('normalizes whitespace and removes special characters', async () => {
      const leads = [
        makeLead({ id: 'l1', companyName: 'Company   Name  ' }),
      ]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toMatch(/^co-/)
      // Same input with different whitespace should normalize similarly
    })

    it('case-insensitive matching', async () => {
      const leads = [
        makeLead({ id: 'l1', companyName: 'YANDEX' }),
        makeLead({ id: 'l2', companyName: 'yandex' }),
      ]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toBe(resolved[1].canonicalCompanyId)
    })

    it('cache hit — repeated call returns same result', async () => {
      const leads1 = [makeLead({ id: 'l1', companyName: 'CachedCorp' })]
      const leads2 = [makeLead({ id: 'l2', companyName: 'CachedCorp' })]

      const resolved1 = await resolver.resolveAll(leads1)
      const resolved2 = await resolver.resolveAll(leads2)

      expect(resolved1[0].canonicalCompanyId).toBe(resolved2[0].canonicalCompanyId)
    })
  })

  describe('resolveAll', () => {
    it('INN takes precedence over name-based ID', async () => {
      const leads = [
        makeLead({ id: 'l1', inn: '7707083893', companyName: 'Сбербанк' }),
        makeLead({ id: 'l2', companyName: 'Сбербанк' }),
      ]
      const resolved = await resolver.resolveAll(leads)
      // Lead with INN gets inn-based ID
      expect(resolved[0].canonicalCompanyId).toBe('inn-7707083893')
      // Lead without INN gets name-based ID
      expect(resolved[1].canonicalCompanyId).toMatch(/^co-/)
    })

    it('two leads with same valid INN resolve to same canonical ID', async () => {
      const leads = [
        makeLead({ id: 'l1', inn: '7707083893', companyName: 'Сбербанк' }),
        makeLead({ id: 'l2', inn: '7707083893', companyName: 'ПАО Сбербанк' }),
      ]
      const resolved = await resolver.resolveAll(leads)
      expect(resolved[0].canonicalCompanyId).toBe(resolved[1].canonicalCompanyId)
      expect(resolved[0].canonicalCompanyId).toBe('inn-7707083893')
    })

    it('preserves all original lead properties', async () => {
      const lead = makeLead({
        id: 'l1',
        companyId: 'co-1',
        companyName: 'Test',
        score: 0.9,
        confidence: 'A',
      })
      const resolved = await resolver.resolveAll([lead])
      expect(resolved[0].id).toBe('l1')
      expect(resolved[0].companyId).toBe('co-1')
      expect(resolved[0].companyName).toBe('Test')
      expect(resolved[0].score).toBe(0.9)
      expect(resolved[0].confidence).toBe('A')
      expect(resolved[0].canonicalCompanyId).toBeDefined()
    })

    it('handles empty leads array', async () => {
      const resolved = await resolver.resolveAll([])
      expect(resolved).toEqual([])
    })
  })
})
