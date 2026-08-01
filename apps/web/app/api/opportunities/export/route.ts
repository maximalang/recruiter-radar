import { NextRequest, NextResponse } from 'next/server'

import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityCrmBridgeEnabledForContext } from '@/lib/opportunities/config'
import {
  opportunitiesToCsv,
  opportunitiesToXlsx,
  toOpportunityExportRecord,
  type OpportunityExportRecord,
} from '@/lib/opportunities/opportunity-export'
import { listOpportunities } from '@/lib/opportunities/repository'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
const MAX_EXPORT_RECORDS = 500

export async function GET(request: NextRequest) {
  const authorization = await getOpportunityAuthorizationContext('exports:create')
  const featureContext = authorization ?? {
    dataOwnerId: null,
    workspaceId: null,
  }
  if (!isOpportunityCrmBridgeEnabledForContext(featureContext)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!authorization) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access || access.workspaceId == null || access.authMode !== 'auth_v2') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const format = request.nextUrl.searchParams.get('format') ?? 'csv'
  if (format !== 'csv' && format !== 'xlsx') {
    return NextResponse.json({ error: 'invalid_export_format' }, { status: 400 })
  }

  try {
    const records = await loadExportRecords({
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
    })
    logEvent('opportunity_crm.export_created', {
      workspaceId: access.workspaceId,
      format,
      recordCount: records.length,
      exportsCreated: 1,
    })
    if (format === 'xlsx') {
      return new NextResponse(Buffer.from(opportunitiesToXlsx(records)), {
        status: 200,
        headers: exportHeaders(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'opportunities.xlsx',
        ),
      })
    }
    return new NextResponse(opportunitiesToCsv(records), {
      status: 200,
      headers: exportHeaders('text/csv; charset=utf-8', 'opportunities.csv'),
    })
  } catch (error) {
    logError('opportunity_crm.export_failed', error, {
      workspaceId: access.workspaceId,
      format,
    })
    return NextResponse.json({ error: 'opportunity_export_unavailable' }, {
      status: 500,
    })
  }
}

async function loadExportRecords(input: {
  ownerId: string
  workspaceId: string
}): Promise<OpportunityExportRecord[]> {
  const records: OpportunityExportRecord[] = []
  let offset = 0
  while (records.length < MAX_EXPORT_RECORDS) {
    const page = await listOpportunities({
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      view: 'all',
      pageSize: PAGE_SIZE,
      offset,
    })
    records.push(...page.opportunities
      .slice(0, MAX_EXPORT_RECORDS - records.length)
      .map(toOpportunityExportRecord))
    if (page.nextOffset === null || page.nextOffset <= offset) break
    offset = page.nextOffset
  }
  return records
}

function exportHeaders(contentType: string, filename: string) {
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
}
