/**
 * Shared digest candidate delivery logic.
 *
 * Used by both the `/api/digest/delivery` route (single profile)
 * and the `/api/cron/daily-radar` pipeline (all active profiles).
 *
 * Idempotent: delivery attempts are claimed with a token and
 * stale processing claims are reclaimed after DELIVERY_STALE_SECONDS.
 */

import { getPool, sendLeadToTelegram } from '@/lib/db'
import { notifyNewLeadsForRun } from '@/lib/webPush'
import { sendDigestEmailForProfile } from '@/lib/email/sendDigestEmail'
import { logError } from '@/lib/runtime'
import { randomUUID } from 'node:crypto'

const DELIVERY_STALE_SECONDS = 120

export interface DeliveryCounters {
  sent: number
  failed: number
  skipped: number
  failures: Array<{ digestCandidateId: number; error: string }>
}

export interface DeliverRunResult {
  ok: boolean
  sent: number
  failed: number
  skipped: number
  failures: Array<{ digestCandidateId: number; error: string }>
}

/**
 * Deliver all A/B-gated candidates for a digest run via Telegram.
 *
 * Claims each delivery attempt idempotently. Skips already-sent
 * candidates and claims owned by another worker. Records success/failure.
 */
export async function deliverCandidatesForRun(runId: string): Promise<DeliverRunResult> {
  const pool = getPool()
  if (!pool) {
    return { ok: false, sent: 0, failed: 0, skipped: 0, failures: [] }
  }

  // Get candidates for delivery (A/B gates only)
  const candidates = await pool.query<{ id: number; client_profile_id: string }>(`
    SELECT id, client_profile_id::TEXT AS client_profile_id
    FROM digest_candidates
    WHERE digest_run_id = $1
      AND (payload->>'confidence_gate' NOT IN ('C', 'D') OR payload->>'confidence_gate' IS NULL)
    ORDER BY id ASC
  `, [runId])

  const counters: DeliveryCounters = { sent: 0, failed: 0, skipped: 0, failures: [] }

  for (const row of candidates.rows) {
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
      counters.skipped += 1
      continue
    }

    try {
      const result = await sendLeadToTelegram(row.id)
      if (result.ok) {
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'sent', error_message = NULL WHERE id = $1 AND processing_claim_token = $2`,
          [attempt.id, claimToken]
        )
        counters.sent += 1
      } else {
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000) WHERE id = $1 AND processing_claim_token = $2`,
          [attempt.id, claimToken, result.error]
        )
        counters.failed += 1
        counters.failures.push({ digestCandidateId: row.id, error: result.error })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delivery exception.'
      await pool.query(
        `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000) WHERE id = $1 AND processing_claim_token = $2`,
        [attempt.id, claimToken, message]
      )
      counters.failed += 1
      counters.failures.push({ digestCandidateId: row.id, error: message })
    }
  }

  // Aggregate web-push for this run's strong (A/B) leads. Best-effort and
  // additive: a push failure must never affect the Telegram delivery result.
  // Dedupe/preference/subscription checks all live in notifyNewLeadsForRun.
  if (candidates.rows.length > 0) {
    const clientProfileId = candidates.rows[0].client_profile_id
    try {
      await notifyNewLeadsForRun({
        clientProfileId,
        digestRunId: runId,
        count: candidates.rows.length,
      })
    } catch (error) {
      logError('webpush.notify_run_failed', error, { runId })
    }

    // Daily email digest for this profile. Best-effort and additive, same as
    // web-push: a failure must never affect the Telegram delivery result.
    // Preference/destination/dedupe (one email per profile per day) all live in
    // sendDigestEmailForProfile.
    try {
      await sendDigestEmailForProfile({ clientProfileId, digestRunId: runId })
    } catch (error) {
      logError('email.digest_send_exception', error, { runId })
    }
  }

  return { ok: counters.failed === 0, ...counters }
}
