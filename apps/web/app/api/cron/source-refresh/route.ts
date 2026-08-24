import { NextRequest, NextResponse } from 'next/server'

import { isNoActiveProfiles } from '@/lib/lead-discovery/source-ingest'
import { runScheduledSourceRefresh } from '@/lib/lead-discovery/scheduled-source-refresh'
import { getSourceCriticality, hasDeliveryImpactingFailure, isEffectiveFailure } from '@/lib/sources/source-criticality'
import { logEvent, logWarn } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, route: 'source-refresh' })
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.CRON_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'Source refresh service is not configured.' },
      { status: 500 },
    )
  }
  if (request.headers.get('x-api-key') !== apiKey) {
    return NextResponse.json(
      { success: false, error: 'Invalid or missing x-api-key header.' },
      { status: 401 },
    )
  }

  const startedAt = new Date()
  try {
    const results = await runScheduledSourceRefresh()
    if (isNoActiveProfiles(results)) {
      return NextResponse.json(
        { success: false, error: 'No active client profiles; source refresh skipped.', hint: results.hint },
        { status: 422 },
      )
    }
    // Single effective-failure rule (BLOCKER fix): a rate-limited refresh is
    // reported with success:true by the ingest, but for required/unknown
    // sources it means the digest/evidence inputs missed their refresh window.
    // Counting only !success would hide that inside HTTP 200. `deferred` is an
    // expected scheduler-overlap state and stays non-failing.
    const detailsWithCriticality = results.map((result) => ({
      ...result,
      criticality: getSourceCriticality(result.source),
    }))
    const effectiveFailures = detailsWithCriticality.filter(isEffectiveFailure)
    const success = effectiveFailures.length === 0
    const failedSources = effectiveFailures.map(({ source, outcome, criticality }) => ({
      source,
      outcome,
      criticality,
    }))
    const deliveryImpactingFailure = hasDeliveryImpactingFailure(failedSources)
    const summary = {
      total: results.length,
      succeeded: results.filter((result) => !isEffectiveFailure(result)).length,
      failed: effectiveFailures.length,
      deferred: results.filter((result) => result.outcome === 'deferred').length,
      credentialGated: results.filter((result) => result.outcome === 'credential-gated').length,
      rateLimited: results.filter((result) => result.outcome === 'rate-limited').length,
      failedRequired: failedSources.filter((f) => f.criticality !== 'optional').length,
      failedOptional: failedSources.filter((f) => f.criticality === 'optional').length,
      deliveryImpactingFailure,
      durationMs: Date.now() - startedAt.getTime(),
    }
    if (success) logEvent('source_refresh.run', summary)
    else logWarn('source_refresh.partial', summary)
    return NextResponse.json(
      {
        success,
        data: { startedAt: startedAt.toISOString(), ...summary, details: detailsWithCriticality },
      },
      { status: success ? 200 : 207 },
    )
  } catch (error) {
    logWarn('source_refresh.failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { success: false, error: 'Source refresh failed.' },
      { status: 500 },
    )
  }
}
