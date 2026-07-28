import { hashCanonicalJson } from './canonical-hash'

export const OPPORTUNITY_OUTCOME_EVENT_TYPES = [
  'shown',
  'opened',
  'accepted',
  'dismissed',
  'snoozed',
  'resumed',
  'contacted',
  'replied',
  'meeting',
  'meeting_completed',
  'meeting_cancelled',
  'meeting_no_show',
  'proposal',
  'won',
  'lost',
  'exported',
  'reverted',
] as const

export type OpportunityOutcomeEventType =
  (typeof OPPORTUNITY_OUTCOME_EVENT_TYPES)[number]

export const OPPORTUNITY_OUTCOME_STAGES = [
  'new',
  'review',
  'accepted',
  'dismissed',
  'contacted',
  'replied',
  'meeting',
  'proposal',
  'won',
  'lost',
] as const

export type OpportunityOutcomeStage =
  (typeof OPPORTUNITY_OUTCOME_STAGES)[number]

export const OPPORTUNITY_OUTCOME_WORKFLOW_STATES = [
  'active',
  'snoozed',
] as const

export type OpportunityOutcomeWorkflowState =
  (typeof OPPORTUNITY_OUTCOME_WORKFLOW_STATES)[number]

export const OPPORTUNITY_MEETING_STATUSES = [
  'none',
  'scheduled',
  'completed',
  'cancelled',
  'no_show',
] as const

export type OpportunityMeetingStatus =
  (typeof OPPORTUNITY_MEETING_STATUSES)[number]

export const DISMISSED_REASON_CODES = [
  'bad_fit',
  'wrong_roles',
  'wrong_industry',
  'wrong_region',
  'company_too_small',
  'company_too_large',
  'low_commercial_value',
  'internal_recruitment_only',
  'no_external_need_signal',
  'weak_evidence',
  'duplicate',
  'existing_client',
  'do_not_contact',
  'wrong_timing',
  'other',
] as const

export type DismissedReasonCode = (typeof DISMISSED_REASON_CODES)[number]

export const LOST_REASON_CODES = [
  'no_response',
  'not_interested',
  'wrong_timing',
  'internal_team',
  'existing_supplier',
  'price',
  'no_budget',
  'procurement_block',
  'requirements_changed',
  'position_closed',
  'competitor_won',
  'contact_unreachable',
  'other',
] as const

export type LostReasonCode = (typeof LOST_REASON_CODES)[number]
export type OpportunityOutcomeReasonCode = DismissedReasonCode | LostReasonCode

export const OPPORTUNITY_OUTCOME_CHANNELS = [
  'email',
  'phone',
  'telegram',
  'vk',
  'linkedin',
  'website_form',
  'in_person',
  'crm',
  'other',
] as const

export type OpportunityOutcomeChannel =
  (typeof OPPORTUNITY_OUTCOME_CHANNELS)[number]

export const OPPORTUNITY_CONTACT_PATH_TYPES = [
  'corporate_email',
  'named_work_email',
  'company_phone',
  'named_work_phone',
  'messenger',
  'website_form',
  'social_profile',
  'existing_relationship',
  'partner_intro',
  'other',
] as const

export type OpportunityContactPathType =
  (typeof OPPORTUNITY_CONTACT_PATH_TYPES)[number]

export const OUTCOME_EVENT_LABELS: Readonly<
  Record<OpportunityOutcomeEventType, string>
> = {
  shown: 'Показано',
  opened: 'Открыто',
  accepted: 'Взято в работу',
  dismissed: 'Отклонено',
  snoozed: 'Отложено',
  resumed: 'Возобновлено',
  contacted: 'Связались',
  replied: 'Получен ответ',
  meeting: 'Встреча назначена',
  meeting_completed: 'Встреча проведена',
  meeting_cancelled: 'Встреча отменена',
  meeting_no_show: 'Встреча не состоялась',
  proposal: 'Предложение',
  won: 'Выиграно',
  lost: 'Потеряно',
  exported: 'Экспортировано',
  reverted: 'Последнее изменение отменено',
}

