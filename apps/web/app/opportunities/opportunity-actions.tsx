'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

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

export function OpportunityActions(props: {
  opportunityId: string
  currentStatus: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(action: Action) {
    setPending(action)
    setError(null)
    try {
      const response = await fetch(`/api/opportunities/${props.opportunityId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${action}:${props.opportunityId}`,
        },
        body: JSON.stringify({
          action,
          ...(action === 'snoozed' ? { snoozeDays: 7 } : {}),
        }),
      })
      if (!response.ok) {
        throw new Error('action_failed')
      }
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
            disabled={pending !== null || props.currentStatus === item.action}
            aria-pressed={props.currentStatus === item.action}
            onClick={() => void submit(item.action)}
          >
            {pending === item.action ? 'Сохраняем…' : item.label}
          </button>
        ))}
      </div>
      <p className={styles.actionError} role="status" aria-live="polite">
        {error}
      </p>
    </div>
  )
}
