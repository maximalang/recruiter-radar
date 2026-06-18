/**
 * Cron: Daily Radar Pipeline
 *
 * Triggered by n8n or external scheduler to run the complete daily cycle:
 *   1. Ingest source data (HH, SuperJob, Habr Career)
 *   2. Generate digest for each active client profile
 *   3. Deliver digest to Telegram
 *
 * Auth: CRON_API_KEY (separate from ingestion/digest keys)
 * Runtime: nodejs (requires child_process for ingestion scripts)
 */

import { NextRequest, NextResponse } from 'next/server'
import { ingestAllPrimarySources, isNoActiveProfiles, type IngestResult } from '@/lib/lead-discovery/source-ingest'
import { runDigestForClientProfile } from '@/lib/digest'
import { deliverCandidatesForRun, type DeliverRunResult } from '@/lib/digest/deliver-candidates'
import { getPool } from '@/lib/db'

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
  // Auth — CRON_API_KEY only, no fallback to other keys
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
    // Step 1: Ingest all primary sources
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

    // Step 2: Generate and deliver digests for active client profiles
    const digestResults = await generateAndDeliverDigests()
    const digestOk = digestResults.every(r => r.ok)
    const digestSummary = {
      total: digestResults.length,
      succeeded: digestResults.filter(r => r.ok).length,
      failed: digestResults.filter(r => !r.ok).length,
      totalSent: digestResults.reduce((sum, r) => sum + r.sent, 0),
    }

    // Step 3: Log summary
    const allOk = ingestOk && digestOk
    const durationMs = Date.now() - startMs

    console.log(
      `[daily-radar] ${allOk ? 'OK' : 'PARTIAL'}: ` +
      `ingest(${ingestSummary.succeeded}/${ingestSummary.total}) ` +
      `digest(${digestSummary.succeeded}/${digestSummary.total}) ` +
      `sent(${digestSummary.totalSent}) ` +
      `duration(${durationMs}ms)`
    )

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
    console.error('[daily-radar] pipeline failed:', error)
    return NextResponse.json(
      { success: false, error: 'Daily radar pipeline failed' },
      { status: 500 }
    )
  }
}

/** Per-profile digest generation result */
interface DigestDeliveryResult {
  clientProfileId: string
  ok: boolean
  sent: number
  failed: number
  skipped: number
  error?: string
}

/**
 * Generate and deliver digests for all active client profiles.
 *
 * Calls the digest + delivery logic directly (no self-fetch).
 * Processes profiles sequentially to avoid overloading the
 * Telegram Bot API rate limits.
 */
async function generateAndDeliverDigests(): Promise<DigestDeliveryResult[]> {
  const pool = getPool()
  if (!pool) {
    return [{ clientProfileId: 'none', ok: false, sent: 0, failed: 0, skipped: 0, error: 'DATABASE_URL not set' }]
  }

  // Get all active client profiles with Telegram connected
  const profiles = await pool.query<{ id: string }>(`
    SELECT id::TEXT AS id
    FROM client_profiles
    WHERE is_active = true
      AND telegram_chat_id IS NOT NULL
    ORDER BY id
  `)

  if (profiles.rows.length === 0) {
    return []
  }

  const results: DigestDeliveryResult[] = []

  for (const profile of profiles.rows) {
    try {
      // Run digest generation directly
      const { run } = await runDigestForClientProfile({ clientProfileId: profile.id })
      const runId = run.id

      // Deliver candidates using shared logic
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