export const OUTCOME_REASON_LABELS: Readonly<Record<string, string>> = {
  bad_fit: 'Не подходит профилю агентства',
  wrong_roles: 'Не те роли',
  wrong_industry: 'Не та отрасль',
  wrong_region: 'Не тот регион',
  company_too_small: 'Компания слишком мала',
  company_too_large: 'Компания слишком крупная',
  low_commercial_value: 'Низкая коммерческая ценность',
  internal_recruitment_only: 'Только внутренний рекрутинг',
  no_external_need_signal: 'Нет сигнала внешней потребности',
  weak_evidence: 'Слабые доказательства',
  duplicate: 'Дубликат',
  existing_client: 'Действующий клиент',
  do_not_contact: 'Не связываться',
  wrong_timing: 'Неподходящий момент',
  no_response: 'Нет ответа',
  not_interested: 'Не заинтересованы',
  internal_team: 'Закрывают внутренней командой',
  existing_supplier: 'Есть действующий поставщик',
  price: 'Не устроила цена',
  no_budget: 'Нет бюджета',
  procurement_block: 'Ограничения закупки',
  requirements_changed: 'Изменились требования',
  position_closed: 'Позиция закрыта',
  competitor_won: 'Выбран конкурент',
  contact_unreachable: 'Не удалось связаться',
  other: 'Другая причина',
}

const OBSERVATIONAL_EVENTS = new Set<OpportunityOutcomeEventType>([
  'shown',
  'opened',
  'exported',
])

const MEETING_LIFECYCLE_EVENTS = new Set<OpportunityOutcomeEventType>([
  'meeting',
  'meeting_completed',
  'meeting_cancelled',
  'meeting_no_show',
])

const WORKFLOW_EVENTS = new Set<OpportunityOutcomeEventType>([
  'snoozed',
  'resumed',
])

const COMMERCIAL_STAGE_EVENTS = new Set<OpportunityOutcomeEventType>([
  'accepted',
  'dismissed',
  'contacted',
  'replied',
  'meeting',
  'proposal',
  'won',
  'lost',
])

const ALLOWED_STAGE_EVENTS: Readonly<
  Record<OpportunityOutcomeStage, readonly OpportunityOutcomeEventType[]>
