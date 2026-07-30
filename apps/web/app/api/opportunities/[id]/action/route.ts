import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import {
  isOpportunityEngineV1EnabledForOwner,
  isOpportunityOutcomesEnabledForOwner,
} from '@/lib/opportunities/config'
import {
  OutcomeValidationError,
  type DismissedReasonCode,
  validateOutcomeInput,
} from '@/lib/opportunities/outcome-domain'
import { OutcomeContactPrivacyUnavailableError } from '@/lib/opportunities/outcome-contact-privacy'
import {
  OutcomeChronologyConflictError,
  OutcomeIdempotencyConflictError,
  OutcomeTransitionConflictError as OutcomeLedgerTransitionConflictError,
} from '@/lib/opportunities/outcome-repository'
import { toPublicOpportunity } from '@/lib/opportunities/api-projection'
import {
  applyOpportunityAction,
  isOpportunityAction,
  OpportunityActionConflictError,
  OpportunitySupersededConflictError,
  OpportunityTransitionConflictError,
} from '@/lib/opportunities/repository'
import { logError } from '@/lib/runtime'
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getAuthorizedOwnerId('opportunities:write')
  if (!isOpportunityEngineV1EnabledForOwner(ownerId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!ownerId) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const { id } = await context.params
  if (!/^[1-9]\d*$/.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!isOpportunityAction(body.action)) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  }

  const headerKey = request.headers.get('idempotency-key')?.trim()
  const bodyKey = typeof body.idempotencyKey === 'string'
    ? body.idempotencyKey.trim()
    : ''
  const requestedActionKey = headerKey || bodyKey
  if (requestedActionKey.length > 160) {
    return NextResponse.json({ error: 'invalid_idempotency_key' }, { status: 400 })
  }
  const actionKey = requestedActionKey || randomUUID()
  const snoozeDays = typeof body.snoozeDays === 'number'
    ? body.snoozeDays
    : undefined
  const note = typeof body.note === 'string' ? body.note : null
  const occurredAt = new Date().toISOString()

  let outcomeInput: ReturnType<typeof validateOutcomeInput> | null = null
  if (isOpportunityOutcomesEnabledForOwner(ownerId)) {
    try {
      outcomeInput = validateOutcomeInput({
        eventType: body.action,
        occurredAt,
        reasonCode: body.reasonCode ?? null,
        reasonNote: note,
        channel: body.channel ?? null,
        contactPathType: body.contactPathType ?? null,
        contactReference: body.contactReference ?? null,
        valueMinor: null,
        currency: null,
        metadata: { source: 'opportunity_action' },
        idempotencyKey: actionKey,
      })
    } catch (error) {
      if (error instanceof OutcomeValidationError) {
        return NextResponse.json({ error: error.code }, { status: 400 })
      }
      throw error
    }
  }

  try {
    const result = await applyOpportunityAction({
      ownerId,
      opportunityId: id,
      action: body.action,
      actionKey,
      snoozeDays,
      note,
      reasonCode: body.action === 'dismissed'
        ? outcomeInput?.reasonCode as DismissedReasonCode | null
        : null,
      channel: outcomeInput?.channel ?? null,
      contactPathType: outcomeInput?.contactPathType ?? null,
      contactReference: outcomeInput?.contactReference ?? null,
      occurredAt,
    })
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({
      opportunity: toPublicOpportunity(result.opportunity),
      idempotent: result.idempotent,
    })
  } catch (error) {
    if (
      error instanceof OpportunityActionConflictError ||
      error instanceof OutcomeIdempotencyConflictError
    ) {
      return NextResponse.json(
        { error: 'idempotency_key_conflict' },
        { status: 409 },
      )
    }
    if (error instanceof OpportunityTransitionConflictError) {
      return NextResponse.json(
        { error: 'opportunity_transition_conflict' },
        { status: 409 },
      )
    }
    if (error instanceof OpportunitySupersededConflictError) {
      return NextResponse.json(
        { error: error.code },
        { status: 409 },
      )
    }
    if (error instanceof OutcomeValidationError) {
      return NextResponse.json({ error: error.code }, { status: 400 })
    }
    if (
      error instanceof OutcomeChronologyConflictError ||
      error instanceof OutcomeLedgerTransitionConflictError
    ) {
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    if (error instanceof OutcomeContactPrivacyUnavailableError) {
      return NextResponse.json({ error: error.code }, { status: 503 })
    }
    logError('opportunity.api.action_failed', error, {
      ownerId,
      opportunityId: id,
      action: body.action,
    })
    return NextResponse.json(
      { error: 'opportunity_action_failed' },
      { status: 500 },
    )
  }
}
