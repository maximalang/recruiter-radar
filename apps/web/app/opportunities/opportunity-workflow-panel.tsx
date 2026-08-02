'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { WorkspaceRole } from '@/lib/auth-v2/workspaces'
import {
  OPPORTUNITY_NEXT_ACTION_TYPES,
  OPPORTUNITY_WORKFLOW_PRIORITIES,
  type OpportunityNextActionType,
  type OpportunityWorkflowPatch,
  type OpportunityWorkflowPriority,
} from '@/lib/opportunities/opportunity-workflow-domain'
import type {
  OpportunityWorkflowAssignee,
  OpportunityWorkflowState,
} from '@/lib/opportunities/opportunity-workflow-repository'
import {
  ACTION_LABELS,
  PRIORITY_LABELS,
  changedPatch,
  createIdempotencyKey,
  editableWorkflow,
  formatDueAt,
  workflowErrorMessage,
} from './opportunity-workflow-ui'
import styles from './opportunities.module.css'

export function OpportunityWorkflowPanel(props: {
  opportunityId: string
  workflow: OpportunityWorkflowState | null
  assignees: OpportunityWorkflowAssignee[]
  actorUserId: string
  actorRole: WorkspaceRole | null
}) {
  const router = useRouter()
  const [workflow, setWorkflow] = useState(props.workflow)
  const [form, setForm] = useState(() => editableWorkflow(props.workflow))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setWorkflow(props.workflow)
    setForm(editableWorkflow(props.workflow))
  }, [props.workflow])

  const assigneeById = useMemo(() => new Map(
    props.assignees.map((assignee) => [assignee.userId, assignee.displayName]),
  ), [props.assignees])
  const assignedToUserId = workflow?.assignedToUserId ?? null
  const canEdit = props.actorRole === 'owner' || props.actorRole === 'admin' || (
    props.actorRole === 'recruiter' &&
    (assignedToUserId === null || assignedToUserId === props.actorUserId)
  )
  const canClaim = props.actorRole === 'recruiter' && assignedToUserId === null
  const availableAssignees = props.actorRole === 'recruiter' && assignedToUserId === null
    ? props.assignees.filter((assignee) => assignee.userId === props.actorUserId)
    : props.assignees

  async function savePatch(patch: OpportunityWorkflowPatch) {
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(
        `/api/opportunities/${props.opportunityId}/workflow`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': createIdempotencyKey(),
          },
          body: JSON.stringify(patch),
        },
      )
      const payload = await response.json().catch(() => ({})) as {
        error?: string
        state?: Omit<OpportunityWorkflowState, 'lastEventId'>
      }
      if (!response.ok || !payload.state) {
        setMessage(workflowErrorMessage(payload.error))
        return
      }
      const next: OpportunityWorkflowState = {
        ...payload.state,
        lastEventId: workflow?.lastEventId ?? null,
      }
      setWorkflow(next)
      setForm(editableWorkflow(next))
      setMessage('План сохранён.')
      router.refresh()
    } catch {
      setMessage('План не сохранился. Повторите попытку.')
    } finally {
      setSaving(false)
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const patch = changedPatch(workflow, form)
    if (Object.keys(patch).length === 0) {
      setMessage('Изменений нет.')
      return
    }
    await savePatch(patch)
  }

  return (
    <section className={styles.workflowPanel} aria-labelledby={`workflow-${props.opportunityId}`}>
      <div className={styles.workflowHeading}>
        <div>
          <span>Командная работа</span>
          <h3 id={`workflow-${props.opportunityId}`}>Рабочий план</h3>
        </div>
        <strong data-priority={workflow?.workflowPriority ?? 'normal'}>
          {PRIORITY_LABELS[workflow?.workflowPriority ?? 'normal']}
        </strong>
      </div>

      <dl className={styles.workflowSummary}>
        <div>
          <dt>Ответственный</dt>
          <dd>{assignedToUserId
            ? assigneeById.get(assignedToUserId) ?? `Участник ${assignedToUserId}`
            : 'Не назначено'}</dd>
        </div>
        <div>
          <dt>Следующий шаг</dt>
          <dd>{workflow?.nextActionType
            ? ACTION_LABELS[workflow.nextActionType]
            : 'Не задан'}</dd>
        </div>
        <div>
          <dt>Срок</dt>
          <dd>{formatDueAt(workflow?.nextActionDueAt ?? null)}</dd>
        </div>
      </dl>

      {workflow?.internalNote ? (
        <p className={styles.workflowNote}>{workflow.internalNote}</p>
      ) : null}

      {canClaim ? (
        <button
          type="button"
          className={styles.actionButton}
          data-tone="primary"
          disabled={saving}
          onClick={() => void savePatch({ assignedToUserId: props.actorUserId })}
        >
          Взять в работу
        </button>
      ) : null}

      {canEdit ? (
        <details className={styles.workflowEditor}>
          <summary>Изменить рабочий план</summary>
          <form onSubmit={submit} className={styles.workflowForm}>
            <label>
              Ответственный
              <select
                value={form.assignedToUserId}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  assignedToUserId: event.target.value,
                }))}
              >
                <option value="">Не назначено</option>
                {availableAssignees.map((assignee) => (
                  <option key={assignee.userId} value={assignee.userId}>
                    {assignee.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Следующий шаг
              <select
                value={form.nextActionType}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  nextActionType: event.target.value as OpportunityNextActionType | '',
                  nextActionDueAt: event.target.value ? current.nextActionDueAt : '',
                }))}
              >
                <option value="">Не задан</option>
                {OPPORTUNITY_NEXT_ACTION_TYPES.map((action) => (
                  <option key={action} value={action}>{ACTION_LABELS[action]}</option>
                ))}
              </select>
            </label>
            <label>
              Срок следующего шага
              <input
                type="datetime-local"
                value={form.nextActionDueAt}
                disabled={!form.nextActionType}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  nextActionDueAt: event.target.value,
                }))}
              />
            </label>
            <label>
              Приоритет
              <select
                value={form.workflowPriority}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  workflowPriority: event.target.value as OpportunityWorkflowPriority,
                }))}
              >
                {OPPORTUNITY_WORKFLOW_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.workflowNoteField}>
              Внутренняя заметка
              <textarea
                aria-label="Внутренняя заметка"
                maxLength={2_000}
                value={form.internalNote}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  internalNote: event.target.value,
                }))}
              />
              <small>Без личных email и телефонов. Заметка видна только команде.</small>
            </label>
            <button
              type="submit"
              className={styles.actionButton}
              data-tone="primary"
              disabled={saving}
            >
              {saving ? 'Сохраняем…' : 'Сохранить план'}
            </button>
          </form>
        </details>
      ) : null}

      <p className={styles.actionError} role="status" aria-live="polite">
        {message}
      </p>
    </section>
  )
}
