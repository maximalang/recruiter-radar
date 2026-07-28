'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import styles from './opportunities.module.css'

type Action = 'accepted' | 'dismissed' | 'snoozed' | 'contacted'

const ACTIONS: ReadonlyArray<{
  action: Action
  label: string
  tone: 'primary' | 'neutral'
}> = [
  { action: 'accepted', label: 'В работу', tone: 'primary' },
  { action: 'contacted', label: 'Связались', tone: 'neutral' },
  { action: 'snoozed', label: 'Отложить', tone: 'neutral' },
  { action: 'dismissed', label: 'Не подходит', tone: 'neutral' },
]

const ALLOWED_ACTIONS: Readonly<Record<string, readonly Action[]>> = {
  new: ['accepted', 'dismissed', 'snoozed'],
  review: ['accepted', 'dismissed', 'snoozed'],
  snoozed: ['accepted', 'dismissed'],
  accepted: ['contacted', 'dismissed', 'snoozed'],
  contacted: [],
  dismissed: [],
  expired: [],
}

export function OpportunityActions(props: {
  opportunityId: string
  currentStatus: string
  detailHref?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)
  const retryKeys = useRef<Partial<Record<Action, string>>>({})

  async function submit(action: Action) {
    setPending(action)
    setError(null)
    const actionKey = retryKeys.current[action] ?? createActionKey()
    retryKeys.current[action] = actionKey
    try {
      const response = await fetch(`/api/opportunities/${props.opportunityId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': actionKey,
        },
        body: JSON.stringify({
          action,
          ...(action === 'snoozed' ? { snoozeDays: 7 } : {}),
        }),
      })
      if (!response.ok) {
        throw new Error('action_failed')
      }
      delete retryKeys.current[action]
      router.refresh()
    } catch {
      setError('Действие не сохранилось. Повторите через минуту.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className={styles.actions}>
      <div className={styles.actionButtons} aria-label="Действия с возможностью">
        {ACTIONS.map((item) => (
          <button
            key={item.action}
            type="button"
            className={styles.actionButton}
            data-tone={item.tone}
            disabled={
              pending !== null ||
              !ALLOWED_ACTIONS[props.currentStatus]?.includes(item.action)
            }
            aria-pressed={props.currentStatus === item.action}
            onClick={() => void submit(item.action)}
          >
            {pending === item.action ? 'Сохраняем…' : item.label}
          </button>
        ))}
        {props.detailHref ? (
          <a className={styles.actionButton} href={props.detailHref}>
            Открыть
          </a>
        ) : null}
      </div>
      <p className={styles.actionError} role="status" aria-live="polite">
        {error}
      </p>
    </div>
  )
}

function createActionKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const entropy = new Uint32Array(4)
  crypto.getRandomValues(entropy)
  return Array.from(
    entropy,
    (value) => value.toString(16).padStart(8, '0'),
  ).join('')
}
