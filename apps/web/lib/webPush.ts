/**
 * Web-push delivery — real implementation over the `web-push` library.
 *
 * Subscriptions live in `web_push_subscriptions` (one row per browser
 * endpoint, per client profile). VAPID keys come from env; when they are
 * absent the module degrades gracefully (`isWebPushConfigured()` is false and
 * sends are no-ops) so the rest of the product keeps working.
 *
 * This module does NOT decide *which* leads are worth a push — that stays in
 * the single digest pipeline. It only stores subscriptions and sends a payload.
 */

import webpush from "web-push";
import { randomUUID } from "node:crypto";

import { getPool } from "./db-pool";
import type { ChannelDeliveryState } from "./delivery/channel-state";
import { persistedChannelDeliveryState } from "./delivery/channel-state";
import { logError, logEvent, logWarn } from "./runtime";
import { buildNewLeadsPushPayload } from "./webPushPayload";

export type WebPushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type WebPushPayload = {
  title: string;
  body: string;
  /** Relative URL the notification opens, e.g. `/leads?gate=A`. */
  url: string;
};

export type ActiveWebPushSubscription = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

let vapidConfigured = false;

/**
 * Reads VAPID config from env and applies it to the web-push library once.
 * Returns true when all three values are present and well-formed.
 */
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;

  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();

  if (!publicKey || !privateKey || !subject) {
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
  } catch (error) {
    logError("webpush.vapid_invalid", error);
    return false;
  }
}

/** Whether web-push is configured (VAPID keys present and valid). */
export function isWebPushConfigured(): boolean {
  return ensureVapidConfigured();
}

/** Public VAPID key for the browser `pushManager.subscribe` call, or null. */
export function getWebPushPublicKey(): string | null {
  if (!ensureVapidConfigured()) return null;
  return process.env.WEB_PUSH_PUBLIC_KEY?.trim() || null;
}

/**
 * Upserts a browser subscription for a client profile.
 *
 * Endpoint is globally unique: if the same browser endpoint re-subscribes
 * (e.g. after a profile switch or key rotation) we move it to the current
 * profile, refresh the keys, and clear any prior revocation.
 */
export async function saveSubscription(input: {
  clientProfileId: string;
  subscription: WebPushSubscriptionInput;
}): Promise<{ ok: boolean; error?: string }> {
  const pool = getPool();
  if (!pool) return { ok: false, error: "DATABASE_URL is not set." };

  const { endpoint, keys } = input.subscription;
  if (!endpoint?.trim() || !keys?.p256dh?.trim() || !keys?.auth?.trim()) {
    return { ok: false, error: "Invalid push subscription." };
  }

  try {
    await pool.query(
      `
      INSERT INTO web_push_subscriptions (client_profile_id, endpoint, p256dh, auth)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (endpoint) DO UPDATE
      SET
        client_profile_id = EXCLUDED.client_profile_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        last_seen_at = NOW(),
        revoked_at = NULL
      `,
      [input.clientProfileId, endpoint.trim(), keys.p256dh.trim(), keys.auth.trim()]
    );
    return { ok: true };
  } catch (error) {
    logError("webpush.save_subscription_failed", error);
    return { ok: false, error: "Failed to save push subscription." };
  }
}

/**
 * Revokes a subscription by endpoint, scoped to the owning client profile so a
 * caller cannot revoke another profile's subscription by guessing an endpoint.
 */
export async function revokeSubscription(input: {
  clientProfileId: string;
  endpoint: string;
}): Promise<{ ok: boolean; error?: string }> {
  const pool = getPool();
  if (!pool) return { ok: false, error: "DATABASE_URL is not set." };

  try {
    await pool.query(
      `
      UPDATE web_push_subscriptions
      SET revoked_at = NOW()
      WHERE client_profile_id = $1 AND endpoint = $2 AND revoked_at IS NULL
      `,
      [input.clientProfileId, input.endpoint.trim()]
    );
    return { ok: true };
  } catch (error) {
    logError("webpush.revoke_subscription_failed", error);
    return { ok: false, error: "Failed to revoke push subscription." };
  }
}

