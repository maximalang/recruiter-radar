import { NextRequest, NextResponse } from 'next/server'

import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityAnalyticsV2EnabledForContext } from '@/lib/opportunities/config'
import { parseOutcomeAnalyticsV2Filters } from '@/lib/opportunities/outcome-analytics-v2-request'
import {
  OutcomeCalibrationExportLimitError,
  getOutcomeCalibrationDataset,
  outcomeCalibrationToCsv,
} from '@/lib/opportunities/outcome-calibration-export'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authorization = await getOpportunityAuthorizationContext(
    'exports:create',
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
    logEvent('opportunity_analytics_v2.export_rejected', {
      reasonCode: parsed.error,
      rejected: 1,
    })
    return json({ error: parsed.error }, 400)
  }

  const startedAt = Date.now()
  try {
    const records = await getOutcomeCalibrationDataset({
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      ...parsed.filters,
    })
    const csv = outcomeCalibrationToCsv(records)
    logEvent('opportunity_analytics_v2.export_completed', {
      durationMs: Date.now() - startedAt,
      recordCount: records.length,
      completed: 1,
    })
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition':
          'attachment; filename="opportunity-calibration.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof OutcomeCalibrationExportLimitError) {
      logEvent('opportunity_analytics_v2.export_rejected', {
        reasonCode: error.code,
        durationMs: Date.now() - startedAt,
        rejected: 1,
      })
      return json({ error: error.code }, 422)
    }
    logError('opportunity_analytics_v2.export_failed', error, {
      durationMs: Date.now() - startedAt,
      failed: 1,
    })
    return json({ error: 'opportunity_calibration_export_unavailable' }, 500)
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
