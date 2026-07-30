import { NextRequest, NextResponse } from 'next/server'

import {
  isOpportunityEngineV1EnabledForOwner,
  isOpportunityOutcomesEnabledForOwner,
} from '@/lib/opportunities/config'
import { OutcomeValidationError } from '@/lib/opportunities/outcome-domain'
import { OutcomeContactPrivacyUnavailableError } from '@/lib/opportunities/outcome-contact-privacy'
import {
  getOpportunityOutcomeHistory,
  OutcomeChronologyConflictError,
  OutcomeCorrectionConflictError,
  OutcomeIdempotencyConflictError,
  OutcomeSupersededConflictError,
  OutcomeTransitionConflictError,
  recordOpportunityOutcome,
} from '@/lib/opportunities/outcome-repository'
import { logError } from '@/lib/runtime'
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getAuthorizedOwnerId('opportunities:write')
  if (!isOutcomeApiEnabled(ownerId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!ownerId) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const { id } = await context.params
  if (!isPositiveId(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 400 })
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const headerKey = request.headers.get('idempotency-key')?.trim()
  if (headerKey) body.idempotencyKey = headerKey

  try {
    const result = await recordOpportunityOutcome({
      ownerId,
      opportunityId: id,
      actorType: 'user',
      actorUserId: ownerId,
      payload: body,
    })
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    const { id: _eventId, ...event } = result.event
    const {
      lastEventId: _lastEventId,
      lastStageEventId: _lastStageEventId,
      activeMeetingEventId: _activeMeetingEventId,
      ...state
    } = result.state
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
    if (
      error instanceof OutcomeChronologyConflictError ||
      error instanceof OutcomeCorrectionConflictError
    ) {
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    if (error instanceof OutcomeSupersededConflictError) {
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    if (error instanceof OutcomeContactPrivacyUnavailableError) {
      return NextResponse.json({ error: error.code }, { status: 503 })
    }
    logError('opportunity_outcome.api.record_failed', error, {
      ownerId,
      opportunityId: id,
      eventType: typeof body.eventType === 'string' ? body.eventType : null,
    })
    return NextResponse.json(
      { error: 'opportunity_outcome_failed' },
      { status: 500 },
    )
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getAuthorizedOwnerId('opportunities:read')
  if (!isOutcomeApiEnabled(ownerId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!ownerId) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const { id } = await context.params
  if (!isPositiveId(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const rawBeforeEventId = request.nextUrl.searchParams.get('beforeEventId')
  const beforeEventId = parsePositiveBigint(rawBeforeEventId)
  const pageSize = parsePositiveInt(
    request.nextUrl.searchParams.get('pageSize'),
    50,
  )
  if ((rawBeforeEventId !== null && beforeEventId === null) || pageSize === null) {
    return NextResponse.json({ error: 'invalid_pagination' }, { status: 400 })
  }
  try {
    const result = await getOpportunityOutcomeHistory({
      ownerId,
      opportunityId: id,
      beforeEventId,
      pageSize,
    })
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json(result)
  } catch (error) {
    logError('opportunity_outcome.api.history_failed', error, {
      ownerId,
      opportunityId: id,
    })
    return NextResponse.json(
      { error: 'opportunity_outcome_history_failed' },
      { status: 500 },
    )
  }
}

function isOutcomeApiEnabled(
  ownerId: string | number | null | undefined,
): boolean {
  return isOpportunityEngineV1EnabledForOwner(ownerId) &&
    isOpportunityOutcomesEnabledForOwner(ownerId)
}

function isPositiveId(value: string): boolean {
  return /^[1-9]\d*$/.test(value)
}

function parsePositiveInt(value: string | null, fallback: number): number | null {
  if (value === null) return fallback
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveBigint(value: string | null): string | null {
  if (value === null) return null
  if (!/^[1-9]\d{0,18}$/.test(value)) return null
  try {
    return BigInt(value) <= BigInt('9223372036854775807') ? value : null
  } catch {
    return null
  }
}