/** All active (non-revoked) subscriptions for a client profile. */
export async function getActiveSubscriptions(
  clientProfileId: string
): Promise<ActiveWebPushSubscription[]> {
  const pool = getPool();
  if (!pool) return [];

  const result = await pool.query<ActiveWebPushSubscription>(
    `
    SELECT id, endpoint, p256dh, auth
    FROM web_push_subscriptions
    WHERE client_profile_id = $1 AND revoked_at IS NULL
    ORDER BY id ASC
    `,
    [clientProfileId]
  );
  return result.rows;
}

/** Count of active subscriptions for a client profile. */
export async function getActiveSubscriptionCount(clientProfileId: string): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;

  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count FROM web_push_subscriptions WHERE client_profile_id = $1 AND revoked_at IS NULL`,
    [clientProfileId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export type SendWebPushResult = {
  sent: number;
  failed: number;
  ambiguous: number;
  retryable: number;
  pruned: number;
};

/**
 * Sends a payload to every active subscription of a client profile.
 *
 * Gone endpoints (404/410) are marked revoked so they stop being retried.
 * Other transient errors are counted as failed but left active. No-op (and
 * not an error) when web-push is unconfigured or there are no subscriptions.
 */
export async function sendWebPushToProfile(input: {
  clientProfileId: string;
  payload: WebPushPayload;
}): Promise<SendWebPushResult> {
  const result: SendWebPushResult = { sent: 0, failed: 0, ambiguous: 0, retryable: 0, pruned: 0 };

  if (!ensureVapidConfigured()) {
    return result;
  }

  const pool = getPool();
  if (!pool) return result;

  const subscriptions = await getActiveSubscriptions(input.clientProfileId);
  if (subscriptions.length === 0) return result;

  const body = JSON.stringify(input.payload);

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
      result.sent += 1;
    } catch (error) {
      const statusCode =
        error && typeof error === "object" && "statusCode" in error
          ? Number((error as { statusCode: unknown }).statusCode)
          : null;

      if (statusCode === 404 || statusCode === 410) {
        // Endpoint is gone — prune it so we stop retrying a dead browser.
        await pool
          .query(
            `UPDATE web_push_subscriptions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
            [sub.id]
          )
          .catch(() => logWarn("webpush.prune_failed", {
            clientProfileId: input.clientProfileId,
            reasonCode: "subscription_revoke_persistence_failed",
          }));
        result.pruned += 1;
      } else {
        const ambiguous = statusCode == null || statusCode >= 500;
        const retryable = statusCode === 429;
        logWarn("webpush.send_failed", {
          clientProfileId: input.clientProfileId,
          reasonCode: ambiguous
            ? "provider_outcome_ambiguous"
            : retryable ? "provider_retryable_failure" : "provider_terminal_failure",
        });
        result.failed += 1;
        if (ambiguous) result.ambiguous += 1;
        if (retryable) result.retryable += 1;
      }
    }
  }

  logEvent("webpush.sent", {
    clientProfileId: input.clientProfileId,
    sent: result.sent,
    failed: result.failed,
    ambiguous: result.ambiguous,
    retryable: result.retryable,
    pruned: result.pruned
  });

  return result;
}

export type NotifyNewLeadsResult =
  | { delivered: true; state: 'sent'; attempt: number; result: SendWebPushResult }
  | {
      delivered: false;
      state: Exclude<ChannelDeliveryState, 'sent'>;
      attempt?: number;
      result?: SendWebPushResult;
      reason?: "not_configured" | "disabled" | "no_subscriptions" | "no_leads";
    };

/**
 * Aggregate "N new strong leads" push for a completed digest run.
 *
 * Run-level, not per-lead. Dedupe is atomic: a single
 * `lead_channel_deliveries` row keyed `(web_push, profile, run:<runId>)` is the
 * claim point. The claim starts as `processing`; after provider delivery it is
 * finalized as `sent`, `failed_retryable`, or `failed_terminal`. Only `sent`
 * receives a real `delivered_at`. A full zero-send failure is eligible for a
 * DB-timed retry; partial delivery is terminal because replay would duplicate
 * successful subscriptions.
 *
 * Does NOT decide which leads count — the caller passes `count` (the A/B
 * candidates the digest pipeline already selected), so selection rules are not
 * forked here.
 */