> = {
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

const ALLOWED_METADATA_KEYS = new Set([
  'meetingStatus',
  'surface',
  'cycleId',
  'interactionId',
  'source',
  'exportFormat',
])

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
const MAX_PAYLOAD_BYTES = 16 * 1024
const MAX_METADATA_BYTES = 4 * 1024

export class OutcomeValidationError extends Error {
  readonly code = 'invalid_outcome'

  constructor(message: string) {
    super(message)
    this.name = 'OutcomeValidationError'
  }
}

export interface OpportunityOutcomeInput {
  eventType: OpportunityOutcomeEventType
  occurredAt: string
  reasonCode: OpportunityOutcomeReasonCode | null
  reasonNote: string | null
  channel: OpportunityOutcomeChannel | null
  contactPathType: OpportunityContactPathType | null
  contactReference: string | null
  snoozeDays: number | null
  snoozedUntil: string | null
  revertsEventId: string | null
  valueMinor: number | null
  currency: 'RUB' | null
  metadata: Record<string, string>
  idempotencyKey: string
}

export interface OutcomeProjectionEvent {
  id: string
  eventType: OpportunityOutcomeEventType
  previousStage: OpportunityOutcomeStage
  newStage: OpportunityOutcomeStage
  occurredAt: string
  reasonCode: OpportunityOutcomeReasonCode | null
  valueMinor: number | null
  currency: 'RUB' | null
  snoozedUntil?: string | null
  meetingStatus?: 'scheduled' | 'completed' | null
  revertsEventId?: string | null
  revertedEventType?: OpportunityOutcomeEventType | null
}

export interface OpportunityOutcomeProjection {
  commercialStage: OpportunityOutcomeStage
  currentStage: OpportunityOutcomeStage
  workflowState: OpportunityOutcomeWorkflowState
  snoozedUntil: string | null
  lastEventId: string
  lastEventAt: string
  lastStageEventId: string | null
  lastStageEventAt: string | null
  firstShownAt: string | null
  firstOpenedAt: string | null
  acceptedAt: string | null
  contactedAt: string | null
  repliedAt: string | null
  meetingAt: string | null
  proposalAt: string | null
  wonAt: string | null
  lostAt: string | null
  dismissReasonCode: DismissedReasonCode | null
  lostReasonCode: LostReasonCode | null
  dealValueMinor: number | null
  currency: 'RUB' | null
  meetingStatus: OpportunityMeetingStatus
  activeMeetingEventId: string | null
  lastMeetingEventAt: string | null
  meetingAttemptCount: number
}

export function isOutcomeEventType(
  value: unknown,
): value is OpportunityOutcomeEventType {
  return typeof value === 'string' &&
    OPPORTUNITY_OUTCOME_EVENT_TYPES.includes(
      value as OpportunityOutcomeEventType,
    )
}

export function isOutcomeTransitionAllowed(
  stage: OpportunityOutcomeStage,
  eventType: OpportunityOutcomeEventType,
  workflowState: OpportunityOutcomeWorkflowState = 'active',
  meetingStatus: OpportunityMeetingStatus = 'none',
): boolean {
  if (OBSERVATIONAL_EVENTS.has(eventType)) return true
  if (eventType === 'snoozed') return workflowState === 'active'
  if (eventType === 'resumed') return workflowState === 'snoozed'
  if (eventType === 'reverted') return workflowState === 'active'
  if (workflowState === 'snoozed') return false
  if (eventType === 'meeting') {
    return (
      (stage === 'replied' && meetingStatus === 'none') ||
      (stage === 'meeting' &&
        (meetingStatus === 'cancelled' || meetingStatus === 'no_show'))
    )
  }
  if (
    eventType === 'meeting_completed' ||
    eventType === 'meeting_cancelled' ||
    eventType === 'meeting_no_show'
  ) {
    return stage === 'meeting' && meetingStatus === 'scheduled'
  }
  if (eventType === 'proposal' && stage === 'meeting') {
    return meetingStatus === 'completed'
  }
  return ALLOWED_STAGE_EVENTS[stage].includes(eventType)
}

export function getNextOutcomeStage(
  stage: OpportunityOutcomeStage,
  eventType: OpportunityOutcomeEventType,
  workflowState: OpportunityOutcomeWorkflowState = 'active',
  meetingStatus: OpportunityMeetingStatus = 'none',
): OpportunityOutcomeStage {
  if (
    OBSERVATIONAL_EVENTS.has(eventType) ||
    (
      MEETING_LIFECYCLE_EVENTS.has(eventType) &&
      stage === 'meeting'
    ) ||
    WORKFLOW_EVENTS.has(eventType) ||
    eventType === 'reverted'
  ) {
    return stage
  }
  if (!isOutcomeTransitionAllowed(
    stage,
    eventType,
    workflowState,
    meetingStatus,
  )) {
    throw new OutcomeValidationError('Outcome transition is not allowed.')
  }
  return eventType as OpportunityOutcomeStage
}

export function validateOutcomeInput(
  input: unknown,
  now = new Date(),
): OpportunityOutcomeInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new OutcomeValidationError('Outcome payload must be an object.')
  }
  if (byteLength(input) > MAX_PAYLOAD_BYTES) {
    throw new OutcomeValidationError('Outcome payload is too large.')
  }

  const payload = input as Record<string, unknown>
  const allowedInputKeys = new Set([
    'eventType',
    'occurredAt',
    'reasonCode',
    'reasonNote',
    'channel',
    'contactPathType',
    'contactReference',
    'snoozeDays',
    'snoozedUntil',
    'revertsEventId',
    'valueMinor',
    'currency',
    'metadata',
    'idempotencyKey',
  ])
  if (Object.keys(payload).some((key) => !allowedInputKeys.has(key))) {
    throw new OutcomeValidationError('Outcome payload contains unknown fields.')
  }
  if (!isOutcomeEventType(payload.eventType)) {
    throw new OutcomeValidationError('Unsupported outcome event type.')
  }

  const occurredAt = parseOccurredAt(payload.occurredAt, now)
  const idempotencyKey = requiredTrimmedString(
    payload.idempotencyKey,
    'idempotencyKey',
    160,
  )
  const reasonNote = optionalTrimmedString(payload.reasonNote, 'reasonNote', 500)
  const reasonCode = validateReasonCode(payload.eventType, payload.reasonCode)
  if (reasonCode === 'other' && !reasonNote) {
    throw new OutcomeValidationError('reasonNote is required for other.')
  }
  if (!reasonCode && reasonNote) {
    throw new OutcomeValidationError('reasonNote requires reasonCode.')
  }

  const channel = optionalEnum(
    payload.channel,
    OPPORTUNITY_OUTCOME_CHANNELS,
    'channel',
  )
  if (payload.eventType === 'contacted' && !channel) {
    throw new OutcomeValidationError('channel is required for contacted.')
  }
  const contactPathType = optionalEnum(
    payload.contactPathType,
    OPPORTUNITY_CONTACT_PATH_TYPES,
    'contactPathType',
  )
  const contactReference = optionalTrimmedString(
    payload.contactReference,
    'contactReference',
    320,
  )
  const { snoozeDays, snoozedUntil } = validateSnooze(
    payload.eventType,
    payload.snoozeDays,
    payload.snoozedUntil,
    occurredAt,
  )
  const revertsEventId = validateRevertsEventId(
    payload.eventType,
    payload.revertsEventId,
  )

  const { valueMinor, currency } = validateMoney(
    payload.eventType,
    payload.valueMinor,
    payload.currency,
  )
  const metadata = validateMetadata(payload.eventType, payload.metadata)

  return {
    eventType: payload.eventType,
    occurredAt,
    reasonCode,
    reasonNote,
    channel,
    contactPathType,
    contactReference,
    snoozeDays,
    snoozedUntil,
    revertsEventId,
    valueMinor,
    currency,
    metadata,
    idempotencyKey,
  }
}

