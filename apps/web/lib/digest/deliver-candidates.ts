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
import { tryRecordProductEvent } from '@/lib/telemetry'
import { logError, logEvent, logWarn } from '@/lib/runtime'
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

async function recordChannelSuccess(input: {
  runId: string
  clientProfileId: string
  provider: 'email' | 'web_push'
  metadata: Record<string, number>
}): Promise<void> {
  const key = `${input.provider}:run:${input.runId}:profile:${input.clientProfileId}`
  await tryRecordProductEvent({
    eventName: 'delivery_succeeded',
    eventKey: `delivery_succeeded:${key}`,
    clientProfileId: input.clientProfileId,
    provider: input.provider,
    outcome: 'sent',
    metadata: input.metadata,
  })
  await tryRecordProductEvent({
    eventName: 'digest_delivered',
    eventKey: `digest_delivered:${key}`,
    clientProfileId: input.clientProfileId,
    provider: input.provider,
    outcome: 'sent',
    metadata: input.metadata,
  })
}

async function recordChannelFailure(input: {
  runId: string
  clientProfileId: string
  provider: 'email' | 'web_push'
  reason: string
  metadata?: Record<string, number>
}): Promise<void> {
  await tryRecordProductEvent({
    eventName: 'delivery_failed',
    eventKey: `delivery_failed:${input.provider}:run:${input.runId}:profile:${input.clientProfileId}`,
    clientProfileId: input.clientProfileId,
    provider: input.provider,
    outcome: input.reason,
    metadata: input.metadata ?? {},
  })
}

function recordDeliveryFailure(
  counters: DeliveryCounters,
  clientProfileId: string,
  channel: string,
): void {
  counters.failed += 1
  counters.failures.push({
    digestCandidateId: 0,
    error: `${clientProfileId}: ${channel} delivery failed`,
  })
}

/**
 * Deliver all A/B-gated candidates for a digest run.
 *
 * Telegram uses the customer's connected BYOB bot when an active endpoint exists.
 * The legacy shared bot is used when there is no active customer endpoint, or when
 * a custom dispatch fails before sending anything. A partial custom delivery never
 * falls back because that would duplicate messages for already-successful endpoints.
 * VK and signed webhook delivery are additive and best-effort. Their failures do not
 * abort the remaining channels, but they are reflected in the returned counters so
 * callers cannot report a fully successful daily run when an enabled channel failed.
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
    logEvent('digest.delivery_attempted', {
      runId,
      clientProfileId,
      candidateCount: row.candidate_count,
    })

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
      let telegramSkipped = false
      let telegramError: string | null = null
      if (customTelegram) {
        const customResult = await dispatchDigestNotifications({
          runId,
          clientProfileId,
          providers: ['telegram'],
        })

        telegramOk = customResult.failed === 0 && (customResult.sent > 0 || customResult.skipped > 0)
        telegramError = customResult.errors.join('; ') || null

        if (!telegramOk && customResult.sent === 0) {
          const legacyResult = await sendBatchDigestForRun({ runId, clientProfileId })
          telegramOk = legacyResult.ok
          telegramError = legacyResult.ok
            ? null
            : [telegramError, legacyResult.error].filter(Boolean).join('; ')
        }
      } else {
        const legacyResult = await sendBatchDigestForRun({ runId, clientProfileId })
        if (legacyResult.ok) {
          telegramOk = true
        } else {
          telegramSkipped = legacyResult.error === 'Client profile has no linked Telegram chat.'
          telegramOk = telegramSkipped
          telegramError = telegramSkipped ? null : legacyResult.error
        }
      }

      if (telegramOk) {
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'sent', error_message = NULL WHERE id = $1 AND processing_claim_token = $2`,
          [attempt.id, claimToken]
        )
        if (telegramSkipped) counters.skipped += 1
        else counters.sent += 1
        logEvent(telegramSkipped ? 'digest.telegram_skipped' : 'digest.telegram_sent', {
          runId,
          clientProfileId,
        })
      } else {
        const error = telegramError ?? 'Telegram delivery failed.'
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000) WHERE id = $1 AND processing_claim_token = $2`,
          [attempt.id, claimToken, error]
        )
        counters.failed += 1
        counters.failures.push({ digestCandidateId: 0, error: `${clientProfileId}: ${error}` })
        logWarn('digest.telegram_failed', { runId, clientProfileId, reasonCode: 'send_failed' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delivery exception.'
      await pool.query(
        `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000) WHERE id = $1 AND processing_claim_token = $2`,
        [attempt.id, claimToken, message]
      )
      counters.failed += 1
      counters.failures.push({ digestCandidateId: 0, error: `${clientProfileId}: ${message}` })
      logError('digest.telegram_failed', error, { runId, clientProfileId })
    }

    try {
      const pushResult = await notifyNewLeadsForRun({
        clientProfileId,
        digestRunId: runId,
        count: row.candidate_count,
      })
      if (pushResult.delivered && pushResult.result.sent > 0) {
        await recordChannelSuccess({
          runId,
          clientProfileId,
          provider: 'web_push',
          metadata: {
            sent: pushResult.result.sent,
            failed: pushResult.result.failed,
            pruned: pushResult.result.pruned,
          },
        })
        counters.sent += 1
      } else if (pushResult.delivered && pushResult.result.failed > 0) {
        await recordChannelFailure({
          runId,
          clientProfileId,
          provider: 'web_push',
          reason: 'send_failed',
          metadata: {
            sent: pushResult.result.sent,
            failed: pushResult.result.failed,
            pruned: pushResult.result.pruned,
          },
        })
        recordDeliveryFailure(counters, clientProfileId, 'web_push')
      }
    } catch (error) {
      logError('webpush.notify_run_failed', error, { runId, clientProfileId })
      await recordChannelFailure({ runId, clientProfileId, provider: 'web_push', reason: 'exception' })
      recordDeliveryFailure(counters, clientProfileId, 'web_push')
    }

    try {
      const emailResult = await sendDigestEmailForProfile({ clientProfileId, digestRunId: runId })
      if (emailResult.delivered) {
        await recordChannelSuccess({
          runId,
          clientProfileId,
          provider: 'email',
          metadata: { leadCount: emailResult.leadCount },
        })
        counters.sent += 1
      } else if (emailResult.reason === 'send_failed') {
        await recordChannelFailure({ runId, clientProfileId, provider: 'email', reason: emailResult.reason })
        recordDeliveryFailure(counters, clientProfileId, 'email')
      }
    } catch (error) {
      logError('email.digest_send_exception', error, { runId, clientProfileId })
      await recordChannelFailure({ runId, clientProfileId, provider: 'email', reason: 'exception' })
      recordDeliveryFailure(counters, clientProfileId, 'email')
    }

    try {
      const additional = await dispatchDigestNotifications({
        runId,
        clientProfileId,
        providers: ['vk', 'webhook'],
      })
      counters.sent += additional.sent
      counters.skipped += additional.skipped
      if (additional.failed > 0) {
        counters.failed += additional.failed
        counters.failures.push({
          digestCandidateId: 0,
          error: `${clientProfileId}: additional notification delivery failed (${additional.failed})`,
        })
        logError('notifications.additional_delivery_failed', new Error(additional.errors.join('; ')), {
          runId,
          clientProfileId,
          failed: additional.failed,
        })
      }
    } catch (error) {
      recordDeliveryFailure(counters, clientProfileId, 'additional notification')
      logError('notifications.additional_delivery_exception', error, { runId, clientProfileId })
    }
  }

  return { ok: counters.failed === 0, ...counters }
}