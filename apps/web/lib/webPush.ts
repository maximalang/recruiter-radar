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

import { getPool } from "./db-pool";
import { logError, logEvent } from "./runtime";
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
  const result: SendWebPushResult = { sent: 0, failed: 0, pruned: 0 };

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
          .catch((pruneError) => logError("webpush.prune_failed", pruneError));
        result.pruned += 1;
      } else {
        logError("webpush.send_failed", error);
        result.failed += 1;
      }
    }
  }

  logEvent("webpush.sent", {
    clientProfileId: input.clientProfileId,
    sent: result.sent,
    failed: result.failed,
    pruned: result.pruned
  });

  return result;
}

export type NotifyNewLeadsResult =
  | { delivered: true; result: SendWebPushResult }
  | { delivered: false; reason: "not_configured" | "disabled" | "no_subscriptions" | "already_sent" | "no_leads" };

/**
 * Aggregate "N new strong leads" push for a completed digest run.
 *
 * Run-level, not per-lead. Dedupe is atomic: a single
 * `lead_channel_deliveries` row keyed `(web_push, profile, run:<runId>)` is the
 * commit point — if INSERT ... ON CONFLICT DO NOTHING inserts, we own delivery;
 * if it does not, another worker already notified this run, so we bail. This is
 * the spam-guard: at most one push per run.
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
    return { delivered: false, reason: "no_leads" };
  }
  if (!ensureVapidConfigured()) {
    return { delivered: false, reason: "not_configured" };
  }

  const pool = getPool();
  if (!pool) {
    return { delivered: false, reason: "not_configured" };
  }

  // Respect the per-profile preference before doing any work.
  const enabled = await pool.query<{ web_push_enabled: boolean }>(
    `SELECT web_push_enabled FROM client_profiles WHERE id = $1 LIMIT 1`,
    [input.clientProfileId]
  );
  if (enabled.rowCount !== 1 || enabled.rows[0].web_push_enabled !== true) {
    return { delivered: false, reason: "disabled" };
  }

  const subscriptionCount = await getActiveSubscriptionCount(input.clientProfileId);
  if (subscriptionCount === 0) {
    return { delivered: false, reason: "no_subscriptions" };
  }

  // Atomic dedupe claim: only the first caller for this run inserts a row.
  const dedupeKey = `run:${input.digestRunId}`;
  const claim = await pool.query<{ id: number }>(
    `
    INSERT INTO lead_channel_deliveries (channel, client_profile_id, digest_run_id, dedupe_key, lead_count)
    VALUES ('web_push', $1, $2, $3, $4)
    ON CONFLICT (channel, client_profile_id, dedupe_key) DO NOTHING
    RETURNING id
    `,
    [input.clientProfileId, input.digestRunId, dedupeKey, input.count]
  );

  if (claim.rowCount !== 1) {
    return { delivered: false, reason: "already_sent" };
  }

  const payload = buildNewLeadsPushPayload({ count: input.count, url: input.url });
  const result = await sendWebPushToProfile({ clientProfileId: input.clientProfileId, payload });
  return { delivered: true, result };
}