export function hashOutcomePayload(value: unknown): string {
  return hashCanonicalJson(value)
}

export function reduceOutcomeProjection(
  state: OpportunityOutcomeProjection | null,
  event: OutcomeProjectionEvent,
): OpportunityOutcomeProjection {
  const projection: OpportunityOutcomeProjection = state
    ? { ...state }
    : {
        commercialStage: event.previousStage,
        currentStage: event.previousStage,
        workflowState: 'active',
        snoozedUntil: null,
        lastEventId: event.id,
        lastEventAt: event.occurredAt,
        lastStageEventId: null,
        lastStageEventAt: null,
        firstShownAt: null,
        firstOpenedAt: null,
        acceptedAt: null,
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
      }

  projection.lastEventId = event.id
  projection.lastEventAt = laterTimestamp(
    projection.lastEventAt,
    event.occurredAt,
  )

  if (event.eventType === 'snoozed') {
    projection.workflowState = 'snoozed'
    projection.snoozedUntil = event.snoozedUntil ?? null
  } else if (event.eventType === 'resumed') {
    projection.workflowState = 'active'
    projection.snoozedUntil = null
  } else if (
    COMMERCIAL_STAGE_EVENTS.has(event.eventType) &&
    (
      event.eventType !== 'meeting' ||
      event.previousStage !== 'meeting'
    )
  ) {
    projection.commercialStage = event.newStage
    projection.currentStage = event.newStage
    projection.lastStageEventId = event.id
    projection.lastStageEventAt = event.occurredAt
  }

  if (event.eventType === 'shown') {
    projection.firstShownAt = earlierTimestamp(
      projection.firstShownAt,
      event.occurredAt,
    )
  } else if (event.eventType === 'opened') {
    projection.firstOpenedAt = earlierTimestamp(
      projection.firstOpenedAt,
      event.occurredAt,
    )
  } else if (event.eventType === 'accepted') {
    projection.acceptedAt = earlierTimestamp(
      projection.acceptedAt,
      event.occurredAt,
    )
  } else if (event.eventType === 'contacted') {
    projection.contactedAt = earlierTimestamp(
      projection.contactedAt,
      event.occurredAt,
    )
  } else if (event.eventType === 'replied') {
    projection.repliedAt = earlierTimestamp(
      projection.repliedAt,
      event.occurredAt,
    )
  } else if (event.eventType === 'meeting') {
    projection.meetingAt = earlierTimestamp(
      projection.meetingAt,
      event.occurredAt,
    )
  } else if (event.eventType === 'proposal') {
    projection.proposalAt = earlierTimestamp(
      projection.proposalAt,
      event.occurredAt,
    )
  } else if (event.eventType === 'won') {
    projection.wonAt = earlierTimestamp(projection.wonAt, event.occurredAt)
    projection.dealValueMinor = event.valueMinor
    projection.currency = event.currency
  } else if (event.eventType === 'lost') {
    projection.lostAt = earlierTimestamp(projection.lostAt, event.occurredAt)
    projection.lostReasonCode = event.reasonCode as LostReasonCode
  } else if (event.eventType === 'dismissed') {
    projection.dismissReasonCode = event.reasonCode as DismissedReasonCode
  } else if (event.eventType === 'reverted' && event.revertedEventType) {
    clearRevertedProjectionFields(projection, event.revertedEventType)
  }

  if (event.eventType === 'meeting') {
    projection.meetingStatus =
      event.meetingStatus === 'completed' ? 'completed' : 'scheduled'
    projection.activeMeetingEventId = event.id
    projection.lastMeetingEventAt = event.occurredAt
    projection.meetingAttemptCount += 1
  } else if (event.eventType === 'meeting_completed') {
    projection.meetingStatus = 'completed'
    projection.lastMeetingEventAt = event.occurredAt
  } else if (event.eventType === 'meeting_cancelled') {
    projection.meetingStatus = 'cancelled'
    projection.lastMeetingEventAt = event.occurredAt
  } else if (event.eventType === 'meeting_no_show') {
    projection.meetingStatus = 'no_show'
    projection.lastMeetingEventAt = event.occurredAt
  }

  return projection
}

