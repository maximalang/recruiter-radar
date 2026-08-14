import { getSourceRegistry } from '@/lib/sources/source-registry'
import {
  canOriginateActionableLead,
  getCanonicalSourcePolicy,
  isDefaultGeneratorSource,
} from '@/lib/sources/source-policy'

describe('canonical source policy adapter', () => {
  it('defines policy for every registered runtime source', () => {
    for (const source of getSourceRegistry()) {
      expect(getCanonicalSourcePolicy(source.id)).toEqual(expect.objectContaining({
        priority: expect.stringMatching(/^P[1-3]$/),
        defaultConfidence: expect.any(Number),
        leadEligibility: expect.any(String),
        promotionStatus: expect.any(String),
      }))
    }
  })

  it('admits only digest-allowed hiring evidence as actionable origins', () => {
    expect(getSourceRegistry().filter(source => canOriginateActionableLead(source.id)).map(source => source.id))
      .toEqual([
        'hh',
        'superjob',
        'career-pages',
        'greenhouse',
        'lever',
        'ashby',
        'recruitee',
        'workable',
        'smartrecruiters',
        'rabota-rossii',
      ])
  })

  it('keeps entity enrichment in defaults without allowing it to originate a lead', () => {
    expect(isDefaultGeneratorSource('egrul-fns')).toBe(true)
    expect(canOriginateActionableLead('egrul-fns')).toBe(false)
  })

  it('fails closed for unknown sources', () => {
    expect(getCanonicalSourcePolicy('unknown-source')).toBeNull()
    expect(canOriginateActionableLead('unknown-source')).toBe(false)
    expect(isDefaultGeneratorSource('unknown-source')).toBe(false)
  })
})
