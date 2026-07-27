/** @jest-environment node */

import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/outcome-repository', () => ({
  recordOpportunityOutcome: jest.fn(),
  resolveOpportunityPublicReference: jest.fn(),
  OutcomeIdempotencyConflictError: class OutcomeIdempotencyConflictError extends Error {
    code = 'idempotency_key_conflict'
  },
  OutcomeTransitionConflictError: class OutcomeTransitionConflictError extends Error {
    code = 'outcome_transition_conflict'
  },
  OutcomeSupersededConflictError: class OutcomeSupersededConflictError extends Error {
    code = 'opportunity_superseded'
  },
}))

import {
  recordOpportunityOutcome,
  resolveOpportunityPublicReference,
} from '@/lib/opportunities/outcome-repository'
import { POST } from '@/app/api/opportunities/outcomes/external/route'

const SECRET = 'test-only-outcome-secret'
const OPPORTUNITY_REF = '2bc92f8e-8930-4af1-b743-14c0c0df2650'
const mockedRecord = jest.mocked(recordOpportunityOutcome)
const mockedResolve = jest.mocked(resolveOpportunityPublicReference)

describe('external opportunity outcome ingestion', () => {
  const original = {
    engine: process.env.OPPORTUNITY_ENGINE_V1_ENABLED,
    outcomes: process.env.OPPORTUNITY_OUTCOMES_ENABLED,
    external: process.env.OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED,
    secret: process.env.OPPORTUNITY_OUTCOMES_WEBHOOK_SECRET,
  }

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_WEBHOOK_SECRET = SECRET
    jest.clearAllMocks()
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', original.engine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', original.outcomes)
    restore('OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED', original.external)
    restore('OPPORTUNITY_OUTCOMES_WEBHOOK_SECRET', original.secret)
  })

  it('remains hidden while the external flag is disabled', async () => {
    process.env.OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED = 'false'
    const response = await POST(signedRequest(validBody()))
    expect(response.status).toBe(404)
    expect(mockedResolve).not.toHaveBeenCalled()
  })

  it('rejects an invalid signature before resolving an opportunity', async () => {
    const body = validBody()
    const response = await POST(signedRequest(body, { signature: 'sha256=bad' }))
    expect(response.status).toBe(401)
    expect(mockedResolve).not.toHaveBeenCalled()
  })

  it('uses X-Radar-Event-Id as the replay nonce', async () => {
    const body = validBody()
    const response = await POST(signedRequest(body, { eventId: 'evt_other' }))
    expect(response.status).toBe(400)
    expect(mockedResolve).not.toHaveBeenCalled()
  })

  it('records a normalized external outcome without exposing internal IDs', async () => {
    mockedResolve.mockResolvedValue({ ownerId: '7', opportunityId: '10' })
    mockedRecord.mockResolvedValue(recordedResult(false))
    const body = validBody()
    const response = await POST(signedRequest(body))

    expect(response.status).toBe(201)
    expect(mockedResolve).toHaveBeenCalledWith(OPPORTUNITY_REF)
    expect(mockedRecord).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'external',
      externalSystem: 'n8n',
      externalEventId: 'evt_123',
      payload: expect.objectContaining({
        idempotencyKey: 'n8n:evt_123',
        metadata: { source: 'crm_callback' },
      }),
    }))
    expect(JSON.stringify(await response.json())).not.toContain('lastEventId')
  })

  it('returns 200 when the external event is replayed safely', async () => {
    mockedResolve.mockResolvedValue({ ownerId: '7', opportunityId: '10' })
    mockedRecord.mockResolvedValue(recordedResult(true))
    const response = await POST(signedRequest(validBody()))
    expect(response.status).toBe(200)
  })
})

function validBody() {
  return {
    externalSystem: 'n8n',
    externalEventId: 'evt_123',
    opportunityRef: OPPORTUNITY_REF,
    eventType: 'replied',
    occurredAt: new Date().toISOString(),
    metadata: { source: 'crm_callback' },
  }
}

function signedRequest(
  body: ReturnType<typeof validBody>,
  override: { signature?: string; eventId?: string } = {},
) {
  const raw = JSON.stringify(body)
  const signature = `sha256=${createHmac('sha256', SECRET)
    .update(raw)
    .digest('hex')}`
  return new NextRequest(
    'https://recruiter-radar.ru/api/opportunities/outcomes/external',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-radar-event': 'opportunity.outcome',
        'x-radar-event-id': override.eventId ?? body.externalEventId,
        'x-radar-timestamp': new Date().toISOString(),
        'x-radar-signature': override.signature ?? signature,
      },
      body: raw,
    },
  )
}

function recordedResult(idempotent: boolean) {
  return {
    idempotent,
    event: {
      id: '21', eventType: 'replied' as const, previousStage: 'contacted' as const,
      newStage: 'replied' as const, occurredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(), actorType: 'external' as const,
      reasonCode: null, channel: null, valueMinor: null, currency: null,
      metadata: { source: 'crm_callback' },
    },
    state: {
      currentStage: 'replied' as const, lastEventId: '21',
      lastEventAt: new Date().toISOString(), firstShownAt: null,
      firstOpenedAt: null, acceptedAt: new Date().toISOString(),
      contactedAt: new Date().toISOString(), repliedAt: new Date().toISOString(),
      meetingAt: null, proposalAt: null, wonAt: null, lostAt: null,
      dismissReasonCode: null, lostReasonCode: null, dealValueMinor: null,
      currency: null,
    },
  }
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
