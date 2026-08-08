/**
 * Cron: Daily Radar Pipeline
 *
 * Triggered by the production cron (cron/trigger-daily-radar.mjs) to run
 * the legacy daily cycle for non-canary workspaces:
 *   1. Ingest all primary sources
 *   2. Generate digest for each active non-canary client profile
 *   3. Deliver the digest to every enabled channel
 *
 * A Commercial Signal canary is executed by its separate exact-lineage cron
 * stage and is deliberately excluded from legacy digest delivery here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { ingestAllPrimarySources, isNoActiveProfiles } from '@/lib/lead-discovery/source-ingest'
import { runDigestForClientProfile } from '@/lib/digest'
import { deliverCandidatesForRun } from '@/lib/digest/deliver-candidates'
import { enrichRunCandidates } from '@/lib/ai/enrichment/enrichRunCandidates'
import { shouldDeliverOnRun } from '@/lib/delivery/nextDeliveryHint'
import { getPool } from '@/lib/db'
import {
  getCommercialSignalCanaryWorkspaceId,
  resolveCommercialSignalRollout,
} from '@/lib/opportunities/commercial-signal-rollout'
import { logEvent, logError } from '@/lib/runtime'

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

  const startMs = Date.now()

  try {
    const ingestResults = await ingestAllPrimarySources()
    if (isNoActiveProfiles(ingestResults)) {
      return NextResponse.json(
        { success: false, error: 'No active client profiles; pipeline skipped.', hint: ingestResults.hint },
        { status: 422 }
      )
    }
    const ingestOk = ingestResults.every(r => r.success)
    const ingestSummary = {
      total: ingestResults.length,
      succeeded: ingestResults.filter(r => r.success).length,
      failed: ingestResults.filter(r => !r.success).length,
      fetchedTotal: ingestResults.reduce((sum, r) => sum + (r.fetchedCount ?? 0), 0),
      upsertedTotal: ingestResults.reduce((sum, r) => sum + (r.upsertedCount ?? 0), 0),
    }

    const digestResults = await generateAndDeliverDigests()
    const digestOk = digestResults.every(r => r.ok)
    const digestSummary = {
      total: digestResults.length,
      succeeded: digestResults.filter(r => r.ok).length,
      failed: digestResults.filter(r => !r.ok).length,
      totalSent: digestResults.reduce((sum, r) => sum + r.sent, 0),
    }

    const allOk = ingestOk && digestOk
    const durationMs = Date.now() - startMs

    logEvent('daily_radar.run', {
      status: allOk ? 'ok' : 'partial',
      ingestOk: ingestSummary.succeeded,
      ingestTotal: ingestSummary.total,
      digestOk: digestSummary.succeeded,
      digestTotal: digestSummary.total,
      sent: digestSummary.totalSent,
      durationMs,
    })

    return NextResponse.json({
      success: allOk,
      data: {
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        ingest: { ok: ingestOk, ...ingestSummary, details: ingestResults },
        digest: { ok: digestOk, ...digestSummary, details: digestResults },
      },
    }, { status: allOk ? 200 : 207 })
  } catch (error) {
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
              AND wps.is_active = true
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
