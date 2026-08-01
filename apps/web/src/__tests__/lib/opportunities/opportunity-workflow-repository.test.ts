import type { PoolClient, QueryResult } from 'pg'

import { hashCanonicalJson } from '@/lib/opportunities/canonical-hash'
import {
  OpportunityWorkflowAccessError,
  OpportunityWorkflowAssigneeError,
  OpportunityWorkflowIdempotencyConflictError,
  OpportunityWorkflowNextActionRequiredError,
  OpportunityWorkflowNoChangeError,
  listOpportunityWorkflowAssignees,
  updateOpportunityWorkflow,
} from '@/lib/opportunities/opportunity-workflow-repository'

type QueryHandler = (
  text: string,
  values: readonly unknown[] | undefined,
) => { rows?: unknown[]; rowCount?: number }

function clientFor(handler: QueryHandler) {
  const query = jest.fn(async (text: string, values?: readonly unknown[]) => {
    const result = handler(text, values)
    return {
      command: '',
      fields: [],
      oid: 0,
      rowCount: result.rowCount ?? result.rows?.length ?? 0,
      rows: result.rows ?? [],
    } as QueryResult
  })
  const release = jest.fn()
  return {
    client: { query, release } as unknown as PoolClient,
    query,
    release,
  }
}

const BASE_STATE = {
  assignedToUserId: null,
  nextActionType: null,
  nextActionDueAt: null,
  workflowPriority: 'normal',
  internalNote: null,
  lastEventId: null,
  updatedAt: null,
}

function successfulHandler(overrides: Partial<typeof BASE_STATE> = {}): QueryHandler {
  return (text, values) => {
    if (text.includes('FROM opportunity_workflow_events') && text.includes('idempotency_key')) {
      return { rows: [] }
    }
    if (text.includes('FROM opportunities opportunity')) {
      return { rows: [{ opportunityId: '10', ...BASE_STATE, ...overrides }] }
    }
    if (text.includes('FROM workspace_members') && text.includes('membership.user_id = $2')) {
      const userId = String(values?.[1])
      return { rows: [{ userId, role: userId === '42' ? 'recruiter' : 'owner' }] }
    }
    if (text.includes('INSERT INTO opportunity_workflow_events')) {
      return { rows: [{ id: '101', recordedAt: '2026-08-01T12:00:00.000Z' }] }
    }
    if (text.includes('INSERT INTO opportunity_workflow_state')) {
      return { rows: [{
        assignedToUserId: values?.[3] ?? null,
        nextActionType: values?.[4] ?? null,
        nextActionDueAt: values?.[5] ?? null,
        workflowPriority: values?.[6] ?? 'normal',
        internalNote: values?.[7] ?? null,
        lastEventId: '101',
        updatedAt: '2026-08-01T12:00:00.000Z',
      }] }
    }
    return { rows: [] }
  }
}

