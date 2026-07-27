import { hashCanonicalJson } from './canonical-hash'

export const OPPORTUNITY_OUTCOME_EVENT_TYPES = [
  'shown',
  'opened',
  'accepted',
  'dismissed',
  'snoozed',
  'contacted',
  'replied',
  'meeting',
  'proposal',
  'won',
  'lost',
  'exported',
] as const

export type OpportunityOutcomeEventType =
  (typeof OPPORTUNITY_OUTCOME_EVENT_TYPES)[number]

export const OPPORTUNITY_OUTCOME_STAGES = [
  'new',
  'review',
  'accepted',
  'dismissed',
  'snoozed',
  'contacted',
  'replied',
  'meeting',
  'proposal',
  'won',
  'lost',
] as const

export type OpportunityOutcomeStage =
  (typeof OPPORTUNITY_OUTCOME_STAGES)[number]

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
  contacted: 'Связались',
  replied: 'Получен ответ',
  meeting: 'Встреча',
  proposal: 'Предложение',
  won: 'Выиграно',
  lost: 'Потеряно',
  exported: 'Экспортировано',
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

const ALLOWED_STAGE_EVENTS: Readonly<
  Record<OpportunityOutcomeStage, readonly OpportunityOutcomeEventType[]>
> = {
  new: ['accepted', 'dismissed', 'snoozed'],
  review: ['accepted', 'dismissed', 'snoozed'],
  snoozed: ['accepted', 'dismissed'],
  accepted: ['contacted', 'dismissed', 'snoozed'],
  contacted: ['replied', 'lost', 'snoozed'],
  replied: ['meeting', 'lost', 'snoozed'],
  meeting: ['proposal', 'lost', 'snoozed'],
  proposal: ['won', 'lost', 'snoozed'],
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

const ALLOWED_MEETING_STATUSES = new Set([
  'scheduled',
  'completed',
  'cancelled',
  'no_show',
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
}

export interface OpportunityOutcomeProjection {
  currentStage: OpportunityOutcomeStage
  lastEventId: string
  lastEventAt: string
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
): boolean {
  return OBSERVATIONAL_EVENTS.has(eventType) ||
    ALLOWED_STAGE_EVENTS[stage].includes(eventType)
}

export function getNextOutcomeStage(
  stage: OpportunityOutcomeStage,
  eventType: OpportunityOutcomeEventType,
): OpportunityOutcomeStage {
  if (OBSERVATIONAL_EVENTS.has(eventType)) return stage
  if (!isOutcomeTransitionAllowed(stage, eventType)) {
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
        currentStage: event.previousStage,
        lastEventId: event.id,
        lastEventAt: event.occurredAt,
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
      }

  projection.currentStage = event.newStage
  projection.lastEventId = event.id
  projection.lastEventAt = laterTimestamp(
    projection.lastEventAt,
    event.occurredAt,
  )

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
  if (
    metadata.meetingStatus &&
    (eventType !== 'meeting' || !ALLOWED_MEETING_STATUSES.has(metadata.meetingStatus))
  ) {
    throw new OutcomeValidationError('Invalid meetingStatus metadata.')
  }
  return metadata
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
