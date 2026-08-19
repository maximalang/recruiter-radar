import { NextRequest, NextResponse } from 'next/server'

import { readBoundedRequestText } from '@/lib/http/read-bounded-request-text'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityCrmBridgeEnabledForContext } from '@/lib/opportunities/config'
import {
  CrmDeliveryAccessError,
  CrmDeliveryIdempotencyKeyError,
  CrmDeliveryInProgressError,
  deliverOpportunityToCrm,
} from '@/lib/opportunities/crm-delivery-repository'
import { checkCrmDeliveryRateLimit } from '@/lib/opportunities/crm-delivery-rate-limit'
import { sendSignedCrmWebhook } from '@/lib/opportunities/crm-webhook'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 4 * 1024
const MAX_POSTGRES_BIGINT = BigInt('9223372036854775807')

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await getOpportunityAuthorizationContext(
    'opportunities:write',
  )
  if (!isOpportunityCrmBridgeEnabledForContext(authorization ?? {
    dataOwnerId: null, workspaceId: null,
  })) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!authorization) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access || access.authMode !== 'auth_v2' || access.workspaceId == null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!(await checkCrmDeliveryRateLimit(access.workspaceId))) {
    return NextResponse.json({ error: 'crm_delivery_rate_limited' }, {
      status: 429,
      headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
    })
  }
  const { id } = await context.params
  if (!isPositivePostgresId(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? ''
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'crm_delivery_idempotency_key_invalid' }, {
      status: 400,
    })
  }

  let integrationReference: string
  try {
    const raw = await readBoundedRequestText(request, MAX_BODY_BYTES)
    if (raw === null) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 400 })
    }
    const body = JSON.parse(raw) as unknown
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof (body as { integrationReference?: unknown }).integrationReference !==
        'string'
    ) {
      return NextResponse.json({ error: 'crm_integration_reference_invalid' }, {
        status: 400,
      })
    }
    integrationReference = (body as { integrationReference: string })
      .integrationReference
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  try {
    const result = await deliverOpportunityToCrm({
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      opportunityId: id,
      actorUserId: access.actorUserId,
      integrationReference,
      idempotencyKey,
    }, sendSignedCrmWebhook)
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    logEvent('opportunity_crm.delivery_completed', {
      workspaceId: access.workspaceId,
      status: result.status,
      idempotent: result.idempotent,
      deliveriesSucceeded: result.status === 'succeeded' ? 1 : 0,
      deliveriesFailed: result.status === 'failed' ? 1 : 0,
    })
    if (result.status === 'failed') {
      return NextResponse.json({
        error: 'crm_delivery_failed',
        eventId: result.eventId,
        idempotent: result.idempotent,
      }, { status: 502 })
    }
    return NextResponse.json(result, {
      status: result.idempotent ? 200 : 202,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (
      error instanceof CrmDeliveryAccessError ||
      error instanceof CrmDeliveryIdempotencyKeyError ||
      error instanceof CrmDeliveryInProgressError
    ) {
      return NextResponse.json({ error: error.code }, {
        status: error instanceof CrmDeliveryAccessError
          ? 403
          : error instanceof CrmDeliveryInProgressError ? 409 : 400,
      })
    }
    logError('opportunity_crm.delivery_failed', error, {
      workspaceId: access.workspaceId,
      opportunityId: id,
    })
    return NextResponse.json({ error: 'crm_delivery_unavailable' }, {
      status: 500,
    })
  }
}

function isPositivePostgresId(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT
  } catch {
    return false
  }
}
