/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/crm-callback-repository', () => ({
  CrmCallbackAuthenticationError: class CrmCallbackAuthenticationError extends Error {
    readonly code = 'invalid_signature'
  },
  CrmCallbackReplayConflictError: class CrmCallbackReplayConflictError extends Error {
    readonly code = 'crm_callback_replay_conflict'
  },
  ingestCrmOutcomeCallback: jest.fn(),
}))
jest.mock('@/lib/runtime', () => ({
  logError: jest.fn(),
  logEvent: jest.fn(),
}))

import { POST } from '@/app/api/opportunities/integrations/[integrationReference]/outcomes/route'
import {
  CrmCallbackAuthenticationError,
  CrmCallbackReplayConflictError,
  ingestCrmOutcomeCallback,
} from '@/lib/opportunities/crm-callback-repository'
import { logEvent } from '@/lib/runtime'

const mockedIngest = jest.mocked(ingestCrmOutcomeCallback)
const mockedLogEvent = jest.mocked(logEvent)
const INTEGRATION_REFERENCE = 'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c'

describe('tenant CRM callback route', () => {
  const previous = {
    engine: process.env.OPPORTUNITY_ENGINE_V1_ENABLED,
    outcomes: process.env.OPPORTUNITY_OUTCOMES_ENABLED,
    workspace: process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED,
    bridge: process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED,
  }

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
    process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED = 'true'
    jest.clearAllMocks()
    mockedIngest.mockResolvedValue({
      status: 200, code: 'accepted', accepted: true, idempotent: false,
    })
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', previous.engine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', previous.outcomes)
    restore('OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED', previous.workspace)
    restore('OPPORTUNITY_CRM_BRIDGE_ENABLED', previous.bridge)
  })

  it('passes the exact raw body and signed tenant identity to the repository', async () => {
    const request = callbackRequest()
    const response = await POST(request, {
      params: Promise.resolve({ integrationReference: INTEGRATION_REFERENCE }),
    })

    expect(response.status).toBe(200)
    expect(mockedIngest).toHaveBeenCalledWith(expect.objectContaining({
      integrationReference: INTEGRATION_REFERENCE,
      credentialReference: '49c9fae8-d1ed-463f-854c-8965a8cf331d',
      timestamp: '1785585600',
      eventId: 'amo-12345',
      rawBody: '{"opportunityReference":"723d4eef-2da8-4428-ad2d-4cb87fc48bd1","eventType":"won"}',
      signature: `v1=${'a'.repeat(64)}`,
    }))
  })

  it('keeps the callback undiscoverable while the bridge is disabled', async () => {
    process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED = 'false'
    const response = await POST(callbackRequest(), {
      params: Promise.resolve({ integrationReference: INTEGRATION_REFERENCE }),
    })

    expect(response.status).toBe(404)
    expect(mockedIngest).not.toHaveBeenCalled()
  })

  it('cancels a chunked request as soon as the callback body exceeds the limit', async () => {
    let pulls = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(8 * 1024))
        if (pulls === 4) controller.close()
      },
      cancel() {
        cancelled = true
      },
    })
    const request = new NextRequest('https://example.test/callback', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as unknown as ConstructorParameters<typeof NextRequest>[1])

    const response = await POST(request, {
      params: Promise.resolve({ integrationReference: INTEGRATION_REFERENCE }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'payload_too_large' })
    expect(cancelled).toBe(true)
    expect(mockedIngest).not.toHaveBeenCalled()
  })

  it.each([
    [new CrmCallbackAuthenticationError(), 401, 'invalid_signature'],
    [new CrmCallbackReplayConflictError(), 409, 'crm_callback_replay_conflict'],
  ])('counts privacy-safe authentication and replay rejection', async (
    error,
    expectedStatus,
    expectedCode,
  ) => {
    mockedIngest.mockRejectedValueOnce(error)

    const response = await POST(callbackRequest(), {
      params: Promise.resolve({ integrationReference: INTEGRATION_REFERENCE }),
    })

    expect(response.status).toBe(expectedStatus)
    expect(mockedLogEvent).toHaveBeenCalledWith(
      'opportunity_crm.callback_rejected',
      {
        status: expectedStatus,
        code: expectedCode,
        callbacksRejected: 1,
      },
    )
  })
})

function callbackRequest() {
  return new NextRequest('https://example.test/callback', {
    method: 'POST',
    body: '{"opportunityReference":"723d4eef-2da8-4428-ad2d-4cb87fc48bd1","eventType":"won"}',
    headers: {
      'content-type': 'application/json',
      'x-rr-credential-id': '49c9fae8-d1ed-463f-854c-8965a8cf331d',
      'x-rr-webhook-timestamp': '1785585600',
      'x-rr-webhook-id': 'amo-12345',
      'x-rr-signature': `v1=${'a'.repeat(64)}`,
    },
  })
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
