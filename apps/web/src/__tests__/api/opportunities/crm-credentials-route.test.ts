/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/authorization', () => ({
  getOpportunityAuthorizationContext: jest.fn(),
  getOpportunityDataAccessContext: jest.fn(),
}))
jest.mock('@/lib/opportunities/crm-integration-repository', () => ({
  rotateCrmCredential: jest.fn(),
  revokeCrmCredential: jest.fn(),
}))

import { DELETE } from '@/app/api/opportunities/integrations/[integrationReference]/credentials/[credentialReference]/route'
import { POST } from '@/app/api/opportunities/integrations/[integrationReference]/credentials/rotate/route'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import {
  revokeCrmCredential,
  rotateCrmCredential,
} from '@/lib/opportunities/crm-integration-repository'

const INTEGRATION_REFERENCE = 'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c'
const CREDENTIAL_REFERENCE = '49c9fae8-d1ed-463f-854c-8965a8cf331d'
const mockedAuthorization = jest.mocked(getOpportunityAuthorizationContext)
const mockedAccess = jest.mocked(getOpportunityDataAccessContext)
const mockedRotate = jest.mocked(rotateCrmCredential)
const mockedRevoke = jest.mocked(revokeCrmCredential)

describe('CRM credential lifecycle routes', () => {
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
      actorRole: 'owner', permissions: ['workspace:update'], authMode: 'auth_v2',
    })
    mockedAccess.mockReturnValue({
      ownerId: '7', workspaceId: '9', actorUserId: '42',
      actorWorkspaceId: '9', actorRoleSnapshot: 'owner', authMode: 'auth_v2',
    })
    mockedRotate.mockResolvedValue({
      integration: {
        reference: INTEGRATION_REFERENCE, provider: 'generic', displayName: 'CRM',
        outboundWebhookUrl: null, status: 'active',
        createdAt: '2026-08-01T12:00:00.000Z',
      },
      credential: {
        reference: CREDENTIAL_REFERENCE, secret: `rrc_${'a'.repeat(43)}`,
        secretPrefix: 'aaaaaaaa', status: 'active', allowedEventTypes: ['won'],
        rateLimitPolicy: { maxRequests: 60, windowSeconds: 60 },
        replayWindowSeconds: 300, createdAt: '2026-08-01T12:01:00.000Z',
      },
    })
    mockedRevoke.mockResolvedValue(true)
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', previous.engine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', previous.outcomes)
    restore('OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED', previous.workspace)
    restore('OPPORTUNITY_CRM_BRIDGE_ENABLED', previous.bridge)
  })

  it('rotates within the exact workspace and disables response caching', async () => {
    const response = await POST(new NextRequest('https://example.test'), {
      params: Promise.resolve({ integrationReference: INTEGRATION_REFERENCE }),
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mockedRotate).toHaveBeenCalledWith({
      workspaceId: '9', actorUserId: '42',
      integrationReference: INTEGRATION_REFERENCE,
    })
  })

  it('revokes only the requested public credential reference', async () => {
    const response = await DELETE(new NextRequest('https://example.test'), {
      params: Promise.resolve({
        integrationReference: INTEGRATION_REFERENCE,
        credentialReference: CREDENTIAL_REFERENCE,
      }),
    })

    expect(response.status).toBe(204)
    expect(mockedRevoke).toHaveBeenCalledWith({
      workspaceId: '9', actorUserId: '42',
      integrationReference: INTEGRATION_REFERENCE,
      credentialReference: CREDENTIAL_REFERENCE,
    })
  })

  it('keeps both routes hidden when the bridge is disabled', async () => {
    process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED = 'false'
    const params = Promise.resolve({
      integrationReference: INTEGRATION_REFERENCE,
      credentialReference: CREDENTIAL_REFERENCE,
    })
    const [rotateResponse, revokeResponse] = await Promise.all([
      POST(new NextRequest('https://example.test'), { params }),
      DELETE(new NextRequest('https://example.test'), { params }),
    ])

    expect(rotateResponse.status).toBe(404)
    expect(revokeResponse.status).toBe(404)
    expect(mockedRotate).not.toHaveBeenCalled()
    expect(mockedRevoke).not.toHaveBeenCalled()
  })
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
