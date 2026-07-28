/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/session', () => ({
  getOwnerIdFromSession: jest.fn(),
}))
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

import { getOwnerIdFromSession } from '@/lib/session'
import {
  applyOpportunityAction,
  getOpportunityById,
  listOpportunities,
  OpportunityActionConflictError,
  OpportunityTransitionConflictError,
} from '@/lib/opportunities/repository'
import { GET as list } from '@/app/api/opportunities/route'
import { GET as detail } from '@/app/api/opportunities/[id]/route'
import { POST as action } from '@/app/api/opportunities/[id]/action/route'

const mockedOwner = jest.mocked(getOwnerIdFromSession)
const mockedList = jest.mocked(listOpportunities)
const mockedDetail = jest.mocked(getOpportunityById)
const mockedAction = jest.mocked(applyOpportunityAction)

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://recruiter-radar.ru${path}`, init)
}

describe('opportunities API', () => {
  const originalFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    jest.clearAllMocks()
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.OPPORTUNITY_ENGINE_V1_ENABLED
    else process.env.OPPORTUNITY_ENGINE_V1_ENABLED = originalFlag
  })

  it('is not discoverable when the feature is disabled', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    const response = await list(request('/api/opportunities'))
    expect(response.status).toBe(404)
    expect(mockedOwner).not.toHaveBeenCalled()
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
      opportunityId: '99',
    })
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
  })

  it('returns a conflict when an idempotency key is reused with another payload', async () => {
    mockedOwner.mockResolvedValue('7')
    mockedAction.mockRejectedValue(new OpportunityActionConflictError())

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

  it('returns the state-machine conflict contract for a forbidden transition', async () => {
    mockedOwner.mockResolvedValue('7')
    mockedAction.mockRejectedValue(new OpportunityTransitionConflictError())

    const response = await action(
      request('/api/opportunities/10/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'contacted' }),
      }),
      { params: Promise.resolve({ id: '10' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'opportunity_transition_conflict',
    })
  })
})
