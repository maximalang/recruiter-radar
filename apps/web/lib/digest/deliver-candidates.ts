/**
 * Shared digest candidate delivery logic.
 *
 * Used by both the `/api/digest/delivery` route (single profile)
 * and the `/api/cron/daily-radar` pipeline (all active profiles).
 *
 * Idempotent: each channel has a durable claim. Ambiguous processing/terminal
 * states are surfaced to the operator and are never replayed automatically.
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
import { isChannelDeliveryFailure } from '@/lib/delivery/channel-state'
import type { ChannelDeliveryState } from '@/lib/delivery/channel-state'
import { logEvent, logWarn } from '@/lib/runtime'
import { randomUUID } from 'node:crypto'

export interface DeliveryCounters {
  sent: number
  failed: number
  skipped: number
  failures: Array<{
    digestCandidateId: number
    error: string
    channel?: string
    state?: ChannelDeliveryState
    retryable?: boolean
    attempt?: number
  }>
}

export interface DeliverRunResult {
  ok: boolean
  sent: number
  failed: number
  skipped: number
  failures: DeliveryCounters['failures']
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
  state: ChannelDeliveryState = 'failed_terminal',
  attempt = 1,
): void {
  counters.failed += 1
  counters.failures.push({
    digestCandidateId: 0,
    error: `${clientProfileId}: ${channel} (${state}) delivery failed`,
    channel,
    state,
    retryable: state === 'failed_retryable',
    attempt,
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
  } catch {
    logWarn('ai.enrichment.pre_delivery_failed', { runId, reasonCode: 'enrichment_failed' })
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
      WITH inserted AS (
        INSERT INTO digest_delivery_attempts (
          digest_candidate_id, idempotency_key, channel, status,
          processing_claimed_at, processing_claim_token
        )
        VALUES ($3, $1, 'telegram', 'processing', NOW(), $2)
        ON CONFLICT (digest_candidate_id, idempotency_key) DO UPDATE SET
          status = 'processing',
          attempted_at = NOW(),
          error_message = NULL,
          processing_claim_token = EXCLUDED.processing_claim_token
        WHERE digest_delivery_attempts.status = 'failed_retryable'
        RETURNING id, status::TEXT AS status, processing_claim_token = $2 AS "ownsClaim"
      )
      SELECT id, status, "ownsClaim" FROM inserted
      UNION ALL
      SELECT id, status::TEXT AS status, false AS "ownsClaim"
      FROM digest_delivery_attempts
      WHERE digest_candidate_id = $3
        AND idempotency_key = $1
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1
    `, [idempotencyKey, claimToken, anchorCandidateId])

    const attempt = claim.rows[0]
    const telegramAlreadyDelivered = attempt.status === 'sent'
      || attempt.status === 'skipped_not_configured'
    if (telegramAlreadyDelivered) {
      counters.skipped += 1
    } else if (!attempt.ownsClaim) {
      recordDeliveryFailure(
        counters,
        clientProfileId,
        'telegram',
        attempt.status === 'processing' ? 'processing' : 'failed_terminal',
      )
    }

    if (attempt.ownsClaim && !telegramAlreadyDelivered) {
      try {
        const customTelegram = await hasActiveNotificationEndpoint({
          clientProfileId,
          provider: 'telegram',
        })

        let telegramOk = false
        let telegramSkipped = false
        let telegramError: string | null = null
        let telegramFailureState: ChannelDeliveryState = 'failed_terminal'
        if (customTelegram) {
          const customResult = await dispatchDigestNotifications({
            runId,
            clientProfileId,
            providers: ['telegram'],
          })

          telegramOk = customResult.failed === 0 && (customResult.sent > 0 || customResult.skipped > 0)
          telegramError = customResult.failed > 0 ? 'custom_notification_delivery_failed' : null
          telegramFailureState = customResult.sent === 0
            && (customResult.retryableFailed ?? 0) > 0
            && (customResult.terminalFailed ?? 0) === 0
            && (customResult.processing ?? 0) === 0
            ? 'failed_retryable'
            : 'failed_terminal'
        } else {
          const legacyResult = await sendBatchDigestForRun({ runId, clientProfileId })
          if (legacyResult.ok) {
            telegramOk = true
          } else {
            telegramSkipped = legacyResult.error === 'Client profile has no linked Telegram chat.'
            telegramOk = telegramSkipped
            telegramError = telegramSkipped ? null : 'legacy_telegram_delivery_failed'
          }
        }

        if (telegramOk) {
          const finalized = await pool.query(
            `UPDATE digest_delivery_attempts
             SET status = $3, error_message = NULL, processing_claim_token = NULL
             WHERE id = $1 AND processing_claim_token = $2 AND status = 'processing'`,
            [attempt.id, claimToken, telegramSkipped ? 'skipped_not_configured' : 'sent']
          )
          if (finalized.rowCount !== 1) {
            throw new Error('Telegram delivery ownership was lost before finalization.')
          }
          if (telegramSkipped) counters.skipped += 1
          else counters.sent += 1
          logEvent(telegramSkipped ? 'digest.telegram_skipped' : 'digest.telegram_sent', {
            runId,
            clientProfileId,
          })
        } else {
          const error = telegramError ?? 'telegram_delivery_failed'
          await pool.query(
            `UPDATE digest_delivery_attempts
             SET status = $4, error_message = LEFT($3, 1000), processing_claim_token = NULL
             WHERE id = $1 AND processing_claim_token = $2 AND status = 'processing'`,
            [attempt.id, claimToken, error, telegramFailureState]
          )
          counters.failed += 1
          counters.failures.push({
            digestCandidateId: 0,
            error: `${clientProfileId}: ${error}`,
            channel: 'telegram',
            state: telegramFailureState,
            retryable: telegramFailureState === 'failed_retryable',
            attempt: 1,
          })
          logWarn('digest.telegram_failed', { runId, clientProfileId, reasonCode: 'send_failed' })
        }
      } catch {
        await pool.query(
          `UPDATE digest_delivery_attempts
           SET status = 'failed_terminal', error_message = $3, processing_claim_token = NULL
           WHERE id = $1 AND processing_claim_token = $2 AND status = 'processing'`,
          [attempt.id, claimToken, 'telegram_delivery_exception']
        )
        recordDeliveryFailure(counters, clientProfileId, 'telegram', 'failed_terminal')
        logWarn('digest.telegram_failed', { runId, clientProfileId, reasonCode: 'delivery_exception' })
      }
    }

    try {
      const pushResult = await notifyNewLeadsForRun({
        clientProfileId,
        digestRunId: runId,
        count: row.candidate_count,
      })
      if (pushResult.delivered) {
        const metadata = {
          sent: pushResult.result.sent,
          failed: pushResult.result.failed,
          ambiguous: pushResult.result.ambiguous,
          pruned: pushResult.result.pruned,
        }
        if (pushResult.result.sent > 0) {
          await recordChannelSuccess({
            runId,
            clientProfileId,
            provider: 'web_push',
            metadata,
          })
          counters.sent += 1
        }
      } else if (isChannelDeliveryFailure(pushResult.state)) {
        const metadata = pushResult.result
          ? {
              sent: pushResult.result.sent,
              failed: pushResult.result.failed,
              ambiguous: pushResult.result.ambiguous,
              pruned: pushResult.result.pruned,
            }
          : undefined
        await recordChannelFailure({
          runId,
          clientProfileId,
          provider: 'web_push',
          reason: pushResult.state,
          metadata,
        })
        recordDeliveryFailure(
          counters,
          clientProfileId,
          'web_push',
          pushResult.state,
          pushResult.attempt ?? 1,
        )
        logWarn('digest.channel_failed', {
          runId,
          clientProfileId,
          channel: 'web_push',
          state: pushResult.state,
          retryable: pushResult.state === 'failed_retryable',
          attempt: pushResult.attempt ?? 0,
          reasonCode: 'channel_state',
        })
      } else if (pushResult.state === 'already_successfully_delivered') {
        counters.skipped += 1
      }
    } catch {
      logWarn('webpush.notify_run_failed', { runId, clientProfileId, reasonCode: 'channel_exception' })
      await recordChannelFailure({ runId, clientProfileId, provider: 'web_push', reason: 'exception' })
      recordDeliveryFailure(counters, clientProfileId, 'web_push', 'failed_terminal')
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
      } else if (isChannelDeliveryFailure(emailResult.state)) {
        await recordChannelFailure({ runId, clientProfileId, provider: 'email', reason: emailResult.state })
        recordDeliveryFailure(counters, clientProfileId, 'email', emailResult.state)
        logWarn('digest.channel_failed', {
          runId,
          clientProfileId,
          channel: 'email',
          state: emailResult.state,
          retryable: emailResult.state === 'failed_retryable',
          attempt: 1,
          reasonCode: 'channel_state',
        })
      } else if (emailResult.state === 'already_successfully_delivered') {
        counters.skipped += 1
      }
    } catch {
      logWarn('email.digest_send_exception', { runId, clientProfileId, reasonCode: 'channel_exception' })
      await recordChannelFailure({ runId, clientProfileId, provider: 'email', reason: 'exception' })
      recordDeliveryFailure(counters, clientProfileId, 'email', 'failed_terminal')
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
          channel: 'notification_endpoint',
          state: (additional.terminalFailed ?? 0) > 0
            ? 'failed_terminal'
            : (additional.processing ?? 0) > 0 ? 'processing' : 'failed_retryable',
          retryable: (additional.terminalFailed ?? 0) === 0 && (additional.processing ?? 0) === 0,
          attempt: 1,
        })
        logWarn('notifications.additional_delivery_failed', {
          runId,
          clientProfileId,
          failed: additional.failed,
          terminalFailed: additional.terminalFailed ?? 0,
          retryableFailed: additional.retryableFailed ?? 0,
          processing: additional.processing ?? 0,
          reasonCode: 'channel_delivery_failed',
        })
      }
    } catch {
      recordDeliveryFailure(counters, clientProfileId, 'additional notification', 'failed_terminal')
      logWarn('notifications.additional_delivery_exception', {
        runId,
        clientProfileId,
        reasonCode: 'channel_exception',
      })
    }
  }

  return { ok: counters.failed === 0, ...counters }
}
