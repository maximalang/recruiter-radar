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
jest.mock('@/lib/opportunities/outcome-repository', () => ({
  recordOpportunityOutcome: jest.fn(),
  getOpportunityOutcomeHistory: jest.fn(),
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

import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization'
import {
  getOpportunityOutcomeHistory,
  OutcomeTransitionConflictError,
  recordOpportunityOutcome,
} from '@/lib/opportunities/outcome-repository'
import {
  GET,
  POST,
} from '@/app/api/opportunities/[id]/outcomes/route'

const mockedOwner = jest.mocked(getAuthorizedOwnerId)
const mockedRecord = jest.mocked(recordOpportunityOutcome)
const mockedHistory = jest.mocked(getOpportunityOutcomeHistory)

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://recruiter-radar.ru${path}`, init)
}

const context = { params: Promise.resolve({ id: '10' }) }

describe('opportunity outcomes API', () => {
  const originalEngine = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const originalOutcomes = process.env.OPPORTUNITY_OUTCOMES_ENABLED
  const originalCanaryOwners = process.env.OPPORTUNITY_CANARY_OWNER_IDS

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    delete process.env.OPPORTUNITY_CANARY_OWNER_IDS
    jest.clearAllMocks()
    mockedOwner.mockResolvedValue('7')
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', originalEngine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', originalOutcomes)
    restore('OPPORTUNITY_CANARY_OWNER_IDS', originalCanaryOwners)
  })

  it('is not discoverable while the ledger flag is disabled', async () => {
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'false'
    const response = await GET(request('/api/opportunities/10/outcomes'), context)
    expect(response.status).toBe(404)
    expect(mockedOwner).toHaveBeenCalledTimes(1)
    expect(mockedHistory).not.toHaveBeenCalled()
  })

  it('exposes the ledger only to the configured canary owner', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'false'
    process.env.OPPORTUNITY_CANARY_OWNER_IDS = '7'
    mockedHistory.mockResolvedValue({
      events: [],
      state: null,
      correction: {
        canRevert: false,
        targetEventId: null,
        targetEventType: null,
        targetOccurredAt: null,
      },
      pagination: {
        pageSize: 50,
        totalItems: 0,
        sortOrder: 'append_desc',
        hasMore: false,
        nextBeforeEventId: null,
      },
    })

    mockedOwner.mockResolvedValueOnce('8')
    const denied = await GET(request('/api/opportunities/10/outcomes'), context)
    expect(denied.status).toBe(404)
    expect(mockedHistory).not.toHaveBeenCalled()

    mockedOwner.mockResolvedValueOnce('7')
    const allowed = await GET(request('/api/opportunities/10/outcomes'), context)
    expect(allowed.status).toBe(200)
    expect(mockedHistory).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
    }))
  })

  it('requires an authenticated owner', async () => {
    mockedOwner.mockResolvedValue(null)
    const response = await GET(request('/api/opportunities/10/outcomes'), context)
    expect(response.status).toBe(401)
    expect(mockedHistory).not.toHaveBeenCalled()
  })

  it('rejects PostgreSQL bigint overflow ids before repository access', async () => {
    const overflowId = '9223372036854775808'
    const overflowContext = { params: Promise.resolve({ id: overflowId }) }

    const historyResponse = await GET(
      request(`/api/opportunities/${overflowId}/outcomes`),
      overflowContext,
    )
    const recordResponse = await POST(
      request(`/api/opportunities/${overflowId}/outcomes`, {
        method: 'POST',
        body: JSON.stringify({
          eventType: 'accepted',
          idempotencyKey: 'accepted:overflow',
        }),
      }),
      overflowContext,
    )

    expect(historyResponse.status).toBe(404)
    expect(recordResponse.status).toBe(404)
    expect(mockedHistory).not.toHaveBeenCalled()
    expect(mockedRecord).not.toHaveBeenCalled()
  })

  it('returns 201 for a new event and strips internal identifiers', async () => {
    mockedRecord.mockResolvedValue({
      idempotent: false,
      event: {
        id: '21',
        eventType: 'accepted',
        previousStage: 'new',
        newStage: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        recordedAt: '2026-07-27T12:00:01.000Z',
        actorType: 'user',
        reasonCode: null,
        channel: null,
        valueMinor: null,
        currency: null,
        metadata: {},
        contactReferenceLabel: null,
        revertsEventId: null,
      },
      state: {
        commercialStage: 'accepted',
        currentStage: 'accepted',
        workflowState: 'active',
        snoozedUntil: null,
        lastEventId: '21',
        lastEventAt: '2026-07-27T12:00:00.000Z',
        lastStageEventId: '21',
        lastStageEventAt: '2026-07-27T12:00:00.000Z',
        firstShownAt: null,
        firstOpenedAt: null,
        acceptedAt: '2026-07-27T12:00:00.000Z',
        contactedAt: null,
        repliedAt: null,
        meetingAt: null,
        proposalAt: null,
        wonAt: null,
        lostAt: null,
        dismissReasonCode: null,
        lostReasonCode: null,
        dealValueMinor: null,
        currency: null,
        meetingStatus: 'none',
        activeMeetingEventId: null,
        lastMeetingEventAt: null,
        meetingAttemptCount: 0,
      },
    })

    const response = await POST(request('/api/opportunities/10/outcomes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'accepted:request-1',
      },
      body: JSON.stringify({
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        metadata: {},
      }),
    }), context)

    expect(response.status).toBe(201)
    expect(mockedRecord).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: expect.objectContaining({
        idempotencyKey: 'accepted:request-1',
      }),
    }))
    const payload = await response.json() as Record<string, unknown>
    expect(JSON.stringify(payload)).not.toContain('lastEventId')
    expect(JSON.stringify(payload)).not.toContain('"id":"21"')
    expect(JSON.stringify(payload)).not.toContain('ownerId')
    expect(JSON.stringify(payload)).not.toContain('payloadHash')
  })

  it('returns 200 for an idempotent replay', async () => {
    mockedRecord.mockResolvedValue({
      idempotent: true,
      event: {
        id: '21', eventType: 'opened', previousStage: 'new', newStage: 'new',
        occurredAt: '2026-07-27T12:00:00.000Z',
        recordedAt: '2026-07-27T12:00:01.000Z', actorType: 'user',
        reasonCode: null, channel: null, valueMinor: null, currency: null,
        metadata: { interactionId: 'view-1' },
        contactReferenceLabel: null, revertsEventId: null,
      },
      state: {
        commercialStage: 'new', currentStage: 'new', workflowState: 'active',
        snoozedUntil: null, lastEventId: '21',
        lastEventAt: '2026-07-27T12:00:00.000Z', firstShownAt: null,
        lastStageEventId: null, lastStageEventAt: null,
        firstOpenedAt: '2026-07-27T12:00:00.000Z', acceptedAt: null,
        contactedAt: null, repliedAt: null, meetingAt: null, proposalAt: null,
        wonAt: null, lostAt: null, dismissReasonCode: null,
        lostReasonCode: null, dealValueMinor: null, currency: null,
        meetingStatus: 'none', activeMeetingEventId: null,
        lastMeetingEventAt: null, meetingAttemptCount: 0,
      },
    })

    const response = await POST(request('/api/opportunities/10/outcomes', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'opened',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'opened:view-1',
        metadata: { interactionId: 'view-1' },
      }),
    }), context)
    expect(response.status).toBe(200)
  })

  it('returns the machine-readable transition conflict', async () => {
    mockedRecord.mockRejectedValue(new OutcomeTransitionConflictError())
    const response = await POST(request('/api/opportunities/10/outcomes', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'replied',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'replied:too-soon',
        metadata: {},
      }),
    }), context)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'outcome_transition_conflict',
    })
  })

  it('returns tenant-scoped sanitized history', async () => {
    mockedHistory.mockResolvedValue({
      events: [],
      state: null,
      correction: {
        canRevert: false,
        targetEventId: null,
        targetEventType: null,
        targetOccurredAt: null,
      },
      pagination: {
        pageSize: 50,
        totalItems: 0,
        sortOrder: 'append_desc',
        hasMore: false,
        nextBeforeEventId: null,
      },
    })
    const response = await GET(request('/api/opportunities/10/outcomes'), context)
    expect(response.status).toBe(200)
    expect(mockedHistory).toHaveBeenCalledWith({
      ownerId: '7',
      workspaceId: null,
      opportunityId: '10',
      beforeEventId: null,
      pageSize: 50,
    })
  })

  it('passes a validated append cursor to history independently of correction', async () => {
    mockedHistory.mockResolvedValue({
      events: [],
      state: null,
      correction: {
        canRevert: false,
        targetEventId: null,
        targetEventType: null,
        targetOccurredAt: null,
      },
      pagination: {
        pageSize: 25,
        totalItems: 75,
        sortOrder: 'append_desc',
        hasMore: false,
        nextBeforeEventId: null,
      },
    })

    const response = await GET(
      request('/api/opportunities/10/outcomes?beforeEventId=50&pageSize=25'),
      context,
    )

    expect(response.status).toBe(200)
    expect(mockedHistory).toHaveBeenCalledWith({
      ownerId: '7',
      workspaceId: null,
      opportunityId: '10',
      beforeEventId: '50',
      pageSize: 25,
    })
  })

  it('rejects pagination cursors outside the JavaScript safe integer range', async () => {
    const response = await GET(
      request(
        '/api/opportunities/10/outcomes?beforeEventId=999999999999999999999',
      ),
      context,
    )
    expect(response.status).toBe(400)
    expect(mockedHistory).not.toHaveBeenCalled()
  })
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
