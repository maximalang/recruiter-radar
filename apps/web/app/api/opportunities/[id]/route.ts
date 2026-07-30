import { NextRequest, NextResponse } from 'next/server'

import {
  isOpportunityEngineV1EnabledForOwner,
} from '@/lib/opportunities/config'
import { toPublicOpportunity } from '@/lib/opportunities/api-projection'
import { getOpportunityById } from '@/lib/opportunities/repository'
import { logError } from '@/lib/runtime'
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getAuthorizedOwnerId('opportunities:read')
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

  try {
    const opportunity = await getOpportunityById({
      ownerId,
      opportunityId: id,
    })
    if (!opportunity) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({ opportunity: toPublicOpportunity(opportunity) })
  } catch (error) {
    logError('opportunity.api.detail_failed', error, {
      ownerId,
      opportunityId: id,
    })
    return NextResponse.json(
      { error: 'opportunity_unavailable' },
      { status: 500 },
    )
  }
}
