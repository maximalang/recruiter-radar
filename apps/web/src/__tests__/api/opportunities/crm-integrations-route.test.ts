/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/authorization', () => ({
  getOpportunityAuthorizationContext: jest.fn(),
  getOpportunityDataAccessContext: jest.fn(),
}))
jest.mock('@/lib/opportunities/crm-integration-repository', () => ({
  createCrmIntegration: jest.fn(),
}))

import { POST } from '@/app/api/opportunities/integrations/route'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { createCrmIntegration } from '@/lib/opportunities/crm-integration-repository'

const mockedAuthorization = jest.mocked(getOpportunityAuthorizationContext)
const mockedAccess = jest.mocked(getOpportunityDataAccessContext)
const mockedCreate = jest.mocked(createCrmIntegration)

describe('CRM integration create route', () => {
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
    mockedAuthorization.mockResolvedValue({
      dataOwnerId: '7', workspaceId: '9', actorUserId: '42',
      actorRole: 'admin', permissions: ['workspace:update'], authMode: 'auth_v2',
    })
    mockedAccess.mockReturnValue({
      ownerId: '7', workspaceId: '9', actorUserId: '42',
      actorWorkspaceId: '9', actorRoleSnapshot: 'admin', authMode: 'auth_v2',
    })
    mockedCreate.mockResolvedValue({
      integration: {
        reference: 'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c',
        provider: 'generic', displayName: 'CRM', outboundWebhookUrl: null,
        status: 'active', createdAt: '2026-08-01T12:00:00.000Z',
      },
      credential: {
        reference: '49c9fae8-d1ed-463f-854c-8965a8cf331d', secret: `rrc_${'a'.repeat(43)}`,
        secretPrefix: 'aaaaaaaa', status: 'active', allowedEventTypes: ['won'],
        rateLimitPolicy: { maxRequests: 60, windowSeconds: 60 },
        replayWindowSeconds: 300, createdAt: '2026-08-01T12:00:00.000Z',
      },
    })
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', previous.engine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', previous.outcomes)
    restore('OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED', previous.workspace)
    restore('OPPORTUNITY_CRM_BRIDGE_ENABLED', previous.bridge)
  })

  it('creates an integration for the exact Auth v2 workspace', async () => {
    const response = await POST(request({
      provider: 'generic', displayName: 'CRM', allowedEventTypes: ['won'],
    }))

    expect(response.status).toBe(201)
    expect(mockedAuthorization).toHaveBeenCalledWith('workspace:update')
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: '9', actorUserId: '42',
    }))
    expect(await response.json()).toEqual(expect.objectContaining({
      credential: expect.objectContaining({ secret: expect.stringMatching(/^rrc_/) }),
    }))
  })

  it('stays undiscoverable while the bridge flag is disabled', async () => {
    process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED = 'false'
    const response = await POST(request({
      provider: 'generic', displayName: 'CRM', allowedEventTypes: ['won'],
    }))
    expect(response.status).toBe(404)
    expect(mockedCreate).not.toHaveBeenCalled()
  })
})

function request(body: unknown) {
  return new NextRequest('https://recruiter-radar.ru/api/opportunities/integrations', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
