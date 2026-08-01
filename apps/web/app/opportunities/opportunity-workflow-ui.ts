import type {
  OpportunityNextActionType,
  OpportunityWorkflowPatch,
  OpportunityWorkflowPriority,
} from '@/lib/opportunities/opportunity-workflow-domain'
import type { OpportunityWorkflowState } from '@/lib/opportunities/opportunity-workflow-repository'

export const ACTION_LABELS: Record<OpportunityNextActionType, string> = {
  review: 'Проверить возможность',
  contact: 'Подготовить контакт',
  follow_up: 'Вернуться с follow-up',
  prepare_meeting: 'Подготовить встречу',
  send_proposal: 'Отправить предложение',
}

export const PRIORITY_LABELS: Record<OpportunityWorkflowPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
}

export type EditableWorkflow = {
  assignedToUserId: string
  nextActionType: OpportunityNextActionType | ''
  nextActionDueAt: string
  workflowPriority: OpportunityWorkflowPriority
  internalNote: string
}

export function editableWorkflow(
  workflow: OpportunityWorkflowState | null,
): EditableWorkflow {
  return {
    assignedToUserId: workflow?.assignedToUserId ?? '',
    nextActionType: workflow?.nextActionType ?? '',
    nextActionDueAt: toLocalDateTime(workflow?.nextActionDueAt ?? null),
    workflowPriority: workflow?.workflowPriority ?? 'normal',
    internalNote: workflow?.internalNote ?? '',
  }
}

export function changedPatch(
  workflow: OpportunityWorkflowState | null,
  form: EditableWorkflow,
): OpportunityWorkflowPatch {
  const patch: OpportunityWorkflowPatch = {}
  const assignedToUserId = form.assignedToUserId || null
  const nextActionType = form.nextActionType || null
  const nextActionDueAt = nextActionType && form.nextActionDueAt
    ? new Date(form.nextActionDueAt).toISOString()
    : null
  const internalNote = form.internalNote.trim() || null

  if (assignedToUserId !== (workflow?.assignedToUserId ?? null)) {
    patch.assignedToUserId = assignedToUserId
  }
  if (nextActionType !== (workflow?.nextActionType ?? null)) {
    patch.nextActionType = nextActionType
  }
  if (!sameInstant(nextActionDueAt, workflow?.nextActionDueAt ?? null)) {
    patch.nextActionDueAt = nextActionDueAt
  }
  if (form.workflowPriority !== (workflow?.workflowPriority ?? 'normal')) {
    patch.workflowPriority = form.workflowPriority
  }
  if (internalNote !== (workflow?.internalNote ?? null)) {
    patch.internalNote = internalNote
  }
  return patch
}

export function createIdempotencyKey(): string {
  const token = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `workflow:${token}`
}

export function formatDueAt(value: string | null): string {
  if (!value) return 'Не задан'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Не задан'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function workflowErrorMessage(code: string | undefined): string {
  if (code === 'workflow_note_personal_contact') {
    return 'Не добавляйте личные email или телефоны.'
  }
  if (code === 'workflow_access_denied') {
    return 'Назначение изменилось. Обновите страницу.'
  }
  if (code === 'workflow_no_change') return 'Изменений нет.'
  if (code === 'workflow_assignee_unavailable') {
    return 'Этот участник больше недоступен для назначения.'
  }
  return 'План не сохранился. Проверьте поля и повторите попытку.'
}

function toLocalDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function sameInstant(left: string | null, right: string | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) &&
    leftTime === rightTime
}
