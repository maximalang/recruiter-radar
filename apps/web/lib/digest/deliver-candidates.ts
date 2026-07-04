/**
 * Shared digest candidate delivery logic.
 *
 * Used by both the `/api/digest/delivery` route (single profile)
 * and the `/api/cron/daily-radar` pipeline (all active profiles).
 *
 * Idempotent: delivery attempts are claimed with a token and
 * stale processing claims are reclaimed after DELIVERY_STALE_SECONDS.
 */

import { getPool, sendBatchDigestForRun } from '@/lib/db'
import { notifyNewLeadsForRun } from '@/lib/webPush'
import { sendDigestEmailForProfile } from '@/lib/email/sendDigestEmail'
import { enrichRunCandidates } from '@/lib/ai/enrichment/enrichRunCandidates'
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
 *
 * AI enrichment runs FIRST, before any delivery: it populates
 * `digest_candidates.ai_enrichment` for weak career pages so the
 * advisory "AI-подсказка" block is present in the delivered card. It is
 * strictly best-effort — provider-gated, quota-bounded, and any failure
 * is swallowed so enrichment can never block or fail delivery.
 */
export async function deliverCandidatesForRun(runId: string): Promise<DeliverRunResult> {
  const pool = getPool()
  if (!pool) {
    return { ok: false, sent: 0, failed: 0, skipped: 0, failures: [] }
  }

  // AI enrichment: provider-gated (no-op without FIRECRAWL_API_KEY),
  // per-org 1/24h quota, bounded fan-out. Must never affect delivery.
  try {
    await enrichRunCandidates(runId)
  } catch (error) {
    logError('ai.enrichment.pre_delivery_failed', error, { runId })
  }

  // Distinct client profiles that have A/B candidates in this run. Batch delivery
  // sends ONE digest per (run, profile) instead of one message per candidate, so
  // the delivery unit — and its idempotency claim — is the profile, not the lead.
  //
  // anchor_candidate_id is the smallest candidate id in this (run, profile) group.
  // digest_delivery_attempts.digest_candidate_id has a NOT NULL FK to
  // digest_candidates(id), so a batch claim must point at a REAL candidate row —
  // a 0 / synthetic sentinel violates the FK and aborts every delivery. The row
  // is only an FK anchor; per-profile uniqueness is carried by idempotency_key,
  // and GROUP BY guarantees MIN(id) exists (a group only appears with ≥1 row).
  const profiles = await pool.query<{ client_profile_id: string; candidate_count: number; anchor_candidate_id: string }>(`
    SELECT client_profile_id::TEXT AS client_profile_id,
           COUNT(*)::INT AS candidate_count,
           MIN(id)::TEXT AS anchor_candidate_id
    FROM digest_candidates
    WHERE digest_run_id = $1
      AND (payload->>'confidence_gate' NOT IN ('C', 'D') OR payload->>'confidence_gate' IS NULL)
    GROUP BY client_profile_id
    ORDER BY client_profile_id ASC
  `, [runId])

  const counters: DeliveryCounters = { sent: 0, failed: 0, skipped: 0, failures: [] }

  for (const row of profiles.rows) {
    const clientProfileId = row.client_profile_id
    const claimToken = randomUUID()
    // Idempotency is now per (run, profile, telegram-batch) — one delivery unit
    // per profile. digest_candidate_id anchors to MIN(id) of this profile's
    // candidates (a real FK target); the idempotency_key carries the profile so
    // the claim stays unique per profile regardless of which candidate anchors it.
    const idempotencyKey = `digest:${runId}:profile:${clientProfileId}:telegram-batch`
    const anchorCandidateId = row.anchor_candidate_id

    const claim = await pool.query<{ id: number; status: string; ownsClaim: boolean }>(`
      INSERT INTO digest_delivery_attempts (
        digest_candidate_id, idempotency_key, channel, status, processing_claimed_at, processing_claim_token
      )
      VALUES ($4, $1, 'telegram', 'processing', NOW(), $2)
      ON CONFLICT (digest_candidate_id, idempotency_key)
      DO UPDATE SET
        processing_claimed_at = CASE
          WHEN digest_delivery_attempts.status = 'failed'
            OR (digest_delivery_attempts.status = 'processing' AND digest_delivery_attempts.processing_claimed_at < NOW() - ($3::int * INTERVAL '1 second'))
          THEN NOW() ELSE digest_delivery_attempts.processing_claimed_at END,
        processing_claim_token = CASE
          WHEN digest_delivery_attempts.status = 'failed'
            OR (digest_delivery_attempts.status = 'processing' AND digest_delivery_attempts.processing_claimed_at < NOW() - ($3::int * INTERVAL '1 second'))
          THEN EXCLUDED.processing_claim_token ELSE digest_delivery_attempts.processing_claim_token END,
        status = CASE
          WHEN digest_delivery_attempts.status = 'failed'
            OR (digest_delivery_attempts.status = 'processing' AND digest_delivery_attempts.processing_claimed_at < NOW() - ($3::int * INTERVAL '1 second'))
          THEN 'processing' ELSE digest_delivery_attempts.status END
      RETURNING id, status::TEXT AS status, processing_claim_token = $2 AS "ownsClaim"
    `, [idempotencyKey, claimToken, DELIVERY_STALE_SECONDS, anchorCandidateId])

    const attempt = claim.rows[0]
    if (attempt.status === 'sent' || !attempt.ownsClaim) {
      counters.skipped += 1
      continue
    }

    try {
      const result = await sendBatchDigestForRun({ runId, clientProfileId })
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
        counters.failures.push({ digestCandidateId: 0, error: `${clientProfileId}: ${result.error}` })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delivery exception.'
      await pool.query(
        `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000) WHERE id = $1 AND processing_claim_token = $2`,
        [attempt.id, claimToken, message]
      )
      counters.failed += 1
      counters.failures.push({ digestCandidateId: 0, error: `${clientProfileId}: ${message}` })
    }

    // Aggregate web-push + email for this profile's strong (A/B) leads.
    // Best-effort and additive: a failure must never affect the Telegram result.
    // Dedupe/preference/subscription checks all live in the notify helpers.
    try {
      await notifyNewLeadsForRun({
        clientProfileId,
        digestRunId: runId,
        count: row.candidate_count,
      })
    } catch (error) {
      logError('webpush.notify_run_failed', error, { runId })
    }
    try {
      await sendDigestEmailForProfile({ clientProfileId, digestRunId: runId })
    } catch (error) {
      logError('email.digest_send_exception', error, { runId })
    }
  }

  return { ok: counters.failed === 0, ...counters }
}
