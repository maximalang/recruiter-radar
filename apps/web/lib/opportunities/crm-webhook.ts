import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

const SECRET_HASH_PATTERN = /^[a-f0-9]{64}$/
const SIGNATURE_PATTERN = /^v1=([a-f0-9]{64})$/
const MAX_RESPONSE_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 5_000

export type CrmDnsLookup = (
  hostname: string,
) => Promise<readonly { address: string; family: number }[]>

export interface PublicWebhookDestination {
  url: URL
  address: string
  family: 4 | 6
}

export interface CrmOutboundAttempt {
  status: 'succeeded' | 'failed'
  httpStatus: number | null
}

export class CrmWebhookDestinationError extends Error {
  readonly code = 'crm_webhook_destination_unsafe'

  constructor() {
    super('crm_webhook_destination_unsafe')
    this.name = 'CrmWebhookDestinationError'
  }
}

export function createCrmWebhookSignature(input: {
  credentialSecretHash: string
  timestamp: string
  eventId: string
  body: string
}): string {
  if (!SECRET_HASH_PATTERN.test(input.credentialSecretHash)) {
    throw new Error('CRM credential hash is invalid.')
  }
  const payload = signaturePayload(input.timestamp, input.eventId, input.body)
  const digest = createHmac(
    'sha256',
    Buffer.from(input.credentialSecretHash, 'hex'),
  ).update(payload, 'utf8').digest('hex')
  return `v1=${digest}`
}

export function verifyCrmWebhookSignature(input: {
  credentialSecretHash: string
  timestamp: string
  eventId: string
  body: string
  signature: string
}): boolean {
  const provided = SIGNATURE_PATTERN.exec(input.signature)?.[1]
  if (!provided || !SECRET_HASH_PATTERN.test(input.credentialSecretHash)) {
    return false
  }
  const expected = createCrmWebhookSignature(input).slice(3)
  return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
}

export async function resolvePublicWebhookDestination(
  rawUrl: string,
  lookupAll: CrmDnsLookup = defaultLookup,
): Promise<PublicWebhookDestination> {
  const url = parseWebhookUrl(rawUrl)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: readonly { address: string; family: number }[]
  try {
    addresses = await lookupAll(hostname)
  } catch {
    throw new CrmWebhookDestinationError()
  }
  if (
    addresses.length < 1 ||
    addresses.some((candidate) =>
      (candidate.family !== 4 && candidate.family !== 6) ||
      !isPublicIp(candidate.address))
  ) {
    throw new CrmWebhookDestinationError()
  }
  const selected = [...addresses]
    .sort((left, right) => left.family - right.family)[0]
  return {
    url,
    address: selected.address,
    family: selected.family as 4 | 6,
  }
}

export async function sendSignedCrmWebhook(input: {
  destinationUrl: string
  credentialReference: string
  credentialSecretHash: string
  timestamp: string
  eventId: string
  body: string
}): Promise<CrmOutboundAttempt> {
  try {
    const destination = await resolvePublicWebhookDestination(
      input.destinationUrl,
    )
    const signature = createCrmWebhookSignature(input)
    const httpStatus = await postJson(destination, input.body, {
      'X-RR-Webhook-Id': input.eventId,
      'X-RR-Webhook-Timestamp': input.timestamp,
      'X-RR-Credential-Id': input.credentialReference,
      'X-RR-Signature': signature,
    })
    return {
      status: httpStatus >= 200 && httpStatus < 300 ? 'succeeded' : 'failed',
      httpStatus,
    }
  } catch {
    return { status: 'failed', httpStatus: null }
  }
}

function signaturePayload(timestamp: string, eventId: string, body: string) {
  return `${timestamp}\n${eventId}\n${body}`
}

async function defaultLookup(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true })
}

function parseWebhookUrl(rawUrl: string): URL {
  if (rawUrl.length > 2_048 || rawUrl.trim() !== rawUrl) {
    throw new CrmWebhookDestinationError()
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new CrmWebhookDestinationError()
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost')
  ) {
    throw new CrmWebhookDestinationError()
  }
  return url
}

function isPublicIp(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) return isPublicIpv6(address)
  return false
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) =>
    !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [a, b, c] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address)
  if (!groups) return false
  const first = groups[0]
  if (first < 0x2000 || first > 0x3fff) return false
  if (first === 0x2001 && groups[1] === 0x0db8) return false
  if (first === 0x2001 && groups[1] === 0x0002) return false
  if (first === 0x2002) return false
  return true
}

function expandIpv6(address: string): number[] | null {
  if (address.includes('%') || address.includes('.')) return null
  const halves = address.toLowerCase().split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map((group) => Number.parseInt(group, 16))
  return groups.length === 8 && groups.every((group) =>
    Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null
}

function postJson(
  destination: PublicWebhookDestination,
  body: string,
  signatureHeaders: Readonly<Record<string, string>>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const pinnedLookup = ((_hostname, _options, callback) => {
      callback(null, destination.address, destination.family)
    }) as LookupFunction
    const request = httpsRequest(destination.url, {
      method: 'POST',
      agent: false,
      lookup: pinnedLookup,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        'User-Agent': 'Recruiter-Radar-CRM-Bridge/1.0',
        ...signatureHeaders,
      },
    }, (response) => {
      let responseBytes = 0
      response.on('data', (chunk: Buffer) => {
        responseBytes += chunk.length
        if (responseBytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('CRM webhook response exceeded limit.'))
        }
      })
      response.on('end', () => resolve(response.statusCode ?? 502))
      response.on('error', reject)
    })
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('CRM webhook request timed out.'))
    })
    request.on('error', reject)
    request.end(body)
  })
}
