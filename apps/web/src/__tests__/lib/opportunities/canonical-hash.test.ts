import {
  canonicalizeOpportunityUrl,
  canonicalJsonStringify,
  hashCanonicalJson,
} from '@/lib/opportunities/canonical-hash'

describe('canonical opportunity input hashing', () => {
  it('is stable for reordered object keys', () => {
    const first = {
      profile: { specialization: 'IT', regions: ['Москва', 'Казань'] },
      evidence: ['12', '11'],
    }
    const second = {
      evidence: ['12', '11'],
      profile: { regions: ['Москва', 'Казань'], specialization: 'IT' },
    }

    expect(canonicalJsonStringify(second)).toBe(canonicalJsonStringify(first))
    expect(hashCanonicalJson(second)).toBe(hashCanonicalJson(first))
  })

  it('preserves the order of semantically ordered arrays', () => {
    const first = { steps: ['contact', 'follow-up'] }
    const second = { steps: ['follow-up', 'contact'] }

    expect(canonicalJsonStringify(second)).not.toBe(canonicalJsonStringify(first))
    expect(hashCanonicalJson(second)).not.toBe(hashCanonicalJson(first))
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
