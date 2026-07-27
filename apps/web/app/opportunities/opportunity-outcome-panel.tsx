'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import styles from './opportunities.module.css'

type OutcomeStage = 'new' | 'review' | 'accepted' | 'dismissed' |
  'contacted' | 'replied' | 'meeting' | 'proposal' | 'won' | 'lost'
type OutcomeAction = 'accepted' | 'dismissed' | 'snoozed' | 'contacted' |
  'resumed' | 'replied' | 'meeting' | 'proposal' | 'won' | 'lost' | 'reverted'

interface HistoryEvent {
  eventType: string
  label: string
  occurredAt: string
  recordedAt: string
  appendOrder: string
  actorType: string
  reason: { code: string; label: string; note: string | null } | null
  channel: string | null
  contactPathType: string | null
  contactReferenceLabel: string | null
  valueMinor: number | null
  currency: string | null
  metadata: Record<string, string>
}

interface HistoryResponse {
  state: {
    currentStage: OutcomeStage
    commercialStage: OutcomeStage
    workflowState: 'active' | 'snoozed'
    snoozedUntil: string | null
    lastEventAt?: string
    dealValueMinor?: number | null
    currency?: string | null
  } | null
  events: HistoryEvent[]
}

const STAGE_LABELS: Record<OutcomeStage, string> = {
  new: 'Новая',
  review: 'Нужна проверка',
  accepted: 'В работе',
  dismissed: 'Отклонена',
  contacted: 'Связались',
  replied: 'Получен ответ',
  meeting: 'Встреча',
  proposal: 'Предложение',
  won: 'Выиграно',
  lost: 'Потеряно',
}

const ACTION_LABELS: Record<OutcomeAction, string> = {
  accepted: 'В работу',
  dismissed: 'Отклонить',
  snoozed: 'Отложить',
  resumed: 'Возобновить',
  contacted: 'Связались',
  replied: 'Получили ответ',
  meeting: 'Назначили встречу',
  proposal: 'Отправили предложение',
  won: 'Выиграли',
  lost: 'Потеряли',
  reverted: 'Отменить последнее изменение',
}

const NEXT_ACTIONS: Record<OutcomeStage, readonly OutcomeAction[]> = {
  new: ['accepted', 'dismissed'],
  review: ['accepted', 'dismissed'],
  accepted: ['contacted', 'dismissed'],
  contacted: ['replied', 'lost'],
  replied: ['meeting', 'lost'],
  meeting: ['proposal', 'lost'],
  proposal: ['won', 'lost'],
  dismissed: [],
  won: [],
  lost: [],
}

const DISMISSED_REASONS = [
  ['bad_fit', 'Не подходит профилю агентства'],
  ['wrong_roles', 'Не те роли'],
  ['wrong_industry', 'Не та отрасль'],
  ['wrong_region', 'Не тот регион'],
  ['company_too_small', 'Компания слишком мала'],
  ['company_too_large', 'Компания слишком крупная'],
  ['low_commercial_value', 'Низкая коммерческая ценность'],
  ['internal_recruitment_only', 'Только внутренний рекрутинг'],
  ['no_external_need_signal', 'Нет сигнала внешней потребности'],
  ['weak_evidence', 'Слабые доказательства'],
  ['duplicate', 'Дубликат'],
  ['existing_client', 'Действующий клиент'],
  ['do_not_contact', 'Не связываться'],
  ['wrong_timing', 'Неподходящий момент'],
  ['other', 'Другая причина'],
] as const

const LOST_REASONS = [
  ['no_response', 'Нет ответа'],
  ['not_interested', 'Не заинтересованы'],
  ['wrong_timing', 'Неподходящий момент'],
  ['internal_team', 'Закрывают внутренней командой'],
  ['existing_supplier', 'Есть действующий поставщик'],
  ['price', 'Не устроила цена'],
  ['no_budget', 'Нет бюджета'],
  ['procurement_block', 'Ограничения закупки'],
  ['requirements_changed', 'Изменились требования'],
  ['position_closed', 'Позиция закрыта'],
  ['competitor_won', 'Выбран конкурент'],
  ['contact_unreachable', 'Не удалось связаться'],
  ['other', 'Другая причина'],
] as const

const CHANNELS = [
  ['email', 'Email'],
  ['phone', 'Телефон'],
  ['telegram', 'Telegram'],
  ['vk', 'VK'],
  ['website_form', 'Форма на сайте'],
  ['in_person', 'Лично'],
  ['crm', 'CRM'],
  ['other', 'Другой'],
] as const

