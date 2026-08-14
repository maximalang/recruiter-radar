/**
 * Cron: Daily Radar Pipeline
 *
 * The daily clock is delivery-oriented. Source refresh has its own persisted
 * cadence scheduler and hourly clock; this route only asks that scheduler to
 * run anything currently due before deriving temporal context and delivering.
 * A day-level lease prevents duplicate delivery when multiple external clocks
 * happen to trigger the route on the same UTC date.
 *
 * A Commercial Signal canary is executed by its separate exact-lineage cron
 * stage and is deliberately excluded from legacy digest delivery here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isNoActiveProfiles, runSourceTemporalIntelligence } from '@/lib/lead-discovery/source-ingest'
import { runScheduledSourceRefresh } from '@/lib/lead-discovery/scheduled-source-refresh'
import { runDigestForClientProfile } from '@/lib/digest'
import { deliverCandidatesForRun } from '@/lib/digest/deliver-candidates'
import { enrichRunCandidates } from '@/lib/ai/enrichment/enrichRunCandidates'
import { shouldDeliverOnRun } from '@/lib/delivery/nextDeliveryHint'
import { getPool } from '@/lib/db'
import {
  getCommercialSignalCanaryWorkspaceId,
  resolveCommercialSignalRollout,
} from '@/lib/opportunities/commercial-signal-rollout'
import { claimDailyRadarRun, finishDailyRadarRun } from '@/lib/daily-radar-run-state'
import { logEvent, logError, logWarn } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — health-check for monitors (no pipeline run, no auth required) */
export async function GET() {
  return NextResponse.json(
    { ok: true, route: 'daily-radar', hint: 'Use POST with x-api-key to trigger the pipeline.' },
    { status: 200 }
  )
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.CRON_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'CRON_API_KEY is not configured.' },
      { status: 500 }
    )
  }
  const authHeader = request.headers.get('x-api-key')
  if (authHeader !== apiKey) {
    return NextResponse.json(
      { success: false, error: 'Invalid or missing x-api-key header.' },
      { status: 401 }
    )
  }

  const lease = await claimDailyRadarRun()
  if (!lease.acquired) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'daily-radar-already-claimed',
      runDate: lease.runDate,
    })
  }

  const startMs = Date.now()

  try {
    const ingestResults = await runScheduledSourceRefresh()
    if (isNoActiveProfiles(ingestResults)) {
      await finishDailyRadarRun(lease, 'completed')
      return NextResponse.json(
        { success: false, error: 'No active client profiles; pipeline skipped.', hint: ingestResults.hint },
        { status: 422 }
      )
    }
    const ingestOk = ingestResults.every(r => r.success)
    for (const result of ingestResults) {
      const sourcePayload = {
        source: result.source,
        outcome: result.outcome,
        fetched: result.fetchedCount ?? null,
        parsed: result.diagnostics?.parsedCount ?? null,
        normalized: result.diagnostics?.normalizedCount ?? null,
        duplicates: result.diagnostics?.duplicateCount ?? null,
        skipped: result.diagnostics?.skippedCount ?? null,
        organizations: result.diagnostics?.organizationCount ?? null,
        evidence: result.diagnostics?.evidenceCount ?? null,
        signals: result.upsertedCount ?? null,
      }
      if (result.success) {
        logEvent('daily_radar.source_refresh_completed', sourcePayload)
      } else {
        logWarn('daily_radar.source_refresh_failed', sourcePayload)
      }
    }
    const ingestSummary = {
      total: ingestResults.length,
      succeeded: ingestResults.filter(r => r.success).length,
      failed: ingestResults.filter(r => !r.success).length,
      fetchedTotal: ingestResults.reduce((sum, r) => sum + (r.fetchedCount ?? 0), 0),
      upsertedTotal: ingestResults.reduce((sum, r) => sum + (r.upsertedCount ?? 0), 0),
      outcomes: ingestResults.reduce<Record<string, number>>((counts, result) => {
        counts[result.outcome] = (counts[result.outcome] ?? 0) + 1
        return counts
      }, {}),
    }

    const temporalResult = await runSourceTemporalIntelligence()
    const temporalPayload = {
      success: temporalResult.success,
      observations: temporalResult.observations,
      derivedEvents: temporalResult.derivedEvents,
      error: temporalResult.error ?? null,
    }
    if (temporalResult.success) {
      logEvent('daily_radar.temporal_intelligence_completed', temporalPayload)
    } else {
      logWarn('daily_radar.temporal_intelligence_failed', temporalPayload)
    }

    const digestResults = await generateAndDeliverDigests()
    const digestOk = digestResults.every(r => r.ok)
    const digestSummary = {
      total: digestResults.length,
      succeeded: digestResults.filter(r => r.ok).length,
      failed: digestResults.filter(r => !r.ok).length,
      totalSent: digestResults.reduce((sum, r) => sum + r.sent, 0),
      totalSkipped: digestResults.reduce((sum, r) => sum + r.skipped, 0),
    }

    const allOk = ingestOk && temporalResult.success && digestOk
    const durationMs = Date.now() - startMs

    logEvent('daily_radar.run', {
      status: allOk ? 'ok' : 'partial',
      ingestOk: ingestSummary.succeeded,
      ingestTotal: ingestSummary.total,
      temporalOk: temporalResult.success,
      temporalObservations: temporalResult.observations,
      temporalEvents: temporalResult.derivedEvents,
      digestOk: digestSummary.succeeded,
      digestTotal: digestSummary.total,
      sent: digestSummary.totalSent,
      durationMs,
    })
    if (
      digestSummary.total > 0
      && digestSummary.totalSent === 0
      && digestSummary.totalSkipped < digestSummary.total
    ) {
      logWarn('daily_radar.zero_opportunity_anomaly', {
        profileCount: digestSummary.total,
        completedCount: digestSummary.succeeded,
      })
    }

    await finishDailyRadarRun(lease, 'completed')
    return NextResponse.json({
      success: allOk,
      data: {
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        ingest: { ok: ingestOk, ...ingestSummary, details: ingestResults },
        temporal: { ok: temporalResult.success, ...temporalResult },
        digest: { ok: digestOk, ...digestSummary, details: digestResults },
      },
    }, { status: allOk ? 200 : 207 })
  } catch (error) {
    await finishDailyRadarRun(lease, 'failed').catch(() => undefined)
    logError('daily_radar.pipeline_failed', error)
    return NextResponse.json(
      { success: false, error: 'Daily radar pipeline failed' },
      { status: 500 }
    )
  }
}

