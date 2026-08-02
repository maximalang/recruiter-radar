/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/auth-v2/authorization', () => {
  const getAuthorizedOwnerId = jest.fn()
  return {
    getAuthorizedOwnerId,
    getSession: jest.fn(async ({ permission }) => {
      const ownerId = await getAuthorizedOwnerId(permission)
      return ownerId ? {
        mode: 'legacy',
        userId: ownerId,
        dataOwnerId: ownerId,
        workspaceId: null,
        role: null,
        session: null,
      } : null
    }),
  }
})
jest.mock('@/lib/opportunities/repository', () => ({
  listOpportunities: jest.fn(),
  getOpportunityById: jest.fn(),
  applyOpportunityAction: jest.fn(),
  OpportunityActionConflictError: class OpportunityActionConflictError extends Error {},
  OpportunitySupersededConflictError: class OpportunitySupersededConflictError extends Error {
    code = 'opportunity_superseded'
  },
  OpportunityTransitionConflictError: class OpportunityTransitionConflictError extends Error {},
  isOpportunityAction: (value: unknown) =>
    ['accepted', 'dismissed', 'snoozed', 'contacted'].includes(String(value)),
}))
jest.mock('@/lib/runtime', () => ({
  logError: jest.fn(),
  logEvent: jest.fn(),
}))

import {
  getAuthorizedOwnerId,
  getSession,
} from '@/lib/auth-v2/authorization'
import {
  applyOpportunityAction,
  getOpportunityById,
  listOpportunities,
} from '@/lib/opportunities/repository'
import {
  OutcomeIdempotencyConflictError,
  OutcomeTransitionConflictError,
} from '@/lib/opportunities/outcome-repository'
import { logEvent } from '@/lib/runtime'
import { GET as list } from '@/app/api/opportunities/route'
import { GET as detail } from '@/app/api/opportunities/[id]/route'
import { POST as action } from '@/app/api/opportunities/[id]/action/route'

const mockedOwner = jest.mocked(getAuthorizedOwnerId)
const mockedSession = jest.mocked(getSession)
const mockedList = jest.mocked(listOpportunities)
const mockedDetail = jest.mocked(getOpportunityById)
const mockedAction = jest.mocked(applyOpportunityAction)
const mockedLogEvent = jest.mocked(logEvent)

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://recruiter-radar.ru${path}`, init)
}