export async function notifyNewLeadsForRun(input: {
  clientProfileId: string;
  digestRunId: string;
  count: number;
  url?: string;
}): Promise<NotifyNewLeadsResult> {
  if (input.count <= 0) {
    return { delivered: false, state: 'not_attempted', reason: "no_leads" };
  }

  const pool = getPool();
  if (!pool) {
    return { delivered: false, state: 'failed_terminal', reason: "not_configured" };
  }

  const dedupeKey = `run:${input.digestRunId}`;
  const prior = await pool.query<{ delivery_status: string; attempt_count: number }>(
    `SELECT delivery_status, attempt_count
     FROM lead_channel_deliveries
     WHERE channel = 'web_push'
       AND client_profile_id = $1
       AND dedupe_key = $2
     LIMIT 1`,
    [input.clientProfileId, dedupeKey],
  );
  const priorState = persistedChannelDeliveryState(prior.rows[0]?.delivery_status);
  const priorAttempt = prior.rows[0]?.attempt_count ?? 0;
  if (priorState === 'failed_retryable' && priorAttempt >= 5) {
    await pool.query(
      `UPDATE lead_channel_deliveries
       SET delivery_status = 'failed_terminal', next_retry_at = NULL,
           processing_claim_token = NULL, last_error_reason = 'channel_attempt_limit_reached'
       WHERE channel = 'web_push'
         AND client_profile_id = $1
         AND dedupe_key = $2
         AND delivery_status = 'failed_retryable'
         AND attempt_count >= 5`,
      [input.clientProfileId, dedupeKey],
    );
    return { delivered: false, state: 'failed_terminal', attempt: priorAttempt };
  }
  if (priorState === 'processing') {
    const fenced = await pool.query(
      `UPDATE lead_channel_deliveries
       SET delivery_status = 'failed_terminal',
           processing_claim_token = NULL,
           next_retry_at = NULL,
           last_error_reason = 'ambiguous_stale_processing'
       WHERE channel = 'web_push'
         AND client_profile_id = $1
         AND dedupe_key = $2
         AND delivery_status = 'processing'
         AND attempted_at < NOW() - INTERVAL '2 hours'`,
      [input.clientProfileId, dedupeKey],
    );
    if (fenced.rowCount === 1) {
      return { delivered: false, state: 'failed_terminal', attempt: priorAttempt };
    }
  }
  if (priorState && priorState !== 'failed_retryable') {
    return { delivered: false, state: priorState, attempt: priorAttempt };
  }

  // Respect the per-profile preference before doing any work.
  const enabled = await pool.query<{ web_push_enabled: boolean }>(
    `SELECT web_push_enabled FROM client_profiles WHERE id = $1 LIMIT 1`,
    [input.clientProfileId]
  );
  if (enabled.rowCount !== 1 || enabled.rows[0].web_push_enabled !== true) {
    return priorState === 'failed_retryable'
      ? { delivered: false, state: 'failed_retryable', attempt: priorAttempt }
      : { delivered: false, state: 'skipped_disabled', reason: "disabled" };
  }

  const subscriptionCount = await getActiveSubscriptionCount(input.clientProfileId);
  if (subscriptionCount === 0) {
    return priorState === 'failed_retryable'
      ? { delivered: false, state: 'failed_retryable', attempt: priorAttempt }
      : { delivered: false, state: 'skipped_disabled', reason: "no_subscriptions" };
  }

  if (!ensureVapidConfigured()) {
    if (priorState === 'failed_retryable') {
      await pool.query(
        `UPDATE lead_channel_deliveries
         SET delivery_status = 'failed_terminal', next_retry_at = NULL,
             processing_claim_token = NULL, last_error_reason = 'provider_not_configured'
         WHERE channel = 'web_push'
           AND client_profile_id = $1
           AND dedupe_key = $2
           AND delivery_status = 'failed_retryable'`,
        [input.clientProfileId, dedupeKey],
      );
    }
    return { delivered: false, state: 'failed_terminal', attempt: priorAttempt, reason: "not_configured" };
  }

  const claimToken = randomUUID();
  const claim = await pool.query<{ id: number; attemptCount: number; ownsClaim: boolean }>(
    `
    INSERT INTO lead_channel_deliveries (
      channel, client_profile_id, digest_run_id, dedupe_key, lead_count,
      delivery_status, delivered_at, attempt_count, processing_claim_token,
      next_retry_at, last_error_reason
    )
    VALUES ('web_push', $1, $2, $3, $4, 'processing', NULL, 1, $5::UUID, NULL, NULL)
    ON CONFLICT (channel, client_profile_id, dedupe_key) DO UPDATE SET
      delivery_status = 'processing',
      attempted_at = NOW(),
      attempt_count = lead_channel_deliveries.attempt_count + 1,
      processing_claim_token = EXCLUDED.processing_claim_token,
      next_retry_at = NULL,
      last_error_reason = NULL
    WHERE lead_channel_deliveries.delivery_status = 'failed_retryable'
      AND COALESCE(lead_channel_deliveries.next_retry_at, '-infinity'::TIMESTAMPTZ) <= NOW()
      AND lead_channel_deliveries.attempt_count < 5
    RETURNING id, attempt_count AS "attemptCount",
      processing_claim_token = $5::UUID AS "ownsClaim"
    `,
    [input.clientProfileId, input.digestRunId, dedupeKey, input.count, claimToken]
  );

  if (claim.rowCount !== 1 || !claim.rows[0]?.ownsClaim) {
    const current = await pool.query<{ delivery_status: string; attempt_count: number }>(
      `SELECT delivery_status, attempt_count
       FROM lead_channel_deliveries
       WHERE channel = 'web_push'
         AND client_profile_id = $1
         AND dedupe_key = $2
       LIMIT 1`,
      [input.clientProfileId, dedupeKey],
    );
    const state = persistedChannelDeliveryState(current.rows[0]?.delivery_status) ?? 'failed_terminal';
    return { delivered: false, state, attempt: current.rows[0]?.attempt_count ?? priorAttempt };
  }
  const claimId = claim.rows[0]?.id;
  if (!claimId) {
    return { delivered: false, state: 'failed_terminal', attempt: priorAttempt };
  }
  const attempt = claim.rows[0].attemptCount;

  const payload = buildNewLeadsPushPayload({ count: input.count, url: input.url });
  const result = await sendWebPushToProfile({ clientProfileId: input.clientProfileId, payload });
  const providerStatus = result.sent > 0
    ? result.failed > 0 ? "failed_terminal" : "sent"
    : result.ambiguous > 0 ? "failed_terminal"
      : result.failed > 0 && result.retryable === result.failed
        ? "failed_retryable"
        : "failed_terminal";
  const status = providerStatus === 'failed_retryable' && attempt >= 5
    ? 'failed_terminal'
    : providerStatus;
  const finalized = await pool.query(
    `UPDATE lead_channel_deliveries
     SET delivery_status = $2,
         delivered_at = CASE WHEN $3::BOOLEAN THEN NOW() ELSE NULL END,
         next_retry_at = CASE
           WHEN $2 = 'failed_retryable' THEN NOW() + (
             CASE $6::INT
               WHEN 1 THEN 30
               WHEN 2 THEN 300
               WHEN 3 THEN 1800
               ELSE 10800
             END * INTERVAL '1 second'
           )
           ELSE NULL
         END,
         processing_claim_token = NULL,
         last_error_reason = CASE
           WHEN $2 = 'failed_retryable' THEN 'provider_retryable_failure'
           WHEN $2 = 'failed_terminal' AND $3::BOOLEAN THEN 'partial_delivery_no_safe_replay'
           WHEN $2 = 'failed_terminal' AND $5::INT > 0 THEN 'ambiguous_delivery_no_safe_replay'
           WHEN $2 = 'failed_terminal' THEN 'no_delivery_no_safe_replay'
           ELSE NULL
         END
     WHERE id = $1
       AND delivery_status = 'processing'
       AND processing_claim_token = $4::UUID`,
    [claimId, status, result.sent > 0, claimToken, result.ambiguous, attempt],
  );
  if (finalized.rowCount !== 1) {
    throw new Error("Web Push aggregate delivery state could not be finalized.");
  }
  if (status === 'sent') {
    return { delivered: true, state: 'sent', attempt, result };
  }
  return { delivered: false, state: status, attempt, result };
}
