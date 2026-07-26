/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/session', () => ({
  getOwnerIdFromSession: jest.fn(),
}))
jest.mock('@/lib/opportunities/repository', () => ({
  listOpportunities: jest.fn(),
  getOpportunityById: jest.fn(),
  applyOpportunityAction: jest.fn(),
  isOpportunityAction: (value: unknown) =>
    ['accepted', 'dismissed', 'snoozed', 'contacted'].includes(String(value)),
}))

import { getOwnerIdFromSession } from '@/lib/session'
import {
  applyOpportunityAction,
  getOpportunityById,
  listOpportunities,
} from '@/lib/opportunities/repository'
import { GET as list } from '@/app/api/opportunities/route'
import { GET as detail } from '@/app/api/opportunities/[id]/route'
import { POST as action } from '@/app/api/opportunities/[id]/action/route'

const mockedOwner = jest.mocked(getOwnerIdFromSession)
const mockedList = jest.mocked(listOpportunities)
const mockedDetail = jest.mocked(getOpportunityById)
const mockedAction = jest.mocked(applyOpportunityAction)

function request(path: string, init?: RequestInit) {
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
    })
    const response = await list(request(
      '/api/opportunities?status=new,invalid&gate=A&minimumScore=0.6&page=2&pageSize=25&profile=8',
    ))

    expect(response.status).toBe(200)
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      clientProfileId: '8',
      statuses: ['new'],
      confidenceGate: 'A',
      minimumScore: 0.6,
      page: 2,
      pageSize: 25,
    }))
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
})
