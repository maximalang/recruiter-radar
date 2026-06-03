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
import { runDigestForClientProfile } from '@/lib/digest'
import { getPool, sendLeadToTelegram } from '@/lib/db'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DELIVERY_STALE_SECONDS = 120

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

      // Get candidates for delivery (A/B gates only, same filter as delivery route)
      const candidates = await pool.query<{ id: number }>(`
        SELECT id
        FROM digest_candidates
        WHERE digest_run_id = $1
          AND (payload->>'confidenceGate' NOT IN ('C', 'D') OR payload->>'confidenceGate' IS NULL)
        ORDER BY id ASC
      `, [runId])

      let sent = 0
      let failed = 0
      let skipped = 0

      for (const row of candidates.rows) {
        // Claim the delivery attempt (idempotent)
        const claimToken = randomUUID()
        const idempotencyKey = `digest:${runId}:candidate:${row.id}:telegram`

        const claim = await pool.query<{ id: number; status: string; ownsClaim: boolean }>(`
          INSERT INTO digest_delivery_attempts (
            digest_candidate_id, idempotency_key, channel, status, processing_claimed_at, processing_claim_token
          )
          VALUES ($1, $2, 'telegram', 'processing', NOW(), $3)
          ON CONFLICT (digest_candidate_id, idempotency_key)
          DO UPDATE SET
            processing_claimed_at = CASE
              WHEN digest_delivery_attempts.status = 'failed'
                OR (digest_delivery_attempts.status = 'processing' AND digest_delivery_attempts.processing_claimed_at < NOW() - ($4::int * INTERVAL '1 second'))
              THEN NOW() ELSE digest_delivery_attempts.processing_claimed_at END,
            processing_claim_token = CASE
              WHEN digest_delivery_attempts.status = 'failed'
                OR (digest_delivery_attempts.status = 'processing' AND digest_delivery_attempts.processing_claimed_at < NOW() - ($4::int * INTERVAL '1 second'))
              THEN EXCLUDED.processing_claim_token ELSE digest_delivery_attempts.processing_claim_token END,
            status = CASE
              WHEN digest_delivery_attempts.status = 'failed'
                OR (digest_delivery_attempts.status = 'processing' AND digest_delivery_attempts.processing_claimed_at < NOW() - ($4::int * INTERVAL '1 second'))
              THEN 'processing' ELSE digest_delivery_attempts.status END
          RETURNING id, status::TEXT AS status, processing_claim_token = $3 AS "ownsClaim"
        `, [row.id, idempotencyKey, claimToken, DELIVERY_STALE_SECONDS])

        const attempt = claim.rows[0]
        if (attempt.status === 'sent' || !attempt.ownsClaim) {
          skipped += 1
          continue
        }

        // Send directly via Telegram
        const result = await sendLeadToTelegram(row.id)
        if (result.ok) {
          await pool.query(
            `UPDATE digest_delivery_attempts SET status = 'sent', error_message = NULL WHERE id = $1 AND processing_claim_token = $2`,
            [attempt.id, claimToken]
          )
          sent += 1
        } else {
          await pool.query(
            `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000) WHERE id = $1 AND processing_claim_token = $2`,
            [attempt.id, claimToken, result.error]
          )
          failed += 1
        }
      }

      results.push({ clientProfileId: profile.id, ok: failed === 0, sent, failed, skipped })
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
