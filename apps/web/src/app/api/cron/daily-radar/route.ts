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
import { ingestAllPrimarySources, type IngestResult } from '@/lib/lead-discovery/source-ingest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Auth — dedicated CRON_API_KEY, fallback to INGEST_API_KEY
  const apiKey = process.env.CRON_API_KEY || process.env.INGEST_API_KEY || process.env.DIGEST_API_KEY
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

  const startedAt = new Date().toISOString()

  try {
    // Step 1: Ingest all primary sources
    const ingestResults = await ingestAllPrimarySources()
    const ingestOk = ingestResults.every(r => r.success)
    const ingestSummary = {
      total: ingestResults.length,
      succeeded: ingestResults.filter(r => r.success).length,
      failed: ingestResults.filter(r => !r.success).length,
      fetchedTotal: ingestResults.reduce((sum, r) => sum + (r.fetchedCount ?? 0), 0),
      upsertedTotal: ingestResults.reduce((sum, r) => sum + (r.upsertedCount ?? 0), 0),
    }

    // Step 2: Generate digests for active client profiles
    // Uses the existing /api/digest/delivery endpoint internally
    const digestResults = await generateDigestsForActiveProfiles()
    const digestOk = digestResults.every(r => r.ok)
    const digestSummary = {
      total: digestResults.length,
      succeeded: digestResults.filter(r => r.ok).length,
      failed: digestResults.filter(r => !r.ok).length,
      totalSent: digestResults.reduce((sum, r) => sum + r.sent, 0),
    }

    // Step 3: Log summary
    const allOk = ingestOk && digestOk
    const completedAt = new Date().toISOString()
    const durationMs = Date.now() - new Date(startedAt).getTime()

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
        startedAt,
        completedAt,
        durationMs,
        ingest: { ok: ingestOk, ...ingestSummary, details: ingestResults },
        digest: { ok: digestOk, ...digestSummary, details: digestResults },
      },
    }, { status: allOk ? 200 : 207 })
  } catch (error) {
    console.error('[daily-radar] pipeline failed:', error)
    return NextResponse.json(
      { success: false, error: 'Daily radar pipeline failed', startedAt },
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
 * Queries active profiles from DB, then calls the delivery pipeline
 * for each one sequentially (to avoid overloading the Telegram API).
 */
async function generateDigestsForActiveProfiles(): Promise<DigestDeliveryResult[]> {
  const { getPool } = await import('@/lib/db')
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
  const digestApiKey = process.env.DIGEST_API_KEY

  for (const profile of profiles.rows) {
    try {
      // Run digest + delivery in one call via the existing API
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
      const response = await fetch(`${baseUrl}/api/digest/delivery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(digestApiKey ? { 'x-api-key': digestApiKey } : {}),
        },
        body: JSON.stringify({ clientProfileId: profile.id }),
      })

      const data = await response.json() as { ok?: boolean; counters?: { sent: number; failed: number; skipped: number } }
      results.push({
        clientProfileId: profile.id,
        ok: data.ok ?? false,
        sent: data.counters?.sent ?? 0,
        failed: data.counters?.failed ?? 0,
        skipped: data.counters?.skipped ?? 0,
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
