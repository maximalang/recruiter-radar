import {
  canonicalizeOpportunityUrl,
  canonicalJsonStringify,
  hashCanonicalJson,
} from '@/lib/opportunities/canonical-hash'

describe('canonical opportunity input hashing', () => {
  it('is stable for reordered object keys and set-like arrays', () => {
    const first = {
      profile: { specialization: 'IT', regions: ['Москва', 'Казань'] },
      evidence: ['12', '11'],
    }
    const second = {
      evidence: ['11', '12'],
      profile: { regions: ['Казань', 'Москва'], specialization: 'IT' },
    }

    expect(canonicalJsonStringify(second)).toBe(canonicalJsonStringify(first))
    expect(hashCanonicalJson(second)).toBe(hashCanonicalJson(first))
  })

  it('canonicalizes tracking parameters and trailing slashes consistently', () => {
    expect(canonicalizeOpportunityUrl(
      'https://example.test/jobs/java/?utm_source=hh&ref=feed#details',
    )).toBe('https://example.test/jobs/java')
    expect(canonicalizeOpportunityUrl(
      'https://example.test/jobs/java?source=careers',
    )).toBe('https://example.test/jobs/java')
  })
})
