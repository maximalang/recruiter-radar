/** @jest-environment node */

import { getCorrelationId } from '@/lib/api/error-contract'

describe('API error correlation IDs', () => {
  it('preserves a valid caller correlation ID', () => {
    const request = new Request('https://example.test', {
      headers: { 'x-correlation-id': 'req-1234:abcd' },
    })

    expect(getCorrelationId(request)).toBe('req-1234:abcd')
  })

  it('rejects unsafe or oversized caller-provided IDs', () => {
    const unsafe = new Request('https://example.test', {
      headers: { 'x-correlation-id': 'request-id-with spaces and unsafe/value' },
    })
    const oversized = new Request('https://example.test', {
      headers: { 'x-request-id': 'a'.repeat(129) },
    })

    const unsafeId = getCorrelationId(unsafe)
    const oversizedId = getCorrelationId(oversized)

    expect(unsafeId).not.toBe('request-id-with spaces and unsafe/value')
    expect(oversizedId).not.toBe('a'.repeat(129))
    expect(unsafeId).toMatch(/^[A-Za-z0-9._:-]+$/)
    expect(oversizedId).toMatch(/^[A-Za-z0-9._:-]+$/)
  })
})
