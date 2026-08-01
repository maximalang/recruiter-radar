import {
  canApplyOpportunityWorkflowPatch,
  normalizeOpportunityWorkflowPatch,
  OpportunityWorkflowValidationError,
  type OpportunityWorkflowValidationCode,
} from '@/lib/opportunities/opportunity-workflow-domain'

const INVALID_WORKFLOW_PATCHES: Array<[
  Record<string, unknown>,
  OpportunityWorkflowValidationCode,
]> = [
  [{}, 'workflow_patch_empty'],
  [{ unknown: true }, 'workflow_field_unknown'],
  [{ assignedToUserId: '0' }, 'workflow_assignee_invalid'],
  [{ nextActionType: 'email_sequence' }, 'workflow_next_action_invalid'],
  [{ nextActionDueAt: 'tomorrow' }, 'workflow_due_at_invalid'],
  [{ workflowPriority: 'critical' }, 'workflow_priority_invalid'],
  [{ internalNote: 'a'.repeat(2_001) }, 'workflow_note_invalid'],
  [{ internalNote: 'Пишите recruiter@example.ru' }, 'workflow_note_personal_contact'],
  [{ internalNote: 'Позвонить +7 (999) 123-45-67' }, 'workflow_note_personal_contact'],
]

describe('Opportunity workflow domain', () => {
  it('normalizes the five-field workflow patch without inventing CRM data', () => {
    expect(normalizeOpportunityWorkflowPatch({
      assignedToUserId: '42',
      nextActionType: 'follow_up',
      nextActionDueAt: '2026-08-02T09:30:00+03:00',
      workflowPriority: 'high',
      internalNote: '  Согласовать следующий шаг внутри команды.  ',
    })).toEqual({
      assignedToUserId: '42',
      nextActionType: 'follow_up',
      nextActionDueAt: '2026-08-02T06:30:00.000Z',
      workflowPriority: 'high',
      internalNote: 'Согласовать следующий шаг внутри команды.',
    })
  })

  it('supports explicit clearing while preserving omitted fields', () => {
    expect(normalizeOpportunityWorkflowPatch({
      assignedToUserId: null,
      nextActionType: null,
      nextActionDueAt: null,
      internalNote: '',
    })).toEqual({
      assignedToUserId: null,
      nextActionType: null,
      nextActionDueAt: null,
      internalNote: null,
    })
  })

  it.each(INVALID_WORKFLOW_PATCHES)(
    'rejects invalid or expansive input %#',
    (payload, code) => {
      expect(() => normalizeOpportunityWorkflowPatch(payload)).toThrow(
        expect.objectContaining<Partial<OpportunityWorkflowValidationError>>({ code }),
      )
    },
  )

  it('allows owner and admin to assign eligible workspace members', () => {
    for (const actorRole of ['owner', 'admin'] as const) {
      expect(canApplyOpportunityWorkflowPatch({
        actorRole,
        actorUserId: '7',
        currentAssigneeUserId: '42',
        targetAssigneeUserId: '81',
        assignmentChanged: true,
      })).toBe(true)
    }
  })

  it('lets a recruiter claim unassigned work and hand off their own work', () => {
    expect(canApplyOpportunityWorkflowPatch({
      actorRole: 'recruiter',
      actorUserId: '42',
      currentAssigneeUserId: null,
      targetAssigneeUserId: '42',
      assignmentChanged: true,
    })).toBe(true)
    expect(canApplyOpportunityWorkflowPatch({
      actorRole: 'recruiter',
      actorUserId: '42',
      currentAssigneeUserId: '42',
      targetAssigneeUserId: '81',
      assignmentChanged: true,
    })).toBe(true)
  })

  it('prevents recruiter takeover and excludes viewer, billing, and legacy actors', () => {
    expect(canApplyOpportunityWorkflowPatch({
      actorRole: 'recruiter',
      actorUserId: '42',
      currentAssigneeUserId: '81',
      targetAssigneeUserId: '42',
      assignmentChanged: true,
    })).toBe(false)
    for (const actorRole of ['viewer', 'billing', null] as const) {
      expect(canApplyOpportunityWorkflowPatch({
        actorRole,
        actorUserId: '42',
        currentAssigneeUserId: null,
        targetAssigneeUserId: null,
        assignmentChanged: false,
      })).toBe(false)
    }
  })
})
