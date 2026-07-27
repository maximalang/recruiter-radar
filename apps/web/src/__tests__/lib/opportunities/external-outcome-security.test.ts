import { createHmac } from 'node:crypto'

import {
  verifyExternalOutcomeSignature,
} from '@/lib/opportunities/external-outcome-security'

const NOW = new Date('2026-07-27T12:00:00.000Z')
const SECRET = 'test-only-outcome-secret'
const RAW_BODY = JSON.stringify({
  externalSystem: 'n8n',
  externalEventId: 'evt_123',
  opportunityRef: '2bc92f8e-8930-4af1-b743-14c0c0df2650',
  eventType: 'replied',
  occurredAt: NOW.toISOString(),
  metadata: { source: 'crm_callback' },
})

function signature(body = RAW_BODY) {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
}

describe('external outcome signature', () => {
  it('accepts the existing X-Radar raw-body HMAC contract', () => {
    expect(verifyExternalOutcomeSignature({
      rawBody: RAW_BODY,
      timestamp: NOW.toISOString(),
      signature: signature(),
      secret: SECRET,
      now: NOW,
    })).toBe(true)
  })

  it('rejects stale timestamps', () => {
    expect(verifyExternalOutcomeSignature({
      rawBody: RAW_BODY,
      timestamp: '2026-07-27T11:54:59.000Z',
      signature: signature(),
      secret: SECRET,
      now: NOW,
    })).toBe(false)
  })

  it('rejects malformed or mismatched signatures without throwing', () => {
    expect(verifyExternalOutcomeSignature({
      rawBody: RAW_BODY,
      timestamp: NOW.toISOString(),
      signature: 'sha256=bad',
      secret: SECRET,
      now: NOW,
    })).toBe(false)
    expect(verifyExternalOutcomeSignature({
      rawBody: `${RAW_BODY} `,
      timestamp: NOW.toISOString(),
      signature: signature(),
      secret: SECRET,
      now: NOW,
    })).toBe(false)
  })
})
