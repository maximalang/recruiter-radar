/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/crm-callback-repository', () => ({
  CrmCallbackAuthenticationError: class CrmCallbackAuthenticationError extends Error {},
  CrmCallbackReplayConflictError: class CrmCallbackReplayConflictError extends Error {},
  ingestCrmOutcomeCallback: jest.fn(),
}))

import { POST } from '@/app/api/opportunities/integrations/[integrationReference]/outcomes/route'
import { ingestCrmOutcomeCallback } from '@/lib/opportunities/crm-callback-repository'

const mockedIngest = jest.mocked(ingestCrmOutcomeCallback)
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