describe('Opportunity workflow repository', () => {
  it('lists only active assignable members without exposing email addresses', async () => {
    const query = jest.fn(async () => ({
      rows: [
        { userId: '7', displayName: 'Мария', role: 'owner' },
        { userId: '42', displayName: 'Участник 42', role: 'recruiter' },
      ],
    }))

    await expect(listOpportunityWorkflowAssignees('9', { query })).resolves.toEqual([
      { userId: '7', displayName: 'Мария', role: 'owner' },
      { userId: '42', displayName: 'Участник 42', role: 'recruiter' },
    ])
    const [sql, values] = query.mock.calls[0]
    expect(sql).toContain("membership.status = 'active'")
    expect(sql).toContain("membership.role IN ('owner', 'admin', 'recruiter')")
    expect(sql).not.toContain('account.email')
    expect(values).toEqual(['9'])
  })

  it('writes an actor-attributed append-only event and current projection atomically', async () => {
    const { client, query, release } = clientFor(successfulHandler())

    const result = await updateOpportunityWorkflow({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '42',
      actorRole: 'recruiter',
      idempotencyKey: 'workflow:claim:10',
      patch: {
        assignedToUserId: '42',
        nextActionType: 'follow_up',
        nextActionDueAt: '2026-08-02T06:30:00.000Z',
        workflowPriority: 'high',
        internalNote: 'Согласовать следующий шаг.',
      },
    }, async () => client)

    expect(result).toEqual({
      state: {
        assignedToUserId: '42',
        nextActionType: 'follow_up',
        nextActionDueAt: '2026-08-02T06:30:00.000Z',
        workflowPriority: 'high',
        internalNote: 'Согласовать следующий шаг.',
        lastEventId: '101',
        updatedAt: '2026-08-01T12:00:00.000Z',
      },
      event: {
        id: '101',
        recordedAt: '2026-08-01T12:00:00.000Z',
        changedFields: [
          'assignedToUserId',
          'nextActionType',
          'nextActionDueAt',
          'workflowPriority',
          'internalNote',
        ],
      },
      idempotent: false,
    })
    const eventCall = query.mock.calls.find(([text]) =>
      String(text).includes('INSERT INTO opportunity_workflow_events'))
    expect(eventCall?.[1]).toEqual(expect.arrayContaining([
      '7',
      '9',
      '10',
      '42',
      'recruiter',
      'workflow:claim:10',
    ]))
    expect(query.mock.calls.map(([text]) => String(text).trim())).toEqual(
      expect.arrayContaining(['BEGIN', 'COMMIT']),
    )
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('returns an exact idempotent replay without writing another event', async () => {
    const patch = { workflowPriority: 'high' as const }
    const payloadHash = hashCanonicalJson({
      opportunityId: '10',
      patch,
    })
    const replay = {
      eventId: '91',
      payloadHash,
      opportunityId: '10',
      assignedToUserId: '42',
      nextActionType: 'follow_up',
      nextActionDueAt: '2026-08-02T06:30:00.000Z',
      workflowPriority: 'high',
      internalNote: null,
      changedFields: ['workflowPriority'],
      recordedAt: '2026-08-01T11:00:00.000Z',
    }
    const { client, query } = clientFor((text) => {
      if (text.includes('FROM opportunity_workflow_events')) {
        return { rows: [replay] }
      }
      if (text.includes('FROM workspace_members')) {
        return { rows: [{ userId: '7', role: 'owner' }] }
      }
      return { rows: [] }
    })

    const result = await updateOpportunityWorkflow({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '7',
      actorRole: 'owner',
      idempotencyKey: 'workflow:priority:10',
      patch,
    }, async () => client)

    expect(result?.idempotent).toBe(true)
    expect(result?.event.id).toBe('91')
    expect(query.mock.calls.some(([text]) =>
      String(text).includes('INSERT INTO opportunity_workflow_events')),
    ).toBe(false)
  })

  it('rejects an exact replay after the actor membership is removed', async () => {
    const patch = { workflowPriority: 'high' as const }
    const payloadHash = hashCanonicalJson({ opportunityId: '10', patch })
    const { client } = clientFor((text) => {
      if (text.includes('FROM opportunity_workflow_events')) {
        return { rows: [{
          eventId: '91',
          payloadHash,
          opportunityId: '10',
          assignedToUserId: '42',
          nextActionType: null,
          nextActionDueAt: null,
          workflowPriority: 'high',
          internalNote: 'Внутренняя заметка',
          changedFields: ['workflowPriority'],
          recordedAt: '2026-08-01T11:00:00.000Z',
        }] }
      }
      if (text.includes('FROM workspace_members')) return { rows: [] }
      return { rows: [] }
    })

    await expect(updateOpportunityWorkflow({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '7',
      actorRole: 'owner',
      idempotencyKey: 'workflow:priority:10',
      patch,
    }, async () => client)).rejects.toBeInstanceOf(
      OpportunityWorkflowAccessError,
    )
  })

  it('rejects a changed payload under the same idempotency key', async () => {
    const { client } = clientFor((text) => {
      if (text.includes('FROM opportunity_workflow_events')) {
        return { rows: [{ payloadHash: 'a'.repeat(64) }] }
      }
      if (text.includes('FROM workspace_members')) {
        return { rows: [{ userId: '7', role: 'owner' }] }
      }
      return { rows: [] }
    })

    await expect(updateOpportunityWorkflow({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '7',
      actorRole: 'owner',
      idempotencyKey: 'workflow:reused',
      patch: { workflowPriority: 'high' },
    }, async () => client)).rejects.toBeInstanceOf(
      OpportunityWorkflowIdempotencyConflictError,
    )
  })

  it('prevents a recruiter from taking work assigned to another teammate', async () => {
    const { client } = clientFor(successfulHandler({ assignedToUserId: '81' }))

    await expect(updateOpportunityWorkflow({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '42',
      actorRole: 'recruiter',
      idempotencyKey: 'workflow:steal:10',
      patch: { assignedToUserId: '42' },
    }, async () => client)).rejects.toBeInstanceOf(
      OpportunityWorkflowAccessError,
    )
  })

  it('rejects assignment to an inactive or read-only workspace member', async () => {
    const { client } = clientFor((text, values) => {
      if (text.includes('FROM opportunity_workflow_events')) return { rows: [] }
      if (text.includes('FROM opportunities opportunity')) {
        return { rows: [{ opportunityId: '10', ...BASE_STATE }] }
      }
      if (text.includes('FROM workspace_members')) {
        const userId = String(values?.[1])
        return userId === '7'
          ? { rows: [{ userId, role: 'owner' }] }
          : { rows: [{ userId, role: 'viewer' }] }
      }
      return { rows: [] }
    })

    await expect(updateOpportunityWorkflow({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '7',
      actorRole: 'owner',
      idempotencyKey: 'workflow:viewer:10',
      patch: { assignedToUserId: '81' },
    }, async () => client)).rejects.toBeInstanceOf(
      OpportunityWorkflowAssigneeError,
    )
  })

  it('rejects no-op updates and does not create audit noise', async () => {
    const { client } = clientFor(successfulHandler())

    await expect(updateOpportunityWorkflow({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '7',
      actorRole: 'owner',
      idempotencyKey: 'workflow:no-op:10',
      patch: { workflowPriority: 'normal' },
    }, async () => client)).rejects.toBeInstanceOf(
      OpportunityWorkflowNoChangeError,
    )
  })

  it('requires an action type before accepting a due date', async () => {
    const { client } = clientFor(successfulHandler())

    await expect(updateOpportunityWorkflow({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '7',
      actorRole: 'owner',
      idempotencyKey: 'workflow:due-without-action:10',
      patch: { nextActionDueAt: '2026-08-02T06:30:00.000Z' },
    }, async () => client)).rejects.toBeInstanceOf(
      OpportunityWorkflowNextActionRequiredError,
    )
  })

  it('rejects IDs outside PostgreSQL bigint before acquiring a client', async () => {
    const provideClient = jest.fn()

    await expect(updateOpportunityWorkflow({
      ownerId: '9223372036854775808',
      workspaceId: '9',
      opportunityId: '10',
      actorUserId: '7',
      actorRole: 'owner',
      idempotencyKey: 'workflow:overflow',
      patch: { workflowPriority: 'high' },
    }, provideClient)).rejects.toBeInstanceOf(OpportunityWorkflowAccessError)
    expect(provideClient).not.toHaveBeenCalled()
  })

  it('returns null for foreign or superseded opportunities without leaking them', async () => {
    const { client } = clientFor((text) => {
      if (text.includes('FROM opportunity_workflow_events')) return { rows: [] }
      if (text.includes('FROM opportunities opportunity')) return { rows: [] }
      return { rows: [] }
    })

    await expect(updateOpportunityWorkflow({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '99',
      actorUserId: '7',
      actorRole: 'owner',
      idempotencyKey: 'workflow:foreign:99',
      patch: { workflowPriority: 'high' },
    }, async () => client)).resolves.toBeNull()
  })
})
