/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/authorization', () => ({
  getOpportunityAuthorizationContext: jest.fn(),
  getOpportunityDataAccessContext: jest.fn(),
}))
jest.mock('@/lib/opportunities/opportunity-workflow-repository', () => ({
  updateOpportunityWorkflow: jest.fn(),
  OpportunityWorkflowAccessError: class OpportunityWorkflowAccessError extends Error {
    code = 'workflow_access_denied'
  },
  OpportunityWorkflowAssigneeError: class OpportunityWorkflowAssigneeError extends Error {
    code = 'workflow_assignee_unavailable'
  },
  OpportunityWorkflowIdempotencyConflictError: class OpportunityWorkflowIdempotencyConflictError extends Error {
    code = 'workflow_idempotency_conflict'
  },
  OpportunityWorkflowIdempotencyKeyError: class OpportunityWorkflowIdempotencyKeyError extends Error {
    code = 'workflow_idempotency_key_invalid'
  },
  OpportunityWorkflowNextActionRequiredError: class OpportunityWorkflowNextActionRequiredError extends Error {
    code = 'workflow_next_action_required'
  },
  OpportunityWorkflowNoChangeError: class OpportunityWorkflowNoChangeError extends Error {
    code = 'workflow_no_change'
  },
}))

import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { OpportunityWorkflowValidationError } from '@/lib/opportunities/opportunity-workflow-domain'
import {
  OpportunityWorkflowAccessError,
  OpportunityWorkflowIdempotencyConflictError,
  updateOpportunityWorkflow,
} from '@/lib/opportunities/opportunity-workflow-repository'
import { PATCH } from '@/app/api/opportunities/[id]/workflow/route'

const mockedAuthorization = jest.mocked(getOpportunityAuthorizationContext)
const mockedAccess = jest.mocked(getOpportunityDataAccessContext)
const mockedUpdate = jest.mocked(updateOpportunityWorkflow)
const context = { params: Promise.resolve({ id: '10' }) }
const authorization = {
  dataOwnerId: '7',
  workspaceId: '9',
  actorUserId: '42',
  actorRole: 'recruiter' as const,
  permissions: ['opportunities:write' as const],
  authMode: 'auth_v2' as const,
}
const access = {
  ownerId: '7',
  workspaceId: '9',
  actorUserId: '42',
  actorWorkspaceId: '9',
  actorRoleSnapshot: 'recruiter' as const,
  authMode: 'auth_v2' as const,
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('https://recruiter-radar.ru/api/opportunities/10/workflow', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('opportunity workflow API', () => {
  const previous = {
    engine: process.env.OPPORTUNITY_ENGINE_V1_ENABLED,
    outcomes: process.env.OPPORTUNITY_OUTCOMES_ENABLED,
    workspace: process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED,
    workflow: process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED,
    canary: process.env.OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS,
  }

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
    process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED = 'true'
    delete process.env.OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS
    jest.clearAllMocks()
    mockedAuthorization.mockResolvedValue(authorization)
    mockedAccess.mockReturnValue(access)
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', previous.engine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', previous.outcomes)
    restore('OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED', previous.workspace)
    restore('OPPORTUNITY_WORKFLOW_V1_ENABLED', previous.workflow)
    restore('OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS', previous.canary)
  })

  it('is not discoverable while its dedicated flag is disabled', async () => {
    process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED = 'false'

    const response = await PATCH(request(
      { assignedToUserId: '42' },
      { 'idempotency-key': 'workflow:claim:1' },
    ), context)

    expect(response.status).toBe(404)
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('requires a complete Auth v2 workspace actor and a header key', async () => {
    mockedAccess.mockReturnValueOnce(null)
    const incomplete = await PATCH(request(
      { assignedToUserId: '42' },
      { 'idempotency-key': 'workflow:claim:2' },
    ), context)
    expect(incomplete.status).toBe(404)

    const missingKey = await PATCH(request({ assignedToUserId: '42' }), context)
    expect(missingKey.status).toBe(400)
    await expect(missingKey.json()).resolves.toEqual({
      error: 'workflow_idempotency_key_invalid',
    })
  })

  it('records the immutable actor and returns only the workflow projection', async () => {
    mockedUpdate.mockResolvedValue({
      idempotent: false,
      event: {
        id: '81',
        recordedAt: '2026-08-01T12:00:00.000Z',
        changedFields: ['assignedToUserId', 'internalNote'],
      },
      state: {
        assignedToUserId: '42',
        nextActionType: 'follow_up',
        nextActionDueAt: '2026-08-02T06:00:00.000Z',
        workflowPriority: 'high',
        internalNote: 'Подготовить следующий шаг.',
        lastEventId: '81',
        updatedAt: '2026-08-01T12:00:00.000Z',
      },
    })

    const response = await PATCH(request({
      assignedToUserId: '42',
      internalNote: ' Подготовить следующий шаг. ',
    }, { 'idempotency-key': 'workflow:claim:3' }), context)

    expect(response.status).toBe(201)
    expect(mockedAuthorization).toHaveBeenCalledWith('opportunities:write')
    expect(mockedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '42',
      actorRole: 'recruiter',
      idempotencyKey: 'workflow:claim:3',
      patch: {
        assignedToUserId: '42',
        internalNote: 'Подготовить следующий шаг.',
      },
    }))
    const payload = await response.json() as Record<string, unknown>
    expect(payload).toEqual({
      idempotent: false,
      event: {
        recordedAt: '2026-08-01T12:00:00.000Z',
        changedFields: ['assignedToUserId', 'internalNote'],
      },
      state: {
        assignedToUserId: '42',
        nextActionType: 'follow_up',
        nextActionDueAt: '2026-08-02T06:00:00.000Z',
        workflowPriority: 'high',
        internalNote: 'Подготовить следующий шаг.',
        updatedAt: '2026-08-01T12:00:00.000Z',
      },
    })
    expect(JSON.stringify(payload)).not.toContain('lastEventId')
    expect(JSON.stringify(payload)).not.toContain('actorUserId')
  })

  it.each([
    [new OpportunityWorkflowValidationError('workflow_field_unknown'), 400],
    [new OpportunityWorkflowAccessError(), 403],
    [new OpportunityWorkflowIdempotencyConflictError(), 409],
  ])('maps workflow errors without leaking the request body', async (error, status) => {
    mockedUpdate.mockRejectedValue(error)
    const response = await PATCH(request(
      { workflowPriority: 'high' },
      { 'idempotency-key': 'workflow:error:1' },
    ), context)

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({
      error: (error as { code: string }).code,
    })
  })

  it('hides foreign or superseded opportunities', async () => {
    mockedUpdate.mockResolvedValue(null)
    const response = await PATCH(request(
      { workflowPriority: 'high' },
      { 'idempotency-key': 'workflow:not-found:1' },
    ), context)
    expect(response.status).toBe(404)
  })
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
