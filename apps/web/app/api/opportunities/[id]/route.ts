import { NextRequest, NextResponse } from 'next/server'

import {
  isOpportunityEngineV1EnabledForContext,
} from '@/lib/opportunities/config'
import { toPublicOpportunity } from '@/lib/opportunities/api-projection'
import { getOpportunityById } from '@/lib/opportunities/repository'
import { logError } from '@/lib/runtime'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await getOpportunityAuthorizationContext(
    'opportunities:read',
  )
  const featureContext = authorization ?? {
    dataOwnerId: null,
    workspaceId: null,
  }
  if (!isOpportunityEngineV1EnabledForContext(featureContext)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!authorization) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { id } = await context.params
  if (!/^[1-9]\d*$/.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  try {
    const opportunity = await getOpportunityById({
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      opportunityId: id,
    })
    if (!opportunity) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({ opportunity: toPublicOpportunity(opportunity) })
  } catch (error) {
    logError('opportunity.api.detail_failed', error, {
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      opportunityId: id,
    })
    return NextResponse.json(
      { error: 'opportunity_unavailable' },
      { status: 500 },
    )
  }
}
