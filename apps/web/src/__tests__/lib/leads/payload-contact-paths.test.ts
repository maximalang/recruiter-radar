import { extractPayloadFields } from '@/lib/leads-data'

/**
 * extractPayloadFields reads the auto-discovered contact surface out of the
 * digest_candidates payload JSON. It must tolerate snake_case + camelCase,
 * degrade to [] on missing/malformed data, and dedupe — so a thin legacy
 * payload never throws and a populated one yields the exact {category,value}
 * rows the lead-detail UI renders.
 */
describe('extractPayloadFields — contact_paths', () => {
  it('reads camelCase contact_paths from payload', () => {
    const out = extractPayloadFields({
      contactPaths: [
        { category: 'hr-email', value: 'hr@acme.ru' },
        { category: 'phone', value: '+74951234567' },
      ],
    })
    expect(out.contactPaths).toEqual([
      { category: 'hr-email', value: 'hr@acme.ru' },
      { category: 'phone', value: '+74951234567' },
    ])
  })

  it('reads snake_case contact_paths from payload', () => {
    const out = extractPayloadFields({
      contact_paths: [{ category: 'telegram', value: 'https://t.me/acme_hr' }],
    })
    expect(out.contactPaths).toEqual([
      { category: 'telegram', value: 'https://t.me/acme_hr' },
    ])
  })

  it('returns [] when contact_paths is absent (honest empty state)', () => {
    expect(extractPayloadFields({}).contactPaths).toEqual([])
    expect(extractPayloadFields(null).contactPaths).toEqual([])
    expect(extractPayloadFields(undefined).contactPaths).toEqual([])
  })

  it('drops malformed entries and dedupes by (category, value)', () => {
    const out = extractPayloadFields({
      contact_paths: [
        { category: 'hr-email', value: 'hr@acme.ru' },
        { category: 'hr-email', value: 'hr@acme.ru' }, // dup
        { category: '', value: 'blank-category' }, // bad category
        { category: 'phone', value: '' }, // bad value
        { category: 'telegram', value: 'https://t.me/x' },
        null, // non-object
      ],
    })
    expect(out.contactPaths).toEqual([
      { category: 'hr-email', value: 'hr@acme.ru' },
      { category: 'telegram', value: 'https://t.me/x' },
    ])
  })

  it('preserves the other payload fields (gate, evidence, locations)', () => {
    const out = extractPayloadFields({
      confidence_gate: 'A',
      evidence_titles: ['Backend'],
      location_names: ['Москва'],
    })
    expect(out.confidenceGate).toBe('A')
    expect(out.evidenceTitles).toEqual(['Backend'])
    expect(out.locationNames).toEqual(['Москва'])
    expect(out.contactPaths).toEqual([])
  })
})
