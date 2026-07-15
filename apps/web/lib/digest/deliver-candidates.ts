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
import {
  dispatchDigestNotifications,
  hasActiveNotificationEndpoint,
} from '@/lib/notification-dispatch'
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
 * Deliver all A/B-gated candidates for a digest run.
 *
 * Telegram uses the customer's connected BYOB bot when an active endpoint exists.
 * The legacy shared bot is used when there is no active customer endpoint, or when
 * a custom dispatch fails before sending anything. A partial custom delivery never
 * falls back because that would duplicate messages for already-successful endpoints.
 * VK and signed webhook delivery are additive and best-effort, like email and push.
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

  try {
    await enrichRunCandidates(runId)
  } catch (error) {
    logError('ai.enrichment.pre_delivery_failed', error, { runId })
  }

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
      const customTelegram = await hasActiveNotificationEndpoint({
        clientProfileId,
        provider: 'telegram',
      })

      let telegramOk = false
      let telegramError: string | null = null
      if (customTelegram) {
        const customResult = await dispatchDigestNotifications({
          runId,
          clientProfileId,
          providers: ['telegram'],
        })

        // `skipped` means the deterministic custom job was already sent or the
        // route intentionally filtered this digest. Neither case is an error and
        // neither should trigger a duplicate legacy message.
        telegramOk = customResult.failed === 0 && (customResult.sent > 0 || customResult.skipped > 0)
        telegramError = customResult.errors.join('; ') || null

        // Fall back only when no custom endpoint received anything. A partial
        // success must remain a partial failure, otherwise legacy delivery would
        // duplicate the digest for endpoints that already succeeded.
        if (!telegramOk && customResult.sent === 0) {
          const legacyResult = await sendBatchDigestForRun({ runId, clientProfileId })
          telegramOk = legacyResult.ok
          telegramError = legacyResult.ok
            ? null
            : [telegramError, legacyResult.error].filter(Boolean).join('; ')
        }
      } else {
        const legacyResult = await sendBatchDigestForRun({ runId, clientProfileId })
        telegramOk = legacyResult.ok
        telegramError = legacyResult.ok ? null : legacyResult.error
      }

      if (telegramOk) {
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'sent', error_message = NULL WHERE id = $1 AND processing_claim_token = $2`,
          [attempt.id, claimToken]
        )
        counters.sent += 1
      } else {
        const error = telegramError ?? 'Telegram delivery failed.'
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000) WHERE id = $1 AND processing_claim_token = $2`,
          [attempt.id, claimToken, error]
        )
        counters.failed += 1
        counters.failures.push({ digestCandidateId: 0, error: `${clientProfileId}: ${error}` })
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

    // Additive channels never change the Telegram success result. Each helper owns
    // its own preference, endpoint and idempotency checks.
    try {
      await notifyNewLeadsForRun({
        clientProfileId,
        digestRunId: runId,
        count: row.candidate_count,
      })
    } catch (error) {
      logError('webpush.notify_run_failed', error, { runId, clientProfileId })
    }
    try {
      await sendDigestEmailForProfile({ clientProfileId, digestRunId: runId })
    } catch (error) {
      logError('email.digest_send_exception', error, { runId, clientProfileId })
    }
    try {
      const additional = await dispatchDigestNotifications({
        runId,
        clientProfileId,
        providers: ['vk', 'webhook'],
      })
      if (additional.failed > 0) {
        logError('notifications.additional_delivery_failed', new Error(additional.errors.join('; ')), {
          runId,
          clientProfileId,
          failed: additional.failed,
        })
      }
    } catch (error) {
      logError('notifications.additional_delivery_exception', error, { runId, clientProfileId })
    }
  }

  return { ok: counters.failed === 0, ...counters }
}
