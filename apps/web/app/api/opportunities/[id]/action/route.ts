import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import {
  isOpportunityEngineV1EnabledForContext,
} from '@/lib/opportunities/config'
import { OutcomeValidationError } from '@/lib/opportunities/outcome-domain'
import { OutcomeContactPrivacyUnavailableError } from '@/lib/opportunities/outcome-contact-privacy'
import {
  OutcomeChronologyConflictError,
  OutcomeIdempotencyConflictError,
  OutcomeSupersededConflictError,
  OutcomeTransitionConflictError as OutcomeLedgerTransitionConflictError,
} from '@/lib/opportunities/outcome-repository'
import { toPublicOpportunity } from '@/lib/opportunities/api-projection'
import {
  applyOpportunityAction,
  isOpportunityAction,
} from '@/lib/opportunities/repository'
import { logError, logEvent } from '@/lib/runtime'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await getOpportunityAuthorizationContext(
    'opportunities:write',
  )
  const featureContext = authorization ?? {
    dataOwnerId: null,
    workspaceId: null,
  }
  if (!isOpportunityEngineV1EnabledForContext(featureContext)) {
    return legacyJson({ error: 'not_found' }, 404)
  }
  if (!authorization) {
    return legacyJson({ error: 'authentication_required' }, 401)
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access) {
    return legacyJson({ error: 'not_found' }, 404)
  }
  const { id } = await context.params
  if (!/^[1-9]\d*$/.test(id)) {
    return legacyJson({ error: 'not_found' }, 404, id)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return legacyJson({ error: 'invalid_json' }, 400, id)
  }
  if (!isOpportunityAction(body.action)) {
    return legacyJson({ error: 'invalid_action' }, 400, id)
  }

  const headerKey = request.headers.get('idempotency-key')?.trim()
  const bodyKey = typeof body.idempotencyKey === 'string'
    ? body.idempotencyKey.trim()
    : ''
  const requestedActionKey = headerKey || bodyKey
  if (requestedActionKey.length > 160) {
    return legacyJson({ error: 'invalid_idempotency_key' }, 400, id)
  }
  const actionKey = requestedActionKey || randomUUID()
  const snoozeDays = typeof body.snoozeDays === 'number'
    ? body.snoozeDays
    : undefined
  const note = typeof body.note === 'string' ? body.note : null
  logEvent('opportunity.api.legacy_action_adapter_used', {
    ownerId: access.ownerId,
    workspaceId: access.workspaceId,
    opportunityId: id,
    action: body.action,
  })

  try {
    const result = await applyOpportunityAction({
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      opportunityId: id,
      action: body.action,
      actionKey,
      snoozeDays,
      note,
      reasonCode: body.action === 'dismissed'
        ? body.reasonCode as Parameters<typeof applyOpportunityAction>[0]['reasonCode']
        : null,
      channel: body.action === 'contacted'
        ? body.channel as Parameters<typeof applyOpportunityAction>[0]['channel']
        : null,
      contactPathType: body.action === 'contacted'
        ? body.contactPathType as Parameters<typeof applyOpportunityAction>[0]['contactPathType']
        : null,
      contactReference:
        body.action === 'contacted' && typeof body.contactReference === 'string'
          ? body.contactReference
          : null,
      actorUserId: access.actorUserId,
      actorWorkspaceId: access.actorWorkspaceId,
      actorRoleSnapshot: access.actorRoleSnapshot,
      authMode: access.authMode,
    })
    if (!result) {
      return legacyJson({ error: 'not_found' }, 404, id)
    }
    return legacyJson({
      opportunity: toPublicOpportunity(result.opportunity),
      idempotent: result.idempotent,
    }, 200, id)
  } catch (error) {
    if (error instanceof OutcomeIdempotencyConflictError) {
      return legacyJson(
        { error: 'idempotency_key_conflict' },
        409,
        id,
      )
    }
    if (error instanceof OutcomeValidationError) {
      return legacyJson({ error: error.code }, 400, id)
    }
    if (
      error instanceof OutcomeChronologyConflictError ||
      error instanceof OutcomeLedgerTransitionConflictError
    ) {
      return legacyJson({ error: error.code }, 409, id)
    }
    if (error instanceof OutcomeSupersededConflictError) {
      return legacyJson({ error: error.code }, 409, id)
    }
    if (error instanceof OutcomeContactPrivacyUnavailableError) {
      return legacyJson({ error: error.code }, 503, id)
    }
    logError('opportunity.api.action_failed', error, {
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      opportunityId: id,
      action: body.action,
    })
    return legacyJson(
      { error: 'opportunity_action_failed' },
      500,
      id,
    )
  }
}

function legacyJson(
  body: Record<string, unknown>,
  status: number,
  opportunityId?: string,
): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Deprecation', 'true')
  if (opportunityId && /^[1-9]\d*$/.test(opportunityId)) {
    response.headers.set(
      'Link',
      `</api/opportunities/${opportunityId}/outcomes>; rel="successor-version"`,
    )
  }
  return response
}