function parseOccurredAt(value: unknown, now: Date): string {
  if (typeof value !== 'string' || value.length > 40) {
    throw new OutcomeValidationError('occurredAt must be an ISO timestamp.')
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new OutcomeValidationError('occurredAt must be an ISO timestamp.')
  }
  if (timestamp > now.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new OutcomeValidationError('occurredAt is too far in the future.')
  }
  return new Date(timestamp).toISOString()
}

function validateReasonCode(
  eventType: OpportunityOutcomeEventType,
  value: unknown,
): OpportunityOutcomeReasonCode | null {
  if (eventType === 'dismissed') {
    if (!DISMISSED_REASON_CODES.includes(value as DismissedReasonCode)) {
      throw new OutcomeValidationError(
        'A controlled reasonCode is required for dismissed.',
      )
    }
    return value as DismissedReasonCode
  }
  if (eventType === 'lost') {
    if (!LOST_REASON_CODES.includes(value as LostReasonCode)) {
      throw new OutcomeValidationError(
        'A controlled reasonCode is required for lost.',
      )
    }
    return value as LostReasonCode
  }
  if (value !== undefined && value !== null) {
    throw new OutcomeValidationError(
      'reasonCode is only valid for dismissed or lost.',
    )
  }
  return null
}

function validateMoney(
  eventType: OpportunityOutcomeEventType,
  rawValue: unknown,
  rawCurrency: unknown,
): { valueMinor: number | null; currency: 'RUB' | null } {
  const hasValue = rawValue !== undefined && rawValue !== null
  const hasCurrency = rawCurrency !== undefined && rawCurrency !== null
  if (eventType !== 'won' && (hasValue || hasCurrency)) {
    throw new OutcomeValidationError('Deal value is only valid for won.')
  }
  if (!hasValue && !hasCurrency) return { valueMinor: null, currency: null }
  if (!hasValue || !hasCurrency) {
    throw new OutcomeValidationError(
      'valueMinor and currency must be provided together.',
    )
  }
  if (
    typeof rawValue !== 'number' ||
    !Number.isSafeInteger(rawValue) ||
    rawValue < 0
  ) {
    throw new OutcomeValidationError(
      'valueMinor must be a non-negative safe integer.',
    )
  }
  if (rawCurrency !== 'RUB') {
    throw new OutcomeValidationError('Unsupported currency.')
  }
  return { valueMinor: rawValue, currency: rawCurrency }
}

function validateMetadata(
  eventType: OpportunityOutcomeEventType,
  value: unknown,
): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OutcomeValidationError('metadata must be an object.')
  }
  if (byteLength(value) > MAX_METADATA_BYTES) {
    throw new OutcomeValidationError('metadata is too large.')
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.some(([key]) => !ALLOWED_METADATA_KEYS.has(key))) {
    throw new OutcomeValidationError('metadata contains an unknown field.')
  }
  const metadata: Record<string, string> = {}
  for (const [key, raw] of entries) {
    const normalized = requiredTrimmedString(raw, `metadata.${key}`, 160)
    metadata[key] = normalized
  }
  if (eventType === 'meeting' && metadata.meetingStatus !== 'scheduled') {
    throw new OutcomeValidationError('Invalid meetingStatus metadata.')
  }
  if (eventType !== 'meeting' && metadata.meetingStatus) {
    throw new OutcomeValidationError('meetingStatus is only valid for meeting.')
  }
  return metadata
}

