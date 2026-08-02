/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/authorization', () => ({
  getOpportunityAuthorizationContext: jest.fn(),
  getOpportunityDataAccessContext: jest.fn(),
}))
jest.mock('@/lib/opportunities/crm-delivery-repository', () => ({
  ...jest.requireActual('@/lib/opportunities/crm-delivery-repository'),
  deliverOpportunityToCrm: jest.fn(),
}))

import { POST } from '@/app/api/opportunities/[id]/crm-deliveries/route'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import {
  CrmDeliveryInProgressError,
  deliverOpportunityToCrm,
} from '@/lib/opportunities/crm-delivery-repository'
import { resetCrmDeliveryRateLimitsForTests } from '@/lib/opportunities/crm-delivery-rate-limit'

const mockedAuthorization = jest.mocked(getOpportunityAuthorizationContext)
const mockedAccess = jest.mocked(getOpportunityDataAccessContext)
const mockedDeliver = jest.mocked(deliverOpportunityToCrm)

describe('CRM delivery route', () => {
  const previous = {
    engine: process.env.OPPORTUNITY_ENGINE_V1_ENABLED,
    outcomes: process.env.OPPORTUNITY_OUTCOMES_ENABLED,
    workspace: process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED,
    bridge: process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED,
  }

  beforeEach(async () => {
    await resetCrmDeliveryRateLimitsForTests()
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
    process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED = 'true'
    jest.clearAllMocks()
    mockedAuthorization.mockResolvedValue({
      dataOwnerId: '7', workspaceId: '9', actorUserId: '42',
      actorRole: 'recruiter', permissions: ['opportunities:write'],
      authMode: 'auth_v2',
    })
    mockedAccess.mockReturnValue({
      ownerId: '7', workspaceId: '9', actorUserId: '42',
      actorWorkspaceId: '9', actorRoleSnapshot: 'recruiter', authMode: 'auth_v2',
    })
    mockedDeliver.mockResolvedValue({
      eventId: '0a86f77c-e41f-5d5a-a16e-b440391d2e0d',
      status: 'succeeded', httpStatus: 202, idempotent: false,
    })
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', previous.engine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', previous.outcomes)
    restore('OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED', previous.workspace)
    restore('OPPORTUNITY_CRM_BRIDGE_ENABLED', previous.bridge)
  })

  it('requires an idempotency key and sends one opportunity in the exact workspace', async () => {
    const response = await POST(request('crm-send-1'), {
      params: Promise.resolve({ id: '31' }),
    })

    expect(response.status).toBe(202)
    expect(mockedAuthorization).toHaveBeenCalledWith('opportunities:write')
    expect(mockedDeliver).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7', workspaceId: '9', opportunityId: '31',
      actorUserId: '42', idempotencyKey: 'crm-send-1',
    }), expect.any(Function))
  })

  it('rejects a missing idempotency key without a delivery attempt', async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ id: '31' }),
    })

    expect(response.status).toBe(400)
    expect(mockedDeliver).not.toHaveBeenCalled()
  })

  it('returns a retryable conflict while the idempotency claim is active', async () => {
    mockedDeliver.mockRejectedValueOnce(new CrmDeliveryInProgressError())

    const response = await POST(request('crm-send-active'), {
      params: Promise.resolve({ id: '31' }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'crm_delivery_in_progress',
    })
  })

  it('rate-limits distinct delivery attempts per workspace', async () => {
    for (let index = 0; index < 30; index += 1) {
      const response = await POST(request(`crm-send-${index}`), {
        params: Promise.resolve({ id: '31' }),
      })
      expect(response.status).toBe(202)
    }
    const limited = await POST(request('crm-send-over-limit'), {
      params: Promise.resolve({ id: '31' }),
    })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
  })
})

function request(idempotencyKey?: string) {
  return new NextRequest('https://example.test/api/opportunities/31/crm-deliveries', {
    method: 'POST',
    body: JSON.stringify({
      integrationReference: 'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c',
    }),
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
  })
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
