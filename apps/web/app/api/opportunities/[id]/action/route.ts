import { NextRequest, NextResponse } from 'next/server'

import { isOpportunityEngineV1Enabled } from '@/lib/opportunities/config'
import { toPublicOpportunity } from '@/lib/opportunities/api-projection'
import {
  applyOpportunityAction,
  isOpportunityAction,
} from '@/lib/opportunities/repository'
import { logError } from '@/lib/runtime'
import { getOwnerIdFromSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isOpportunityEngineV1Enabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const ownerId = await getOwnerIdFromSession()
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
  const actionKey = (headerKey || bodyKey || `${body.action}:default`).slice(0, 160)
  const snoozeDays = typeof body.snoozeDays === 'number'
    ? body.snoozeDays
    : undefined
  const note = typeof body.note === 'string' ? body.note : null

  try {
    const result = await applyOpportunityAction({
      ownerId,
      opportunityId: id,
      action: body.action,
      actionKey,
      snoozeDays,
      note,
    })
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({
      opportunity: toPublicOpportunity(result.opportunity),
      idempotent: result.idempotent,
    })
  } catch (error) {
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
