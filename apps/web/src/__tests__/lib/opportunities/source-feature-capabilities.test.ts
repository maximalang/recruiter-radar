import { getAllSourceIds } from '@/lib/sources/source-registry'
import {
  SOURCE_FEATURE_CAPABILITIES,
  getSourceFeatureCapability,
} from '@/lib/opportunities/source-feature-capabilities'

describe('source feature capability registry', () => {
  it('covers every configured source explicitly', () => {
    expect(Object.keys(SOURCE_FEATURE_CAPABILITIES).sort())
      .toEqual(getAllSourceIds().sort())
  })

  it('distinguishes conditional vacancy observations from unsupported claims', () => {
    expect(getSourceFeatureCapability('hh', 'salary_snapshot').status)
      .toBe('conditional')
    expect(getSourceFeatureCapability('rabota-rossii', 'region').status)
      .toBe('conditional')
    expect(getSourceFeatureCapability('career-pages', 'requirements_snapshot').status)
      .toBe('unsupported')
    expect(getSourceFeatureCapability('egrul-fns', 'vacancy').status)
      .toBe('unsupported')
  })

  it('fails closed for unregistered evidence sources', () => {
    expect(getSourceFeatureCapability('mystery-feed', 'salary_snapshot'))
      .toEqual({
        status: 'unsupported',
        reason: 'SOURCE_NOT_REGISTERED',
      })
  })
})
