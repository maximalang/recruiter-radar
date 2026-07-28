import { createHmac } from 'node:crypto'

import {
  verifyExternalOutcomeSignature,
} from '@/lib/opportunities/external-outcome-security'

const NOW = new Date('2026-07-27T12:00:00.000Z')
const SECRET = 'test-only-outcome-secret'
const EVENT_ID = 'evt_123'
const RAW_BODY = JSON.stringify({
  externalSystem: 'n8n',
  externalEventId: EVENT_ID,
  opportunityRef: '2bc92f8e-8930-4af1-b743-14c0c0df2650',
  eventType: 'replied',
  occurredAt: NOW.toISOString(),
  metadata: { source: 'crm_callback' },
})

function signature(
  body = RAW_BODY,
  timestamp = NOW.toISOString(),
  eventId = EVENT_ID,
) {
  return `sha256=${createHmac('sha256', SECRET)
    .update(`${timestamp}.${eventId}.${body}`)
    .digest('hex')}`
}

describe('external outcome signature', () => {
  it('accepts a timestamp, nonce, and raw-body bound HMAC', () => {
    expect(verifyExternalOutcomeSignature({
      rawBody: RAW_BODY,
      timestamp: NOW.toISOString(),
      eventId: EVENT_ID,
      signature: signature(),
      secret: SECRET,
      now: NOW,
    })).toBe(true)
  })

  it('rejects stale timestamps', () => {
    expect(verifyExternalOutcomeSignature({
      rawBody: RAW_BODY,
      timestamp: '2026-07-27T11:54:59.000Z',
      eventId: EVENT_ID,
      signature: signature(
        RAW_BODY,
        '2026-07-27T11:54:59.000Z',
      ),
      secret: SECRET,
      now: NOW,
    })).toBe(false)
  })

  it('rejects malformed or mismatched signatures without throwing', () => {
    expect(verifyExternalOutcomeSignature({
      rawBody: RAW_BODY,
      timestamp: NOW.toISOString(),
      eventId: EVENT_ID,
      signature: 'sha256=bad',
      secret: SECRET,
      now: NOW,
    })).toBe(false)
    expect(verifyExternalOutcomeSignature({
      rawBody: `${RAW_BODY} `,
      timestamp: NOW.toISOString(),
      eventId: EVENT_ID,
      signature: signature(),
      secret: SECRET,
      now: NOW,
    })).toBe(false)
  })

  it('rejects a fresh timestamp or nonce that was not part of the signature', () => {
    expect(verifyExternalOutcomeSignature({
      rawBody: RAW_BODY,
      timestamp: '2026-07-27T12:00:01.000Z',
      eventId: EVENT_ID,
      signature: signature(),
      secret: SECRET,
      now: NOW,
    })).toBe(false)
    expect(verifyExternalOutcomeSignature({
      rawBody: RAW_BODY,
      timestamp: NOW.toISOString(),
      eventId: 'evt_other',
      signature: signature(),
      secret: SECRET,
      now: NOW,
    })).toBe(false)
  })
})