interface DigestDeliveryResult {
  clientProfileId: string
  ok: boolean
  sent: number
  failed: number
  skipped: number
  error?: string
}

async function generateAndDeliverDigests(): Promise<DigestDeliveryResult[]> {
  const pool = getPool()
  if (!pool) {
    return [{ clientProfileId: 'none', ok: false, sent: 0, failed: 0, skipped: 0, error: 'DATABASE_URL not set' }]
  }

  const configuredCanaryWorkspaceId = getCommercialSignalCanaryWorkspaceId()
  const canaryWorkspaceId = configuredCanaryWorkspaceId &&
    resolveCommercialSignalRollout(configuredCanaryWorkspaceId).effectiveMode === 'canary'
    ? configuredCanaryWorkspaceId
    : null

  const profiles = await pool.query<{ id: string; delivery_frequency: string }>(`
    SELECT id::TEXT AS id, delivery_frequency
    FROM client_profiles
    WHERE is_active = true
      AND delivery_enabled = true
      AND ($1::BIGINT IS NULL OR workspace_id IS DISTINCT FROM $1::BIGINT)
      AND (
        telegram_chat_id IS NOT NULL
        OR (email_digest_enabled = true AND digest_email IS NOT NULL)
        OR (
          web_push_enabled = true
          AND EXISTS (
            SELECT 1
            FROM web_push_subscriptions wps
            WHERE wps.client_profile_id = client_profiles.id
              AND wps.revoked_at IS NULL
          )
        )
        OR EXISTS (
          SELECT 1
          FROM notification_routes nr
          INNER JOIN notification_endpoints ne ON ne.id = nr.endpoint_id
          INNER JOIN notification_provider_accounts npa ON npa.id = ne.provider_account_id
          WHERE nr.client_profile_id = client_profiles.id
            AND nr.event_kind = 'daily_digest'
            AND nr.status = 'active'
            AND ne.status = 'active'
            AND ne.destination_id IS NOT NULL
            AND npa.status IN ('active', 'degraded')
        )
      )
    ORDER BY id
  `, [canaryWorkspaceId])

  if (profiles.rows.length === 0) {
    return []
  }

  const runUtc = new Date()
  const results: DigestDeliveryResult[] = []

  for (const profile of profiles.rows) {
    if (!shouldDeliverOnRun(
      profile.delivery_frequency === "weekly" ? "weekly" : "daily",
      runUtc,
    )) {
      results.push({
        clientProfileId: profile.id,
        ok: true,
        sent: 0,
        failed: 0,
        skipped: 1,
      })
      continue
    }

    try {
      const { run } = await runDigestForClientProfile({ clientProfileId: profile.id })
      const runId = run.id

      try {
        await enrichRunCandidates(runId)
      } catch (error) {
        logError('daily_radar.enrichment_failed', error, { runId: String(runId) })
      }

      const delivery = await deliverCandidatesForRun(runId)

      results.push({
        clientProfileId: profile.id,
        ok: delivery.ok,
        sent: delivery.sent,
        failed: delivery.failed,
        skipped: delivery.skipped,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      results.push({
        clientProfileId: profile.id,
        ok: false,
        sent: 0,
        failed: 0,
        skipped: 0,
        error: message,
      })
    }
  }

  return results
}
