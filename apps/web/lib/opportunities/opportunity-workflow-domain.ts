import type { WorkspaceRole } from '@/lib/auth-v2/workspaces'

export const OPPORTUNITY_NEXT_ACTION_TYPES = [
  'review',
  'contact',
  'follow_up',
  'prepare_meeting',
  'send_proposal',
] as const

export const OPPORTUNITY_WORKFLOW_PRIORITIES = [
  'low',
  'normal',
  'high',
] as const

export type OpportunityNextActionType =
  (typeof OPPORTUNITY_NEXT_ACTION_TYPES)[number]
export type OpportunityWorkflowPriority =
  (typeof OPPORTUNITY_WORKFLOW_PRIORITIES)[number]

export type OpportunityWorkflowPatch = {
  assignedToUserId?: string | null
  nextActionType?: OpportunityNextActionType | null
  nextActionDueAt?: string | null
  workflowPriority?: OpportunityWorkflowPriority
  internalNote?: string | null
}

export type OpportunityWorkflowValidationCode =
  | 'workflow_patch_invalid'
  | 'workflow_patch_empty'
  | 'workflow_field_unknown'
  | 'workflow_assignee_invalid'
  | 'workflow_next_action_invalid'
  | 'workflow_due_at_invalid'
  | 'workflow_priority_invalid'
  | 'workflow_note_invalid'
  | 'workflow_note_personal_contact'

export class OpportunityWorkflowValidationError extends Error {
  constructor(readonly code: OpportunityWorkflowValidationCode) {
    super(code)
    this.name = 'OpportunityWorkflowValidationError'
  }
}

const WORKFLOW_FIELDS = new Set([
  'assignedToUserId',
  'nextActionType',
  'nextActionDueAt',
  'workflowPriority',
  'internalNote',
])
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/
const MAX_POSTGRES_BIGINT = BigInt('9223372036854775807')
const MAX_INTERNAL_NOTE_LENGTH = 2_000

export function normalizeOpportunityWorkflowPatch(
  value: unknown,
): OpportunityWorkflowPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpportunityWorkflowValidationError('workflow_patch_invalid')
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.some((key) => !WORKFLOW_FIELDS.has(key))) {
    throw new OpportunityWorkflowValidationError('workflow_field_unknown')
  }
  if (keys.length === 0) {
    throw new OpportunityWorkflowValidationError('workflow_patch_empty')
  }

  const patch: OpportunityWorkflowPatch = {}
  if (hasOwn(input, 'assignedToUserId')) {
    patch.assignedToUserId = normalizeAssignee(input.assignedToUserId)
  }
  if (hasOwn(input, 'nextActionType')) {
    patch.nextActionType = normalizeNextAction(input.nextActionType)
  }
  if (hasOwn(input, 'nextActionDueAt')) {
    patch.nextActionDueAt = normalizeDueAt(input.nextActionDueAt)
  }
  if (hasOwn(input, 'workflowPriority')) {
    patch.workflowPriority = normalizePriority(input.workflowPriority)
  }
  if (hasOwn(input, 'internalNote')) {
    patch.internalNote = normalizeInternalNote(input.internalNote)
  }
  return patch
}

export function canApplyOpportunityWorkflowPatch(input: {
  actorRole: WorkspaceRole | null
  actorUserId: string
  currentAssigneeUserId: string | null
  targetAssigneeUserId: string | null
  assignmentChanged: boolean
}): boolean {
  if (input.actorRole === 'owner' || input.actorRole === 'admin') return true
  if (input.actorRole !== 'recruiter') return false

  if (!input.assignmentChanged) {
    return input.currentAssigneeUserId === input.actorUserId
  }
  if (input.currentAssigneeUserId === null) {
    return input.targetAssigneeUserId === input.actorUserId
  }
  return input.currentAssigneeUserId === input.actorUserId
}

function normalizeAssignee(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !POSITIVE_ID_PATTERN.test(value)) {
    throw new OpportunityWorkflowValidationError('workflow_assignee_invalid')
  }
  try {
    if (BigInt(value) <= MAX_POSTGRES_BIGINT) return value
  } catch {
    // The typed error below is the public contract for all malformed IDs.
  }
  throw new OpportunityWorkflowValidationError('workflow_assignee_invalid')
}

function normalizeNextAction(value: unknown): OpportunityNextActionType | null {
  if (value === null) return null
  if (
    typeof value === 'string' &&
    OPPORTUNITY_NEXT_ACTION_TYPES.includes(value as OpportunityNextActionType)
  ) {
    return value as OpportunityNextActionType
  }
  throw new OpportunityWorkflowValidationError('workflow_next_action_invalid')
}

function normalizeDueAt(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 64) {
    throw new OpportunityWorkflowValidationError('workflow_due_at_invalid')
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new OpportunityWorkflowValidationError('workflow_due_at_invalid')
  }
  const date = new Date(milliseconds)
  if (date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) {
    throw new OpportunityWorkflowValidationError('workflow_due_at_invalid')
  }
  return date.toISOString()
}

function normalizePriority(value: unknown): OpportunityWorkflowPriority {
  if (
    typeof value === 'string' &&
    OPPORTUNITY_WORKFLOW_PRIORITIES.includes(value as OpportunityWorkflowPriority)
  ) {
    return value as OpportunityWorkflowPriority
  }
  throw new OpportunityWorkflowValidationError('workflow_priority_invalid')
}

function normalizeInternalNote(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string') {
    throw new OpportunityWorkflowValidationError('workflow_note_invalid')
  }
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > MAX_INTERNAL_NOTE_LENGTH) {
    throw new OpportunityWorkflowValidationError('workflow_note_invalid')
  }
  if (containsPersonalContact(normalized)) {
    throw new OpportunityWorkflowValidationError(
      'workflow_note_personal_contact',
    )
  }
  return normalized
}

function containsPersonalContact(value: string): boolean {
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  const phonePattern = /(?:^|\D)(?:\+?7|8)[\s().-]*\d{3}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?:\D|$)/
  return emailPattern.test(value) || phonePattern.test(value)
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}
