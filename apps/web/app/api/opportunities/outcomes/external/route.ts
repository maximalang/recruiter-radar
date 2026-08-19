import { NextRequest, NextResponse } from 'next/server'

import {
  isOpportunityEngineV1Enabled,
  isOpportunityOutcomesExternalIngestEnabled,
} from '@/lib/opportunities/config'
import { OutcomeValidationError } from '@/lib/opportunities/outcome-domain'
import { verifyExternalOutcomeSignature } from '@/lib/opportunities/external-outcome-security'
import {
  OutcomeIdempotencyConflictError,
  OutcomeSupersededConflictError,
  OutcomeTransitionConflictError,
  recordOpportunityOutcome,
  resolveOpportunityPublicReference,
} from '@/lib/opportunities/outcome-repository'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  if (
    !isOpportunityEngineV1Enabled() ||
    !isOpportunityOutcomesExternalIngestEnabled()
  ) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const secret = process.env.OPPORTUNITY_OUTCOMES_WEBHOOK_SECRET?.trim() ?? ''
  if (!secret) {
    return NextResponse.json(
      { error: 'external_ingest_unavailable' },
      { status: 503 },
    )
  }

  const rawBody = await readBoundedBody(request, MAX_BODY_BYTES)
  if (rawBody === null) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 400 })
  }
  const timestamp = request.headers.get('x-radar-timestamp')
  const signature = request.headers.get('x-radar-signature')
  const eventIdHeader = request.headers.get('x-radar-event-id')?.trim() ?? ''
  const eventHeader = request.headers.get('x-radar-event')?.trim() ?? ''
  if (
    eventHeader !== 'opportunity.outcome' ||
    !verifyExternalOutcomeSignature({
      rawBody,
      timestamp,
      eventId: eventIdHeader,
      signature,
      secret,
    })
  ) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(rawBody) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid')
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const allowedKeys = new Set([
    'externalSystem', 'externalEventId', 'opportunityRef', 'eventType',
    'occurredAt', 'reasonCode', 'reasonNote', 'channel', 'contactPathType',
    'contactReference', 'valueMinor', 'currency', 'metadata',
  ])
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return NextResponse.json({ error: 'invalid_external_outcome' }, { status: 400 })
  }

  const externalSystem = normalizedIdentifier(body.externalSystem, 40)
  const externalEventId = normalizedIdentifier(body.externalEventId, 100)
  const opportunityRef = typeof body.opportunityRef === 'string'
    ? body.opportunityRef.trim()
    : ''
  if (
    !externalSystem ||
    !externalEventId ||
    eventIdHeader !== externalEventId ||
    !UUID_PATTERN.test(opportunityRef)
  ) {
    return NextResponse.json({ error: 'invalid_external_outcome' }, { status: 400 })
  }

  try {
    const opportunity = await resolveOpportunityPublicReference(opportunityRef)
    if (!opportunity) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    const metadata = body.metadata && typeof body.metadata === 'object' &&
        !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {}
    const result = await recordOpportunityOutcome({
      ownerId: opportunity.ownerId,
      opportunityId: opportunity.opportunityId,
      actorType: 'external',
      externalSystem,
      externalEventId,
      payload: {
        eventType: body.eventType,
        occurredAt: body.occurredAt,
        reasonCode: body.reasonCode ?? null,
        reasonNote: body.reasonNote ?? null,
        channel: body.channel ?? null,
        contactPathType: body.contactPathType ?? null,
        contactReference: body.contactReference ?? null,
        valueMinor: body.valueMinor ?? null,
        currency: body.currency ?? null,
        metadata: { ...metadata, source: 'crm_callback' },
        idempotencyKey: `${externalSystem}:${externalEventId}`,
      },
    })
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    logEvent('opportunity_outcome.external_ingested', {
      externalSystem,
      eventType: result.event.eventType,
      idempotent: result.idempotent,
    })
    const { id: _eventId, ...event } = result.event
    const { lastEventId: _lastEventId, ...state } = result.state
    return NextResponse.json(
      { event, state, idempotent: result.idempotent },
      { status: result.idempotent ? 200 : 201 },
    )
  } catch (error) {
    if (error instanceof OutcomeValidationError) {
      return NextResponse.json({ error: error.code }, { status: 400 })
    }
    if (error instanceof OutcomeIdempotencyConflictError) {
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    if (error instanceof OutcomeTransitionConflictError) {
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    if (error instanceof OutcomeSupersededConflictError) {
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    logError('opportunity_outcome.external_ingest_failed', error, {
      externalSystem,
    })
    return NextResponse.json(
      { error: 'external_ingest_failed' },
      { status: 500 },
    )
  }
}

async function readBoundedBody(
  request: NextRequest,
  maximumBytes: number,
): Promise<string | null> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && /^\d+$/.test(contentLength)) {
    const declaredBytes = Number(contentLength)
    if (Number.isSafeInteger(declaredBytes) && declaredBytes > maximumBytes) {
      return null
    }
  }

  if (!request.body) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel('payload_too_large')
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function normalizedIdentifier(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) return null
  return normalized.length <= maximum ? normalized : null
}
