import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000

export function verifyExternalOutcomeSignature(input: {
  rawBody: string
  timestamp: string | null
  signature: string | null
  secret: string
  now?: Date
}): boolean {
  if (!input.timestamp || !input.signature || !input.secret) return false
  const timestamp = Date.parse(input.timestamp)
  if (!Number.isFinite(timestamp)) return false
  const now = input.now?.getTime() ?? Date.now()
  if (Math.abs(now - timestamp) > MAX_SIGNATURE_AGE_MS) return false
  if (!/^sha256=[a-f0-9]{64}$/.test(input.signature)) return false

  const expected = `sha256=${createHmac('sha256', input.secret)
    .update(input.rawBody)
    .digest('hex')}`
  const expectedBytes = Buffer.from(expected, 'utf8')
  const receivedBytes = Buffer.from(input.signature, 'utf8')
  return expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
}
