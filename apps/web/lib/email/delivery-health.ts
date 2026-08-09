import { createHash } from "node:crypto";

import { getPool } from "../db-pool";
import { logError } from "../runtime";

export type AuditedEmailProvider = "postbox" | "smtp";

export type EmailConfigurationIdentity = {
  provider: AuditedEmailProvider;
  fingerprint: string;
};

const EMAIL_HEALTH_MAX_AGE_MS = 30 * 86_400_000;

export function getConfiguredEmailIdentity(): EmailConfigurationIdentity | null {
  const postbox = requiredValues([
    "POSTBOX_ACCESS_KEY_ID",
    "POSTBOX_SECRET_ACCESS_KEY",
    "POSTBOX_FROM",
  ]);
  const postboxEndpoint = (process.env.POSTBOX_ENDPOINT?.trim()
    || "https://postbox.cloud.yandex.net").replace(/\/+$/, "");
  const postboxRegion = process.env.POSTBOX_REGION?.trim() || "ru-central1";
  const postboxTimeout = Number(process.env.POSTBOX_TIMEOUT_MS?.trim() || "10000");
  if (
    postbox
    && postboxEndpoint.startsWith("https://")
    && postboxRegion
    && Number.isInteger(postboxTimeout)
    && postboxTimeout >= 1000
    && postboxTimeout <= 60000
  ) {
    return identity("postbox", [
      ...postbox,
      postboxEndpoint,
      postboxRegion,
      process.env.POSTBOX_REPLY_TO?.trim() || "",
      String(postboxTimeout),
    ]);
  }

  const smtp = requiredValues([
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
  ]);
  const smtpPort = Number(smtp?.[1]);
  return smtp && Number.isInteger(smtpPort) && smtpPort > 0
    ? identity("smtp", [
        ...smtp,
        process.env.SMTP_REPLY_TO?.trim() || "",
      ])
    : null;
}

export async function recordSuccessfulEmailDelivery(
  provider: AuditedEmailProvider,
): Promise<void> {
  const configured = getConfiguredEmailIdentity();
  if (!configured || configured.provider !== provider) return;
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO email_delivery_health_events (
         provider,
         configuration_fingerprint
       )
       SELECT $1, $2
       WHERE NOT EXISTS (
         SELECT 1
         FROM email_delivery_health_events
         WHERE provider = $1
           AND configuration_fingerprint = $2
           AND delivered_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
       )`,
      [configured.provider, configured.fingerprint],
    );
  } catch (error) {
    logError("email.delivery_health_record_failed", error);
  }
}

export function isFreshEmailDelivery(deliveredAt: string, now = new Date()): boolean {
  const deliveredAtMs = new Date(deliveredAt).getTime();
  return Number.isFinite(deliveredAtMs)
    && deliveredAtMs <= now.getTime()
    && now.getTime() - deliveredAtMs <= EMAIL_HEALTH_MAX_AGE_MS;
}

function requiredValues(names: readonly string[]): string[] | null {
  const values = names.map((name) => process.env[name]?.trim() || "");
  return values.every(Boolean) ? values : null;
}

function identity(
  provider: AuditedEmailProvider,
  values: readonly string[],
): EmailConfigurationIdentity {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([provider, ...values]))
    .digest("hex");
  return { provider, fingerprint };
}