const CONTACT_PATHS = [
  ['corporate_email', 'Корпоративный email'],
  ['company_phone', 'Телефон компании'],
  ['website_form', 'Форма на сайте'],
  ['messenger', 'Корпоративный мессенджер'],
  ['social_profile', 'Официальный профиль'],
  ['existing_relationship', 'Существующее знакомство'],
  ['partner_intro', 'Интро партнёра'],
  ['other', 'Другой безопасный путь'],
] as const

export function OpportunityOutcomeImpression(props: {
  opportunityId: string
  cycleId: string
}) {
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    void postOutcome(props.opportunityId, {
      eventType: 'shown',
      occurredAt: new Date().toISOString(),
      metadata: { surface: 'morning_brief', cycleId: props.cycleId },
      idempotencyKey: `shown:${props.opportunityId}:${props.cycleId}`,
    }).catch(() => {
      sent.current = false
    })
  }, [props.cycleId, props.opportunityId])
  return null
}

export function OpportunityOutcomePanel(props: {
  opportunityId: string
  fallbackStage: string
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [pending, setPending] = useState<OutcomeAction | 'opened' | null>(null)
  const [selectedAction, setSelectedAction] = useState<OutcomeAction | null>(null)
  const [reasonCode, setReasonCode] = useState('')
  const [reasonNote, setReasonNote] = useState('')
  const [channel, setChannel] = useState('')
  const [contactPathType, setContactPathType] = useState('')
  const [snoozeDays, setSnoozeDays] = useState('7')
  const [snoozedUntil, setSnoozedUntil] = useState('')
  const [dealValue, setDealValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const openedSent = useRef(false)
  const interactionId = useRef(createKey())
  const retryKeys = useRef<Partial<Record<OutcomeAction, string>>>({})
  const fallbackStage = isStage(props.fallbackStage) ? props.fallbackStage : 'new'
  const stage = history?.state?.currentStage ?? fallbackStage
  const workflowState = history?.state?.workflowState ?? 'active'
  const latestCommercialEvent = [...(history?.events ?? [])]
    .reverse()
    .find((event) => [
      'accepted', 'dismissed', 'contacted', 'replied',
      'meeting', 'proposal', 'won', 'lost',
    ].includes(event.eventType))

  async function toggle() {
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (!nextExpanded) return
    setError(null)
    if (!openedSent.current) {
      openedSent.current = true
      setPending('opened')
      await postOutcome(props.opportunityId, {
        eventType: 'opened',
        occurredAt: new Date().toISOString(),
        metadata: { interactionId: interactionId.current },
        idempotencyKey: `opened:${props.opportunityId}:${interactionId.current}`,
      }).catch(() => {
        openedSent.current = false
      })
    }
    try {
      await loadHistory()
    } catch {
      setError('Коммерческая история временно недоступна.')
    } finally {
      setPending(null)
    }
  }

  async function loadHistory() {
    const response = await fetch(`/api/opportunities/${props.opportunityId}/outcomes`, {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('history_failed')
    setHistory(await response.json() as HistoryResponse)
  }

  function selectAction(action: OutcomeAction) {
    setError(null)
    if (requiresDetails(action)) {
      setSelectedAction(action)
      return
    }
    void submit(action)
  }

  async function submit(action: OutcomeAction) {
    const validationError = validateDetails(
      action,
      reasonCode,
      reasonNote,
      channel,
      contactPathType,
      dealValue,
      snoozeDays,
      snoozedUntil,
    )
    if (validationError) {
      setError(validationError)
      return
    }
    const idempotencyKey = retryKeys.current[action] ?? createKey()
    retryKeys.current[action] = idempotencyKey
    setPending(action)
    setError(null)
    try {
      const body = actionPayload(
        action,
        idempotencyKey,
        reasonCode,
        reasonNote,
        channel,
        contactPathType,
        dealValue,
        snoozeDays,
        snoozedUntil,
        latestCommercialEvent?.appendOrder ?? null,
      )
      const legacyAction = ['accepted', 'dismissed', 'contacted']
        .includes(action)
      const response = await fetch(
        `/api/opportunities/${props.opportunityId}/${legacyAction ? 'action' : 'outcomes'}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(body),
        },
      )
      if (!response.ok) {
        const responseBody = await response.json().catch(() => null) as {
          error?: string
        } | null
        throw new Error(responseBody?.error ?? 'action_failed')
      }
      delete retryKeys.current[action]
      setSelectedAction(null)
      setReasonCode('')
      setReasonNote('')
      setChannel('')
      setContactPathType('')
      setDealValue('')
      await loadHistory()
      router.refresh()
    } catch (submitError) {
      setError(outcomeErrorMessage(submitError))
    } finally {
      setPending(null)
    }
  }

  return (
    <section className={styles.outcomePanel} aria-label="Коммерческий статус">
      <button
        type="button"
        className={styles.outcomeToggle}
        aria-expanded={expanded}
        aria-label={expanded ? 'Свернуть' : 'Коммерческий статус'}
        onClick={() => void toggle()}
      >
        <span>
          <small>Коммерческий статус</small>
          <strong>{STAGE_LABELS[stage]}</strong>
        </span>
        <span>{expanded ? 'Свернуть' : 'Коммерческий статус'}</span>
      </button>

      {expanded ? (
        <div className={styles.outcomeBody}>
          {pending === 'opened' && !history ? (
            <p className={styles.outcomeMuted}>Загружаем историю…</p>
          ) : null}
          {history?.state?.lastEventAt ? (
            <p className={styles.outcomeMuted}>
              Последнее событие: {formatDateTime(history.state.lastEventAt)}
            </p>
          ) : null}
          {history?.state ? (
            <p className={styles.outcomeMuted}>
              Процесс: {workflowState === 'snoozed'
                ? `отложено до ${formatDateTime(history.state.snoozedUntil ?? '')}`
                : 'активен'}
            </p>
          ) : null}
          {history?.state?.currentStage === 'won' &&
          history.state.dealValueMinor != null && history.state.currency ? (
            <p className={styles.dealValue}>
              <span>Сумма подтверждённой сделки</span>
              <strong>{formatMoney(
                history.state.dealValueMinor,
                history.state.currency,
              )}</strong>
            </p>
          ) : null}

          {history?.events.length ? (
            <ol className={styles.outcomeTimeline}>
              {history.events.map((event, index) => (
                <li key={`${event.eventType}:${event.occurredAt}:${index}`}>
                  <span>{formatDateTime(event.occurredAt)}</span>
                  <strong>{event.label}</strong>
                  {event.reason ? <small>{event.reason.label}</small> : null}
                  {event.channel ? <small>Канал: {event.channel}</small> : null}
                  {event.contactPathType ? (
                    <small>Путь контакта: {event.contactPathType}</small>
                  ) : null}
                  {event.contactReferenceLabel ? (
                    <small>Контакт: {event.contactReferenceLabel}</small>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : history ? (
            <p className={styles.outcomeMuted}>Событий пока нет.</p>
          ) : null}

          {workflowState === 'snoozed' ? (
            <div className={styles.outcomeActions}>
              <button
                type="button"
                className={styles.actionButton}
                data-tone="primary"
                disabled={pending !== null}
                onClick={() => selectAction('resumed')}
              >
                {pending === 'resumed' ? 'Возобновляем…' : 'Возобновить'}
              </button>
            </div>
          ) : NEXT_ACTIONS[stage].length > 0 ? (
            <div className={styles.outcomeActions} aria-label="Следующие коммерческие действия">
              {NEXT_ACTIONS[stage].map((action) => (
                <button
                  key={action}
                  type="button"
                  className={styles.actionButton}
                  data-tone={action === 'accepted' || action === 'won' ? 'primary' : 'neutral'}
                  disabled={pending !== null}
                  onClick={() => selectAction(action)}
                >
                  {pending === action ? 'Сохраняем…' : ACTION_LABELS[action]}
                </button>
              ))}
              <button
                type="button"
                className={styles.actionButton}
                disabled={pending !== null}
                onClick={() => selectAction('snoozed')}
              >
                {pending === 'snoozed' ? 'Сохраняем…' : 'Отложить'}
              </button>
            </div>
          ) : (
            <p className={styles.outcomeMuted}>Коммерческий цикл завершён.</p>
          )}
          {workflowState === 'active' && latestCommercialEvent ? (
            <button
              type="button"
              className={styles.actionButton}
              disabled={pending !== null}
              onClick={() => selectAction('reverted')}
            >
              {pending === 'reverted'
                ? 'Отменяем…'
                : 'Отменить последнее изменение'}
            </button>
          ) : null}

          {selectedAction ? (
            <OutcomeDetailsForm
              action={selectedAction}
              reasonCode={reasonCode}
              reasonNote={reasonNote}
              channel={channel}
              contactPathType={contactPathType}
              snoozeDays={snoozeDays}
              snoozedUntil={snoozedUntil}
              dealValue={dealValue}
              pending={pending !== null}
              onReasonCode={setReasonCode}
              onReasonNote={setReasonNote}
              onChannel={setChannel}
              onContactPathType={setContactPathType}
              onSnoozeDays={setSnoozeDays}
              onSnoozedUntil={setSnoozedUntil}
              onDealValue={setDealValue}
              onCancel={() => setSelectedAction(null)}
              onSubmit={() => void submit(selectedAction)}
            />
          ) : null}
          <p className={styles.actionError} role="status" aria-live="polite">
            {error}
          </p>
        </div>
      ) : null}
    </section>
  )
}

function OutcomeDetailsForm(props: {
  action: OutcomeAction
  reasonCode: string
  reasonNote: string
  channel: string
  contactPathType: string
  snoozeDays: string
  snoozedUntil: string
  dealValue: string
  pending: boolean
  onReasonCode: (value: string) => void
  onReasonNote: (value: string) => void
  onChannel: (value: string) => void
  onContactPathType: (value: string) => void
  onSnoozeDays: (value: string) => void
  onSnoozedUntil: (value: string) => void
  onDealValue: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const reasons = props.action === 'dismissed'
    ? DISMISSED_REASONS
    : LOST_REASONS
  return (
    <div className={styles.outcomeForm}>
      {props.action === 'dismissed' || props.action === 'lost' ? (
        <>
          <label>
            Причина
            <select
              value={props.reasonCode}
              onChange={(event) => props.onReasonCode(event.target.value)}
            >
              <option value="">Выберите причину</option>
              {reasons.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
          {props.reasonCode === 'other' ? (
            <label>
              Комментарий к причине
              <textarea
                maxLength={500}
                value={props.reasonNote}
                onChange={(event) => props.onReasonNote(event.target.value)}
              />
            </label>
          ) : null}
        </>
      ) : null}
      {props.action === 'contacted' ? (
        <>
          <label>
            Канал обращения
            <select
              value={props.channel}
              onChange={(event) => props.onChannel(event.target.value)}
            >
              <option value="">Выберите канал</option>
              {CHANNELS.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            Безопасный путь контакта
            <select
              value={props.contactPathType}
              onChange={(event) => props.onContactPathType(event.target.value)}
            >
              <option value="">Выберите путь</option>
              {CONTACT_PATHS.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {props.action === 'snoozed' ? (
        <>
          <label>
            Отложить на
            <select
              value={props.snoozeDays}
              onChange={(event) => {
                props.onSnoozeDays(event.target.value)
                props.onSnoozedUntil('')
              }}
            >
              {[1, 3, 7, 14, 30].map((days) => (
                <option key={days} value={days}>{days} дн.</option>
              ))}
            </select>
          </label>
          <label>
            Или до даты
            <input
              type="date"
              min={dateAfterDays(1)}
              max={dateAfterDays(90)}
              value={props.snoozedUntil}
              onChange={(event) => props.onSnoozedUntil(event.target.value)}
            />
          </label>
        </>
      ) : null}
      {props.action === 'won' ? (
        <label>
          Сумма подтверждённой сделки, ₽ (необязательно)
          <input
            inputMode="decimal"
            placeholder="350000"
            value={props.dealValue}
            onChange={(event) => props.onDealValue(event.target.value)}
          />
        </label>
      ) : null}
      <div className={styles.outcomeFormActions}>
        <button
          type="button"
          className={styles.actionButton}
          data-tone="primary"
          disabled={props.pending}
          onClick={props.onSubmit}
        >
          Сохранить
        </button>
        <button
          type="button"
          className={styles.actionButton}
          disabled={props.pending}
          onClick={props.onCancel}
        >
          Отмена
        </button>
      </div>
    </div>
  )
}

function actionPayload(
  action: OutcomeAction,
  idempotencyKey: string,
  reasonCode: string,
  reasonNote: string,
  channel: string,
  contactPathType: string,
  dealValue: string,
  snoozeDays: string,
  snoozedUntil: string,
  revertsEventId: string | null,
) {
  if (['accepted', 'dismissed', 'contacted'].includes(action)) {
    return {
      action,
      ...(action === 'dismissed' ? {
        reasonCode,
        ...(reasonNote.trim() ? { note: reasonNote.trim() } : {}),
      } : {}),
      ...(action === 'contacted' ? { channel, contactPathType } : {}),
    }
  }
  const valueMinor = action === 'won' && dealValue.trim()
    ? rublesToMinor(dealValue)
    : null
  return {
    eventType: action,
    occurredAt: new Date().toISOString(),
    reasonCode: action === 'lost' ? reasonCode : null,
    reasonNote: action === 'lost' && reasonNote.trim() ? reasonNote.trim() : null,
    channel: null,
    contactPathType: null,
    ...(action === 'snoozed'
      ? snoozedUntil
        ? { snoozedUntil: new Date(`${snoozedUntil}T23:59:59`).toISOString() }
        : { snoozeDays: Number(snoozeDays) }
      : {}),
    ...(action === 'reverted' ? { revertsEventId } : {}),
    valueMinor,
    currency: valueMinor === null ? null : 'RUB',
    metadata: action === 'meeting' ? { meetingStatus: 'scheduled' } : {},
    idempotencyKey,
  }
}

function validateDetails(
  action: OutcomeAction,
  reasonCode: string,
  reasonNote: string,
  channel: string,
  contactPathType: string,
  dealValue: string,
  snoozeDays: string,
  snoozedUntil: string,
): string | null {
  if ((action === 'dismissed' || action === 'lost') && !reasonCode) {
    return 'Выберите нормализованную причину.'
  }
  if ((action === 'dismissed' || action === 'lost') &&
    reasonCode === 'other' && !reasonNote.trim()) {
    return 'Для другой причины добавьте короткий комментарий.'
  }
  if (action === 'contacted' && !channel) return 'Выберите канал обращения.'
  if (action === 'contacted' && !contactPathType) {
    return 'Выберите безопасный путь контакта.'
  }
  if (
    action === 'snoozed' &&
    !snoozedUntil &&
    !['1', '3', '7', '14', '30'].includes(snoozeDays)
  ) {
    return 'Выберите срок отложения.'
  }
  if (action === 'won' && dealValue.trim()) {
    try {
      rublesToMinor(dealValue)
    } catch {
      return 'Введите неотрицательную сумму с точностью не более двух знаков.'
    }
  }
  return null
}

function dateAfterDays(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function requiresDetails(action: OutcomeAction): boolean {
  return ['dismissed', 'snoozed', 'contacted', 'won', 'lost'].includes(action)
}

function outcomeErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'outcome_chronology_conflict') {
    return 'Дата события раньше последнего коммерческого этапа.'
  }
  if (
    code === 'outcome_transition_conflict' ||
    code === 'opportunity_transition_conflict' ||
    code === 'outcome_correction_conflict'
  ) {
    return 'Статус уже изменился. Обновите историю и повторите действие.'
  }
  if (code === 'idempotency_key_conflict') {
    return 'Повторный запрос отличается от исходного. Начните действие заново.'
  }
  if (code === 'opportunity_superseded') {
    return 'Эта версия возможности уже заменена новой.'
  }
  if (
    code === 'outcome_contact_privacy_unavailable' ||
    code === 'opportunity_outcome_failed'
  ) {
    return 'Сервис результатов временно недоступен.'
  }
  return 'Результат не сохранился. Повторите попытку — ключ останется тем же.'
}

async function postOutcome(
  opportunityId: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`/api/opportunities/${opportunityId}/outcomes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': String(payload.idempotencyKey),
    },
    body: JSON.stringify(payload),
    keepalive: true,
  })
  if (!response.ok) throw new Error('outcome_failed')
}

function rublesToMinor(value: string): number {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('invalid_money')
  const [rubles, kopecks = ''] = normalized.split('.')
  const minor = BigInt(rubles) * BigInt(100) + BigInt(kopecks.padEnd(2, '0'))
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid_money')
  return Number(minor)
}

function formatMoney(valueMinor: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: valueMinor % 100 === 0 ? 0 : 2,
  }).format(valueMinor / 100)
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'дата не указана'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function isStage(value: string): value is OutcomeStage {
  return value in STAGE_LABELS
}

function createKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const entropy = new Uint32Array(4)
  crypto.getRandomValues(entropy)
  return Array.from(entropy, (part) => part.toString(16).padStart(8, '0')).join('')
}
