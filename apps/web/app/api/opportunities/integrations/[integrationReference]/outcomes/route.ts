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
  const bodyResult = await readLimitedUtf8Body(request, MAX_BODY_BYTES)
  if (bodyResult.status === 'too_large') {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 400 })
  }
  if (bodyResult.status === 'invalid') {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }
  const rawBody = bodyResult.body
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
      logEvent('opportunity_crm.callback_rejected', {
        status: 401,
        code: error.code,
        callbacksRejected: 1,
      })
      return NextResponse.json({ error: error.code }, { status: 401 })
    }
    if (error instanceof CrmCallbackReplayConflictError) {
      logEvent('opportunity_crm.callback_rejected', {
        status: 409,
        code: error.code,
        callbacksRejected: 1,
      })
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    logError('opportunity_crm.callback_failed', error)
    return NextResponse.json({ error: 'crm_callback_unavailable' }, {
      status: 500,
    })
  }
}

async function readLimitedUtf8Body(
  request: Request,
  maxBytes: number,
): Promise<
  | { status: 'ok'; body: string }
  | { status: 'too_large' }
  | { status: 'invalid' }
> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const declaredBytes = Number(declared)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      return { status: 'invalid' }
    }
    if (declaredBytes > maxBytes) return { status: 'too_large' }
  }
  if (!request.body) return { status: 'ok', body: '' }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { status: 'too_large' }
      }
      chunks.push(value)
    }
    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { status: 'ok', body: new TextDecoder().decode(body) }
  } catch {
    return { status: 'invalid' }
  } finally {
    reader.releaseLock()
  }
}
