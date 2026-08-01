import { NextRequest, NextResponse } from 'next/server'

import { isOpportunityCrmBridgePublicCallbackEnabled } from '@/lib/opportunities/config'
import {
  CrmCallbackAuthenticationError,
  CrmCallbackReplayConflictError,
  ingestCrmOutcomeCallback,
} from '@/lib/opportunities/crm-callback-repository'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ integrationReference: string }> },
) {
  if (!isOpportunityCrmBridgePublicCallbackEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 400 })
  }
  const { integrationReference } = await context.params
  try {
    const result = await ingestCrmOutcomeCallback({
      integrationReference,
      credentialReference: request.headers.get('x-rr-credential-id')?.trim() ?? '',
      timestamp: request.headers.get('x-rr-webhook-timestamp')?.trim() ?? '',
      eventId: request.headers.get('x-rr-webhook-id')?.trim() ?? '',
      signature: request.headers.get('x-rr-signature')?.trim() ?? '',
      rawBody,
    })
    logEvent('opportunity_crm.callback_completed', {
      status: result.status,
      code: result.code,
      idempotent: result.idempotent,
      callbacksAccepted: result.accepted ? 1 : 0,
      callbacksRejected: result.accepted ? 0 : 1,
    })
    return NextResponse.json({
      accepted: result.accepted,
      idempotent: result.idempotent,
      ...(result.accepted ? {} : { error: result.code }),
    }, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof CrmCallbackAuthenticationError) {
      return NextResponse.json({ error: error.code }, { status: 401 })
    }
    if (error instanceof CrmCallbackReplayConflictError) {
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    logError('opportunity_crm.callback_failed', error)
    return NextResponse.json({ error: 'crm_callback_unavailable' }, {
      status: 500,
    })
  }
}