describe('opportunities API', () => {
  const originalFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const originalOutcomes = process.env.OPPORTUNITY_OUTCOMES_ENABLED
  const originalCanaryOwners = process.env.OPPORTUNITY_CANARY_OWNER_IDS
  const originalWorkspaceContext =
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED
  const originalWorkflow = process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    delete process.env.OPPORTUNITY_CANARY_OWNER_IDS
    delete process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED
    delete process.env.OPPORTUNITY_OUTCOMES_ENABLED
    delete process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED
    jest.clearAllMocks()
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.OPPORTUNITY_ENGINE_V1_ENABLED
    else process.env.OPPORTUNITY_ENGINE_V1_ENABLED = originalFlag
    if (originalCanaryOwners === undefined) {
      delete process.env.OPPORTUNITY_CANARY_OWNER_IDS
    } else {
      process.env.OPPORTUNITY_CANARY_OWNER_IDS = originalCanaryOwners
    }
    if (originalWorkspaceContext === undefined) {
      delete process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED
    } else {
      process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED =
        originalWorkspaceContext
    }
    if (originalOutcomes === undefined) {
      delete process.env.OPPORTUNITY_OUTCOMES_ENABLED
    } else {
      process.env.OPPORTUNITY_OUTCOMES_ENABLED = originalOutcomes
    }
    if (originalWorkflow === undefined) {
      delete process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED
    } else {
      process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED = originalWorkflow
    }
  })

  it('is not discoverable when the feature is disabled', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    const response = await list(request('/api/opportunities'))
    expect(response.status).toBe(404)
    expect(mockedList).not.toHaveBeenCalled()
  })

  it('allows only the configured canary owner while the global flag is false', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.OPPORTUNITY_CANARY_OWNER_IDS = '7'
    mockedList.mockResolvedValue({
      opportunities: [],
      total: 0,
      page: 1,
      pageSize: 20,
      nextOffset: null,
    })

    mockedOwner.mockResolvedValueOnce('8')
    const denied = await list(request('/api/opportunities'))
    expect(denied.status).toBe(404)
    expect(mockedList).not.toHaveBeenCalled()

    mockedOwner.mockResolvedValueOnce('7')
    const allowed = await list(request('/api/opportunities'))
    expect(allowed.status).toBe(200)
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
    }))
  })

  it('returns detail only for the configured canary owner', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.OPPORTUNITY_CANARY_OWNER_IDS = '7'
    mockedDetail.mockResolvedValue(null)

    mockedOwner.mockResolvedValueOnce('8')
    const denied = await detail(
      request('/api/opportunities/10'),
      { params: Promise.resolve({ id: '10' }) },
    )
    expect(denied.status).toBe(404)
    expect(mockedDetail).not.toHaveBeenCalled()

    mockedOwner.mockResolvedValueOnce('7')
    const allowed = await detail(
      request('/api/opportunities/10'),
      { params: Promise.resolve({ id: '10' }) },
    )
    expect(allowed.status).toBe(404)
    expect(mockedDetail).toHaveBeenCalledWith({
      ownerId: '7',
      workspaceId: null,
      opportunityId: '10',
    })
  })

  it('allows an action only for the configured canary owner', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.OPPORTUNITY_CANARY_OWNER_IDS = '7'
    mockedAction.mockResolvedValue(null)

    mockedOwner.mockResolvedValueOnce('8')
    const denied = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'accepted' }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )
    expect(denied.status).toBe(404)
    expect(mockedAction).not.toHaveBeenCalled()

    mockedOwner.mockResolvedValueOnce('7')
    const allowed = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'accepted' }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )
    expect(allowed.status).toBe(404)
    expect(mockedAction).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      action: 'accepted',
    }))
  })

  it('passes active workspace and real actor through an Auth v2 action', async () => {
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    mockedSession.mockResolvedValueOnce({
      mode: 'auth_v2',
      userId: '42',
      dataOwnerId: '7',
      workspaceId: '9',
      role: 'recruiter',
      session: null,
    })
    mockedAction.mockResolvedValue(null)

    const response = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        headers: { 'idempotency-key': 'accepted:workspace-actor' },
        body: JSON.stringify({ action: 'accepted' }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )

    expect(response.status).toBe(404)
    expect(mockedAction).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      workspaceId: '9',
      actorUserId: '42',
      actorWorkspaceId: '9',
      actorRoleSnapshot: 'recruiter',
      authMode: 'auth_v2',
    }))
  })

  it('uses Today as the default only for an enabled Phase 7 workspace', async () => {
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED = 'true'
    mockedSession.mockResolvedValueOnce({
      mode: 'auth_v2',
      userId: '42',
      dataOwnerId: '7',
      workspaceId: '9',
      role: 'recruiter',
      session: null,
    })
    mockedList.mockResolvedValue({
      opportunities: [],
      total: 0,
      page: 1,
      pageSize: 20,
      nextOffset: null,
    })

    const response = await list(request('/api/opportunities'))

    expect(response.status).toBe(200)
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      workspaceId: '9',
      morningBriefOnly: false,
      view: 'today',
    }))
  })

  it('requires a signed owner session', async () => {
    mockedOwner.mockResolvedValue(null)
    const response = await list(request('/api/opportunities'))
    expect(response.status).toBe(401)
    expect(mockedList).not.toHaveBeenCalled()
  })

  it('passes only normalized filters and the session owner to the repository', async () => {
    mockedOwner.mockResolvedValue('7')
    mockedList.mockResolvedValue({
      opportunities: [],
      total: 0,
      page: 2,
      pageSize: 25,
      nextOffset: null,
    })
    const response = await list(request(
      '/api/opportunities?status=new,invalid&gate=A&minimumScore=0.6&page=2&pageSize=25&profile=8',
    ))

    expect(response.status).toBe(200)
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      morningBriefOnly: true,
      clientProfileId: '8',
      statuses: ['new'],
      confidenceGate: 'A',
      minimumScore: 0.6,
      page: 2,
      pageSize: 25,
    }))
  })

  it('supports the documented limit/cursor and filter parameter names', async () => {
    mockedOwner.mockResolvedValue('7')
    mockedList.mockResolvedValue({
      opportunities: [],
      total: 40,
      page: 3,
      pageSize: 10,
      nextOffset: 30,
    })
    const cursor = Buffer.from(
      JSON.stringify({ version: 1, offset: 20 }),
      'utf8',
    ).toString('base64url')
    const response = await list(request(
      `/api/opportunities?limit=10&cursor=${cursor}&confidenceGate=B&organizationId=9`,
    ))

    expect(response.status).toBe(200)
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      morningBriefOnly: true,
      pageSize: 10,
      offset: 20,
      confidenceGate: 'B',
      organizationId: '9',
    }))
    const payload = await response.json() as { nextCursor: string | null }
    expect(payload.nextCursor).toBe(
      Buffer.from(
        JSON.stringify({ version: 1, offset: 30 }),
        'utf8',
      ).toString('base64url'),
    )
  })

  it('passes a typed lifecycle view without weakening the session owner scope', async () => {
    mockedOwner.mockResolvedValue('7')
    mockedList.mockResolvedValue({
      opportunities: [],
      total: 0,
      page: 1,
      pageSize: 50,
      nextOffset: null,
    })

    const response = await list(request('/api/opportunities?view=pipeline'))

    expect(response.status).toBe(200)
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      view: 'pipeline',
    }))
  })

  it('rejects an unknown lifecycle view', async () => {
    mockedOwner.mockResolvedValue('7')

    const response = await list(request('/api/opportunities?view=crm'))

    expect(response.status).toBe(400)
    expect(mockedList).not.toHaveBeenCalled()
  })

  it('rejects out-of-range database filters instead of widening the query', async () => {
    mockedOwner.mockResolvedValue('7')

    const response = await list(request(
      '/api/opportunities?profile=9223372036854775808',
    ))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_filter' })
    expect(mockedList).not.toHaveBeenCalled()
  })

  it('rejects malformed cursors instead of silently resetting pagination', async () => {
    mockedOwner.mockResolvedValue('7')
    const response = await list(request('/api/opportunities?cursor=not-a-cursor'))

    expect(response.status).toBe(400)
    expect(mockedList).not.toHaveBeenCalled()
  })

  it('returns 404 for a foreign detail without leaking its existence', async () => {
    mockedOwner.mockResolvedValue('7')
    mockedDetail.mockResolvedValue(null)
    const response = await detail(
      request('/api/opportunities/99'),
      { params: Promise.resolve({ id: '99' }) },
    )
    expect(response.status).toBe(404)
    expect(mockedDetail).toHaveBeenCalledWith({
      ownerId: '7',
      workspaceId: null,
      opportunityId: '99',
    })
  })

  it('rejects PostgreSQL bigint overflow ids before repository access', async () => {
    mockedOwner.mockResolvedValue('7')
    const overflowId = '9223372036854775808'

    const detailResponse = await detail(
      request(`/api/opportunities/${overflowId}`),
      { params: Promise.resolve({ id: overflowId }) },
    )
    const actionResponse = await action(
      request(`/api/opportunities/${overflowId}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'accepted' }),
      }),
      { params: Promise.resolve({ id: overflowId }) },
    )

    expect(detailResponse.status).toBe(404)
    expect(actionResponse.status).toBe(404)
    expect(mockedDetail).not.toHaveBeenCalled()
    expect(mockedAction).not.toHaveBeenCalled()
  })

  it('rejects non-object and oversized legacy action payloads', async () => {
    mockedOwner.mockResolvedValue('7')

    const nonObject = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        body: 'null',
      }),
      { params: Promise.resolve({ id: '10' }) },
    )
    const oversized = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'accepted', note: 'x'.repeat(17 * 1024) }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )

    expect(nonObject.status).toBe(400)
    await expect(nonObject.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(oversized.status).toBe(400)
    await expect(oversized.json()).resolves.toEqual({ error: 'payload_too_large' })
    expect(mockedAction).not.toHaveBeenCalled()
  })

  it('validates actions and forwards an idempotency key', async () => {
    mockedOwner.mockResolvedValue('7')
    const invalid = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete' }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )
    expect(invalid.status).toBe(400)

    mockedAction.mockResolvedValue(null)
    const valid = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        headers: { 'idempotency-key': 'request-1' },
        body: JSON.stringify({ action: 'accepted' }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )
    expect(valid.status).toBe(404)
    expect(mockedAction).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      opportunityId: '10',
      action: 'accepted',
      actionKey: 'request-1',
    }))
    expect(valid.headers.get('deprecation')).toBe('true')
    expect(valid.headers.get('link')).toContain(
      '</api/opportunities/10/outcomes>; rel="successor-version"',
    )
    expect(mockedLogEvent).toHaveBeenCalledWith(
      'opportunity.api.legacy_action_adapter_used',
      expect.objectContaining({
        ownerId: '7',
        opportunityId: '10',
        action: 'accepted',
      }),
    )
  })

  it('returns a conflict when an idempotency key is reused with another payload', async () => {
    mockedOwner.mockResolvedValue('7')
    mockedAction.mockRejectedValue(new OutcomeIdempotencyConflictError())

    const response = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        headers: { 'idempotency-key': 'reused-key' },
        body: JSON.stringify({ action: 'dismissed' }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )

    expect(response.status).toBe(409)
  })

  it('maps an outcome-ledger idempotency conflict to the same 409 contract', async () => {
    mockedOwner.mockResolvedValue('7')
    mockedAction.mockRejectedValue(new OutcomeIdempotencyConflictError())

    const response = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        headers: { 'idempotency-key': 'owner-global-reused-key' },
        body: JSON.stringify({ action: 'accepted' }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'idempotency_key_conflict',
    })
  })

  it('returns the state-machine conflict contract for a forbidden transition', async () => {
    mockedOwner.mockResolvedValue('7')
    mockedAction.mockRejectedValue(new OutcomeTransitionConflictError())

    const response = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'contacted' }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'outcome_transition_conflict',
    })
  })
})
