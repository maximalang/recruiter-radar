import { NextRequest, NextResponse } from 'next/server'

import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityAnalyticsV2EnabledForContext } from '@/lib/opportunities/config'
import { getOutcomeAnalyticsV2Summary } from '@/lib/opportunities/outcome-analytics-v2'
import { parseOutcomeAnalyticsV2Filters } from '@/lib/opportunities/outcome-analytics-v2-request'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authorization = await getOpportunityAuthorizationContext(
    'opportunities:read',
  )
  const featureContext = authorization ?? {
    dataOwnerId: null,
    workspaceId: null,
  }
  if (!isOpportunityAnalyticsV2EnabledForContext(featureContext)) {
    return json({ error: 'not_found' }, 404)
  }
  if (!authorization) {
    return json({ error: 'authentication_required' }, 401)
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access || access.authMode !== 'auth_v2' || access.workspaceId == null) {
    return json({ error: 'not_found' }, 404)
  }

  const parsed = parseOutcomeAnalyticsV2Filters(
    request.nextUrl.searchParams,
    new Date(),
  )
  if ('error' in parsed) {
    logEvent('opportunity_analytics_v2.request_rejected', {
      reasonCode: parsed.error,
      rejected: 1,
    })
    return json({ error: parsed.error }, 400)
  }

  const startedAt = Date.now()
  try {
    const summary = await getOutcomeAnalyticsV2Summary({
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      ...parsed.filters,
    })
    logEvent('opportunity_analytics_v2.summary_completed', {
      durationMs: Date.now() - startedAt,
      cohortSize: summary.cohort.size,
      wonWithConfirmedValue:
        summary.confirmedRevenue.wonWithConfirmedValue,
      wonWithoutConfirmedValue:
        summary.confirmedRevenue.wonWithoutConfirmedValue,
      completed: 1,
    })
    return json(summary, 200)
  } catch (error) {
    logError('opportunity_analytics_v2.summary_failed', error, {
      durationMs: Date.now() - startedAt,
      failed: 1,
    })
    return json({ error: 'opportunity_analytics_v2_unavailable' }, 500)
  }
}
function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