export function isObservationalOutcomeEvent(
  eventType: OpportunityOutcomeEventType,
): boolean {
  return OBSERVATIONAL_EVENTS.has(eventType)
}

export function isCommercialOutcomeEvent(
  eventType: OpportunityOutcomeEventType,
): boolean {
  return COMMERCIAL_STAGE_EVENTS.has(eventType)
}

function validateSnooze(
  eventType: OpportunityOutcomeEventType,
  rawDays: unknown,
  rawUntil: unknown,
  occurredAt: string,
): { snoozeDays: number | null; snoozedUntil: string | null } {
  const hasDays = rawDays !== undefined && rawDays !== null
  const hasUntil = rawUntil !== undefined && rawUntil !== null
  if (eventType !== 'snoozed') {
    if (hasDays || hasUntil) {
      throw new OutcomeValidationError(
        'Snooze duration is only valid for snoozed.',
      )
    }
    return { snoozeDays: null, snoozedUntil: null }
  }
  if (hasDays && hasUntil) {
    throw new OutcomeValidationError(
      'Provide snoozeDays or snoozedUntil, not both.',
    )
  }
  if (hasUntil) {
    const snoozedUntil = parseOccurredAt(rawUntil, new Date('9999-12-31T23:59:59Z'))
    const duration = Date.parse(snoozedUntil) - Date.parse(occurredAt)
    if (duration < 24 * 60 * 60 * 1000 || duration > 90 * 24 * 60 * 60 * 1000) {
      throw new OutcomeValidationError(
        'snoozedUntil must be between 1 and 90 days after occurredAt.',
      )
    }
    return { snoozeDays: null, snoozedUntil }
  }
  const snoozeDays = hasDays ? Number(rawDays) : 7
  if (
    !Number.isInteger(snoozeDays) ||
    snoozeDays < 1 ||
    snoozeDays > 90
  ) {
    throw new OutcomeValidationError('snoozeDays must be an integer from 1 to 90.')
  }
  return {
    snoozeDays,
    snoozedUntil: new Date(
      Date.parse(occurredAt) + snoozeDays * 24 * 60 * 60 * 1000,
    ).toISOString(),
  }
}

function validateRevertsEventId(
  eventType: OpportunityOutcomeEventType,
  value: unknown,
): string | null {
  if (eventType !== 'reverted') {
    if (value !== undefined && value !== null) {
      throw new OutcomeValidationError(
        'revertsEventId is only valid for reverted.',
      )
    }
    return null
  }
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[1-9]\d*$/.test(String(value))
  ) {
    throw new OutcomeValidationError(
      'revertsEventId must be a positive integer.',
    )
  }
  return String(value)
}

function clearRevertedProjectionFields(
  projection: OpportunityOutcomeProjection,
  eventType: OpportunityOutcomeEventType,
): void {
  if (eventType === 'accepted') projection.acceptedAt = null
  else if (eventType === 'contacted') projection.contactedAt = null
  else if (eventType === 'replied') projection.repliedAt = null
  else if (eventType === 'meeting') projection.meetingAt = null
  else if (eventType === 'proposal') projection.proposalAt = null
  else if (eventType === 'won') {
    projection.wonAt = null
    projection.dealValueMinor = null
    projection.currency = null
  } else if (eventType === 'lost') {
    projection.lostAt = null
    projection.lostReasonCode = null
  } else if (eventType === 'dismissed') {
    projection.dismissReasonCode = null
  }
}

function requiredTrimmedString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof value !== 'string') {
    throw new OutcomeValidationError(`${field} must be a string.`)
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maximumLength) {
    throw new OutcomeValidationError(`${field} has an invalid length.`)
  }
  return normalized
}

function optionalTrimmedString(
  value: unknown,
  field: string,
  maximumLength: number,
): string | null {
  if (value === undefined || value === null) return null
  return requiredTrimmedString(value, field, maximumLength)
}

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new OutcomeValidationError(`${field} is not supported.`)
  }
  return value as T[number]
}

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    throw new OutcomeValidationError('Outcome payload is not serializable.')
  }
}

function earlierTimestamp(current: string | null, candidate: string): string {
  if (!current) return candidate
  return Date.parse(candidate) < Date.parse(current) ? candidate : current
}

function laterTimestamp(current: string, candidate: string): string {
  return Date.parse(candidate) > Date.parse(current) ? candidate : current
}
