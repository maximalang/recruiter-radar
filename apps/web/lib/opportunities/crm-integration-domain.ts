export const CRM_INTEGRATION_PROVIDERS = [
  'generic',
  'n8n',
  'amocrm',
  'bitrix24',
] as const

export const CRM_INBOUND_EVENT_TYPES = [
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
] as const

export type CrmIntegrationProvider =
  (typeof CRM_INTEGRATION_PROVIDERS)[number]
export type CrmInboundEventType = (typeof CRM_INBOUND_EVENT_TYPES)[number]

export interface NormalizedCrmIntegrationInput {
  provider: CrmIntegrationProvider
  displayName: string
  outboundWebhookUrl: string | null
  allowedEventTypes: CrmInboundEventType[]
  rateLimitMaxRequests: number
  rateLimitWindowSeconds: number
  replayWindowSeconds: number
}

export class CrmIntegrationValidationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'CrmIntegrationValidationError'
  }
}

export function normalizeCrmIntegrationInput(
  value: unknown,
): NormalizedCrmIntegrationInput {
  const input = objectValue(value, 'crm_integration_payload_invalid')
  const provider = input.provider
  if (
    typeof provider !== 'string' ||
    !(CRM_INTEGRATION_PROVIDERS as readonly string[]).includes(provider)
  ) {
    throw new CrmIntegrationValidationError('crm_provider_invalid')
  }

  if (typeof input.displayName !== 'string') {
    throw new CrmIntegrationValidationError('crm_display_name_invalid')
  }
  const displayName = input.displayName.trim()
  if (
    displayName.length < 1 ||
    displayName.length > 120 ||
    /[\u0000-\u001F\u007F]/.test(displayName)
  ) {
    throw new CrmIntegrationValidationError('crm_display_name_invalid')
  }

  const allowedEventTypes = normalizeAllowedEventTypes(
    input.allowedEventTypes,
  )
  const rateLimitPolicy = input.rateLimitPolicy === undefined
    ? {}
    : objectValue(input.rateLimitPolicy, 'crm_rate_limit_policy_invalid')
  const rateLimitMaxRequests = boundedInteger(
    rateLimitPolicy.maxRequests ?? 60,
    1,
    1_000,
    'crm_rate_limit_policy_invalid',
  )
  const rateLimitWindowSeconds = boundedInteger(
    rateLimitPolicy.windowSeconds ?? 60,
    1,
    3_600,
    'crm_rate_limit_policy_invalid',
  )
  const replayWindowSeconds = boundedInteger(
    input.replayWindowSeconds ?? 300,
    30,
    900,
    'crm_replay_window_invalid',
  )

  return {
    provider: provider as CrmIntegrationProvider,
    displayName,
    outboundWebhookUrl: normalizeOutboundUrl(input.outboundWebhookUrl),
    allowedEventTypes,
    rateLimitMaxRequests,
    rateLimitWindowSeconds,
    replayWindowSeconds,
  }
}

function normalizeAllowedEventTypes(value: unknown): CrmInboundEventType[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 13) {
    throw new CrmIntegrationValidationError(
      'crm_allowed_event_types_invalid',
    )
  }
  const known = new Set<string>(CRM_INBOUND_EVENT_TYPES)
  if (value.some((eventType) =>
    typeof eventType !== 'string' || !known.has(eventType))) {
    throw new CrmIntegrationValidationError(
      'crm_allowed_event_types_invalid',
    )
  }
  const requested = new Set(value as CrmInboundEventType[])
  return CRM_INBOUND_EVENT_TYPES.filter((eventType) => requested.has(eventType))
}

function normalizeOutboundUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2_048 || value.trim() !== value) {
    throw new CrmIntegrationValidationError('crm_outbound_url_invalid')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CrmIntegrationValidationError('crm_outbound_url_invalid')
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.hostname.toLowerCase() === 'localhost' ||
    url.hostname.toLowerCase().endsWith('.localhost')
  ) {
    throw new CrmIntegrationValidationError('crm_outbound_url_invalid')
  }
  return url.href
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new CrmIntegrationValidationError(code)
  }
  return Number(value)
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CrmIntegrationValidationError(code)
  }
  return value as Record<string, unknown>
}
