import { NextRequest, NextResponse } from 'next/server'

import {
  isOpportunityEngineV1Enabled,
  isOpportunityOutcomesEnabled,
} from '@/lib/opportunities/config'
import { HIRING_EPISODE_TYPES } from '@/lib/opportunities/hiring-episode-detection'
import { getOutcomeFunnelSummary } from '@/lib/opportunities/outcome-repository'
import { logError } from '@/lib/runtime'
import { getOwnerIdFromSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  if (!isOpportunityEngineV1Enabled() || !isOpportunityOutcomesEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const ownerId = await getOwnerIdFromSession()
  if (!ownerId) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const now = new Date()
  const rawTo = request.nextUrl.searchParams.get('to')
  const rawFrom = request.nextUrl.searchParams.get('from')
  const parsedTo = parseTimestamp(rawTo)
  const parsedFrom = parseTimestamp(rawFrom)
  if ((rawTo && !parsedTo) || (rawFrom && !parsedFrom)) {
    return NextResponse.json({ error: 'invalid_period' }, { status: 400 })
  }
  const to = parsedTo ?? now
  const from = parsedFrom ??
    new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (
    from >= to ||
    to.getTime() > now.getTime() + 5 * 60 * 1000 ||
    to.getTime() - from.getTime() > MAX_PERIOD_MS
  ) {
    return NextResponse.json({ error: 'invalid_period' }, { status: 400 })
  }

  const episodeType = optionalParam(request, 'episodeType')
  const confidenceGate = optionalParam(request, 'confidenceGate')
  const sourceFamily = optionalParam(request, 'sourceFamily')
  const scoreBucket = optionalParam(request, 'scoreBucket')
  if (
    (episodeType && !HIRING_EPISODE_TYPES.includes(
      episodeType as (typeof HIRING_EPISODE_TYPES)[number],
    )) ||
    (confidenceGate && !['A', 'B', 'C', 'D'].includes(confidenceGate)) ||
    (sourceFamily && !/^[a-z0-9_-]{1,64}$/i.test(sourceFamily)) ||
    (scoreBucket && !/^(?:0-9|[1-9]0-[1-9]9|100)$/.test(scoreBucket))
  ) {
    return NextResponse.json({ error: 'invalid_filter' }, { status: 400 })
  }

  try {
    const summary = await getOutcomeFunnelSummary({
      ownerId,
      from: from.toISOString(),
      to: to.toISOString(),
      episodeType,
      confidenceGate,
      sourceFamily,
      scoreBucket,
    })
    return NextResponse.json(summary)
  } catch (error) {
    logError('opportunity_outcome.api.summary_failed', error, { ownerId })
    return NextResponse.json(
      { error: 'opportunity_outcome_summary_failed' },
      { status: 500 },
    )
  }
}

function optionalParam(request: NextRequest, name: string): string | null {
  const value = request.nextUrl.searchParams.get(name)?.trim()
  return value || null
}

function parseTimestamp(value: string | null): Date | null {
  if (value === null) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp) : null
}
