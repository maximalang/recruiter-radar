import { createHmac } from 'node:crypto'

export interface ProtectedContactReference {
  hash: string
  label: string
}

export class OutcomeContactPrivacyUnavailableError extends Error {
  readonly code = 'outcome_contact_privacy_unavailable'

  constructor() {
    super('Outcome contact privacy key is not configured.')
    this.name = 'OutcomeContactPrivacyUnavailableError'
  }
}

export function protectOutcomeContactReference(
  ownerId: string | number,
  rawReference: string | null,
): ProtectedContactReference | null {
  if (!rawReference) return null
  const secret = process.env.OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new OutcomeContactPrivacyUnavailableError()
  }
  const normalized = rawReference.trim().toLowerCase()
  return {
    hash: createHmac('sha256', secret)
      .update(`${String(ownerId)}\0${normalized}`)
      .digest('hex'),
    label: redactContactReference(rawReference),
  }
}

function redactContactReference(value: string): string {
  const normalized = value.trim()
  const email = /^([^@\s]+)@([^@\s]+)$/.exec(normalized)
  if (email) {
    const local = email[1]
    return `${local.slice(0, 1)}***@${email[2]}`
  }
  const digits = normalized.replace(/\D/g, '')
  if (digits.length >= 7) {
    const prefix = normalized.startsWith('+') ? '+' : ''
    return `${prefix}${digits.slice(0, 1)} *** ***-${digits.slice(-4, -2)}-${digits.slice(-2)}`
  }
  try {
    const url = new URL(normalized)
    return `${url.protocol}//${url.hostname}/…`
  } catch {
    return `${normalized.slice(0, 1)}***`
  }
}
