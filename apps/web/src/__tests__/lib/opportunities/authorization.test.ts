jest.mock('@/lib/auth-v2/authorization', () => ({
  getSession: jest.fn(),
}))
jest.mock('@/lib/runtime', () => ({
  logEvent: jest.fn(),
}))

import { getSession } from '@/lib/auth-v2/authorization'
import { logEvent } from '@/lib/runtime'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'

const mockGetSession = jest.mocked(getSession)
const mockLogEvent = jest.mocked(logEvent)

describe('opportunity authorization context', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps owner-era data access when workspace context is disabled', () => {
    expect(getOpportunityDataAccessContext({
      dataOwnerId: '7',
      workspaceId: '9',
      actorUserId: '42',
      actorRole: 'recruiter',
      permissions: ['opportunities:read', 'opportunities:write'],
      authMode: 'auth_v2',
    }, {})).toEqual({
      ownerId: '7',
      workspaceId: null,
      actorUserId: '7',
      actorWorkspaceId: null,
      actorRoleSnapshot: null,
      authMode: 'legacy',
    })
  })

  it('uses the real actor only for a complete enabled Auth v2 workspace', () => {
    expect(getOpportunityDataAccessContext({
      dataOwnerId: '7',
      workspaceId: '9',
      actorUserId: '42',
      actorRole: 'recruiter',
      permissions: ['opportunities:read', 'opportunities:write'],
      authMode: 'auth_v2',
    }, {
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
    })).toEqual({
      ownerId: '7',
      workspaceId: '9',
      actorUserId: '42',
      actorWorkspaceId: '9',
      actorRoleSnapshot: 'recruiter',
      authMode: 'auth_v2',
    })
  })

  it('fails closed instead of downgrading incomplete enabled Auth v2 context', () => {
    expect(getOpportunityDataAccessContext({
      dataOwnerId: '7',
      workspaceId: null,
      actorUserId: '42',
      actorRole: null,
      permissions: ['opportunities:read'],
      authMode: 'auth_v2',
    }, {
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
    })).toBeNull()
  })

  it('preserves the real actor, active workspace, role, and granted permissions', async () => {
    mockGetSession.mockResolvedValue({
      mode: 'auth_v2',
      userId: '42',
      dataOwnerId: '7',
      workspaceId: '9',
      role: 'recruiter',
      session: null,
    })

    await expect(
      getOpportunityAuthorizationContext('opportunities:write'),
    ).resolves.toMatchObject({
      dataOwnerId: '7',
      workspaceId: '9',
      actorUserId: '42',
      actorRole: 'recruiter',
      authMode: 'auth_v2',
      permissions: expect.arrayContaining([
        'opportunities:read',
        'opportunities:write',
      ]),
    })

    const context = await getOpportunityAuthorizationContext(
      'opportunities:write',
    )
    expect(context?.permissions).not.toContain('billing:manage')
    expect(mockGetSession).toHaveBeenCalledWith({
      permission: 'opportunities:write',
    })
  })

  it('keeps roleless compatibility modes explicit without inventing a role', async () => {
    mockGetSession.mockResolvedValue({
      mode: 'legacy',
      userId: '11',
      dataOwnerId: '11',
      workspaceId: null,
      role: null,
      session: null,
    })

    await expect(
      getOpportunityAuthorizationContext('opportunities:read'),
    ).resolves.toMatchObject({
      dataOwnerId: '11',
      workspaceId: null,
      actorUserId: '11',
      actorRole: null,
      authMode: 'legacy',
      permissions: expect.arrayContaining([
        'opportunities:read',
        'opportunities:write',
      ]),
    })
  })

  it('fails closed when the session has no required permission', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(
      getOpportunityAuthorizationContext('opportunities:write'),
    ).resolves.toBeNull()
    expect(mockLogEvent).toHaveBeenCalledWith(
      'opportunity.authorization_rejected',
      { permission: 'opportunities:write' },
    )
  })
})
