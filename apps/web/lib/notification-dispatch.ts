import { createHash, randomUUID } from "node:crypto";

import { getPool } from "./db-pool";
import {
  classifyNotificationProviderError,
  sendSignedWebhook,
  sendTelegramNotification,
  sendVkNotification,
} from "./notification-providers";
import { decryptNotificationSecret, redactProviderSecret } from "./notification-secrets";
import type { NotificationProvider } from "./notifications";

const MAX_DIGEST_ITEMS = 10;

type RouteRow = {
  accountId: string;
  ownerId: string;
  provider: NotificationProvider;
  secretCiphertext: string;
  endpointId: string;
  destinationId: string;
  destinationLabel: string | null;
  routeId: string;
  minScore: number | null;
  confidencePolicy: "A_ONLY" | "A_OR_B";
  routeVersion: number;
};

type DigestLeadRow = {
  id: string;
  orgId: string;
  orgName: string;
  score: number | null;
  vacanciesCount: number;
  confidenceGate: string | null;
  latestPublishedAt: string | null;
  payload: Record<string, unknown> | null;
};

type TelegramCredentials = { botToken: string };
type VkCredentials = { token: string };
type WebhookCredentials = { url: string; signingSecret: string };

function accountAad(accountId: string, ownerId: string): string {
  return `notification-account:${accountId}:owner:${ownerId}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.AUTH_SITE_URL?.trim() ||
    process.env.RR_APP_BASE_URL?.trim() ||
    ""
  ).replace(/\/+$/, "");
}

function leadWhyNow(lead: DigestLeadRow): string | null {
  const payload = lead.payload ?? {};
  for (const key of ["why_now", "whyNow", "summary"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const titles = payload.evidence_titles;
  if (Array.isArray(titles)) {
    const first = titles.find((value): value is string => typeof value === "string" && value.trim() !== "");
    if (first) return first.trim();
  }
  return null;
}

function filterLeadsForRoute(route: RouteRow, leads: DigestLeadRow[]): DigestLeadRow[] {
  return leads.filter((lead) => {
    if (route.minScore != null && (lead.score ?? 0) < route.minScore) return false;
    const gate = lead.confidenceGate?.toUpperCase() ?? "B";
    if (route.confidencePolicy === "A_ONLY" && gate !== "A") return false;
    return gate === "A" || gate === "B";
  });
}

function renderTelegramDigest(leads: DigestLeadRow[]): string {
  const baseUrl = resolveAppBaseUrl();
  const lines = [
    "<b>Recruiter Radar — компании для контакта сегодня</b>",
    "",
  ];
  leads.slice(0, MAX_DIGEST_ITEMS).forEach((lead, index) => {
    const score = lead.score == null ? "—" : lead.score.toFixed(1);
    lines.push(`<b>${index + 1}. ${escapeHtml(lead.orgName)}</b>`);
    lines.push(`Сигнал: ${escapeHtml(lead.confidenceGate ?? "B")} · score ${score} · вакансий ${lead.vacanciesCount}`);
    const why = leadWhyNow(lead);
    if (why) lines.push(escapeHtml(why).slice(0, 420));
    if (baseUrl) lines.push(`<a href="${baseUrl}/leads/${lead.id}">Открыть карточку</a>`);
    lines.push("");
  });
  if (leads.length > MAX_DIGEST_ITEMS && baseUrl) {
    lines.push(`Ещё ${leads.length - MAX_DIGEST_ITEMS}: <a href="${baseUrl}/leads">открыть весь список</a>`);
  }
  return lines.join("\n").slice(0, 4090);
}

function renderPlainDigest(leads: DigestLeadRow[]): string {
  const baseUrl = resolveAppBaseUrl();
  const lines = ["Recruiter Radar — компании для контакта сегодня", ""];
  leads.slice(0, MAX_DIGEST_ITEMS).forEach((lead, index) => {
    const score = lead.score == null ? "—" : lead.score.toFixed(1);
    lines.push(`${index + 1}. ${lead.orgName}`);
    lines.push(`Сигнал ${lead.confidenceGate ?? "B"} · score ${score} · вакансий ${lead.vacanciesCount}`);
    const why = leadWhyNow(lead);
    if (why) lines.push(why.slice(0, 420));
    if (baseUrl) lines.push(`${baseUrl}/leads/${lead.id}`);
    lines.push("");
  });
  if (leads.length > MAX_DIGEST_ITEMS && baseUrl) {
    lines.push(`Ещё ${leads.length - MAX_DIGEST_ITEMS}: ${baseUrl}/leads`);
  }
  return lines.join("\n").slice(0, 4000);
}

function deterministicVkRandomId(jobId: string): number {
  const value = Number.parseInt(createHash("sha256").update(jobId).digest("hex").slice(0, 8), 16);
  return value % 2_147_483_647;
}

function idempotencyKey(input: {
  runId: string;
  route: RouteRow;
}): string {
  return createHash("sha256")
    .update([
      "digest",
      input.runId,
      input.route.routeId,
      input.route.endpointId,
      String(input.route.routeVersion),
    ].join(":"))
    .digest("hex");
}

export async function hasActiveNotificationEndpoint(input: {
  clientProfileId: string | number;
  provider: NotificationProvider;
}): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const result = await pool.query(
    `
      SELECT 1
      FROM notification_provider_accounts a
      INNER JOIN notification_endpoints e ON e.provider_account_id = a.id
      INNER JOIN notification_routes r ON r.endpoint_id = e.id
      WHERE a.client_profile_id = $1
        AND a.provider = $2
        AND a.status IN ('active', 'degraded')
        AND e.status = 'active'
        AND e.destination_id IS NOT NULL
        AND r.status = 'active'
        AND r.event_kind = 'daily_digest'
      LIMIT 1
    `,
    [input.clientProfileId, input.provider],
  );
  return result.rowCount === 1;
}

export type NotificationDispatchResult = {
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
};

export async function dispatchDigestNotifications(input: {
  runId: string;
  clientProfileId: string | number;
  providers?: NotificationProvider[];
}): Promise<NotificationDispatchResult> {
  const pool = getPool();
  if (!pool) return { sent: 0, failed: 0, skipped: 0, errors: ["DATABASE_URL is not set."] };

  const providers = input.providers?.length ? input.providers : ["telegram", "vk", "webhook"];
  const routes = await pool.query<RouteRow>(
    `
      SELECT
        a.id::text AS "accountId",
        a.owner_id::text AS "ownerId",
        a.provider,
        a.secret_ciphertext AS "secretCiphertext",
        e.id::text AS "endpointId",
        e.destination_id AS "destinationId",
        e.destination_label AS "destinationLabel",
        r.id::text AS "routeId",
        r.min_score::float8 AS "minScore",
        r.confidence_policy AS "confidencePolicy",
        r.route_version AS "routeVersion"
      FROM notification_provider_accounts a
      INNER JOIN notification_endpoints e ON e.provider_account_id = a.id
      INNER JOIN notification_routes r ON r.endpoint_id = e.id
      WHERE a.client_profile_id = $1
        AND a.provider = ANY($2::text[])
        AND a.status IN ('active', 'degraded')
        AND e.status = 'active'
        AND e.destination_id IS NOT NULL
        AND r.status = 'active'
        AND r.event_kind = 'daily_digest'
      ORDER BY a.created_at ASC, e.created_at ASC
    `,
    [input.clientProfileId, providers],
  );
  if (routes.rowCount === 0) return { sent: 0, failed: 0, skipped: 0, errors: [] };

  const candidateResult = await pool.query<DigestLeadRow>(
    `
      SELECT
        dc.id::text AS id,
        dc.org_id::text AS "orgId",
        dc.source_display_name AS "orgName",
        dc.total_score::float8 AS score,
        COALESCE(dc.vacancies_count, 0)::int AS "vacanciesCount",
        COALESCE(dc.payload->>'confidence_gate', 'B') AS "confidenceGate",
        dc.latest_published_at::text AS "latestPublishedAt",
        dc.payload
      FROM digest_candidates dc
      WHERE dc.digest_run_id = $1
        AND dc.client_profile_id = $2
        AND (dc.payload->>'confidence_gate' NOT IN ('C', 'D') OR dc.payload->>'confidence_gate' IS NULL)
      ORDER BY dc.total_score DESC NULLS LAST, dc.id ASC
    `,
    [input.runId, input.clientProfileId],
  );

  const result: NotificationDispatchResult = { sent: 0, failed: 0, skipped: 0, errors: [] };
  for (const route of routes.rows) {
    const leads = filterLeadsForRoute(route, candidateResult.rows);
    if (leads.length === 0) {
      result.skipped += 1;
      continue;
    }

    const dedupeKey = idempotencyKey({ runId: input.runId, route });
    const jobResult = await pool.query<{
      id: string;
      status: string;
      attemptCount: number;
    }>(
      `
        INSERT INTO notification_delivery_jobs (
          client_profile_id, route_id, endpoint_id, provider_account_id,
          digest_run_id, event_kind, idempotency_key, status
        ) VALUES ($1, $2, $3, $4, $5, 'daily_digest', $6, 'sending')
        ON CONFLICT (idempotency_key)
        DO UPDATE SET
          status = CASE
            WHEN notification_delivery_jobs.status IN ('failed', 'queued') THEN 'sending'
            ELSE notification_delivery_jobs.status
          END,
          updated_at = NOW()
        RETURNING id::text AS id, status, attempt_count AS "attemptCount"
      `,
      [
        input.clientProfileId,
        route.routeId,
        route.endpointId,
        route.accountId,
        input.runId,
        dedupeKey,
      ],
    );
    const job = jobResult.rows[0];
    if (job.status === "sent" || job.status === "dead_letter" || job.status === "cancelled") {
      result.skipped += 1;
      continue;
    }

    const attemptNo = job.attemptCount + 1;
    const startedAt = new Date();
    try {
      let providerMessageId: string | undefined;
      let responseSnapshot: Record<string, unknown> = {};
      if (route.provider === "telegram") {
        const credentials = decryptNotificationSecret<TelegramCredentials>(
          route.secretCiphertext,
          accountAad(route.accountId, route.ownerId),
        );
        providerMessageId = (
          await sendTelegramNotification({
            botToken: credentials.botToken,
            chatId: route.destinationId,
            text: renderTelegramDigest(leads),
            parseMode: "HTML",
          })
        ).providerMessageId;
      } else if (route.provider === "vk") {
        const credentials = decryptNotificationSecret<VkCredentials>(
          route.secretCiphertext,
          accountAad(route.accountId, route.ownerId),
        );
        providerMessageId = (
          await sendVkNotification({
            token: credentials.token,
            peerId: route.destinationId,
            text: renderPlainDigest(leads),
            randomId: deterministicVkRandomId(job.id),
          })
        ).providerMessageId;
      } else {
        const credentials = decryptNotificationSecret<WebhookCredentials>(
          route.secretCiphertext,
          accountAad(route.accountId, route.ownerId),
        );
        const webhook = await sendSignedWebhook({
          url: credentials.url,
          secret: credentials.signingSecret,
          event: "digest.ready",
          eventId: `job_${job.id}`,
          payload: {
            client_profile_id: String(input.clientProfileId),
            digest_run_id: input.runId,
            leads: leads.map((lead) => ({
              id: lead.id,
              org_id: lead.orgId,
              org_name: lead.orgName,
              score: lead.score,
              confidence: lead.confidenceGate,
              vacancies_count: lead.vacanciesCount,
              why_now: leadWhyNow(lead),
              latest_published_at: lead.latestPublishedAt,
              url: resolveAppBaseUrl() ? `${resolveAppBaseUrl()}/leads/${lead.id}` : null,
            })),
          },
        });
        responseSnapshot = { status: webhook.status, response: webhook.responseText };
      }

      await pool.query("BEGIN");
      try {
        await pool.query(
          `
            UPDATE notification_delivery_jobs
            SET status = 'sent', attempt_count = $2, sent_at = NOW(), failed_at = NULL,
                last_error_code = NULL, last_error_message = NULL, updated_at = NOW()
            WHERE id = $1
          `,
          [job.id, attemptNo],
        );
        await pool.query(
          `
            INSERT INTO notification_delivery_attempts (
              job_id, attempt_no, status, provider_message_id, response_snapshot,
              started_at, finished_at
            ) VALUES ($1, $2, 'sent', $3, $4::jsonb, $5, NOW())
          `,
          [job.id, attemptNo, providerMessageId ?? null, JSON.stringify(responseSnapshot), startedAt.toISOString()],
        );
        await pool.query(
          `
            UPDATE notification_endpoints
            SET last_delivery_at = NOW(), last_error_at = NULL, last_error_code = NULL, updated_at = NOW()
            WHERE id = $1
          `,
          [route.endpointId],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
      result.sent += 1;
    } catch (error) {
      const classified = classifyNotificationProviderError(error);
      const attemptStatus =
        classified.kind === "rate_limited"
          ? "rate_limited"
          : classified.kind === "auth"
            ? "auth_error"
            : classified.kind === "permanent"
              ? "permanent_error"
              : "retryable_error";
      const nextStatus = attemptNo >= 5 || classified.kind === "permanent" || classified.kind === "auth"
        ? "dead_letter"
        : "failed";
      const safeMessage = redactProviderSecret(classified.message).slice(0, 1000);

      await pool.query("BEGIN");
      try {
        await pool.query(
          `
            UPDATE notification_delivery_jobs
            SET status = $2, attempt_count = $3, failed_at = NOW(),
                last_error_code = $4, last_error_message = $5, updated_at = NOW()
            WHERE id = $1
          `,
          [job.id, nextStatus, attemptNo, classified.code ?? classified.kind, safeMessage],
        );
        await pool.query(
          `
            INSERT INTO notification_delivery_attempts (
              job_id, attempt_no, status, http_status, provider_error_code,
              provider_error_message, started_at, finished_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          `,
          [
            job.id,
            attemptNo,
            attemptStatus,
            classified.status ?? null,
            classified.code ?? classified.kind,
            safeMessage,
            startedAt.toISOString(),
          ],
        );
        await pool.query(
          `
            UPDATE notification_endpoints
            SET last_error_at = NOW(), last_error_code = $2, updated_at = NOW(),
                status = CASE WHEN $3 IN ('auth', 'permanent') THEN 'error' ELSE status END
            WHERE id = $1
          `,
          [route.endpointId, classified.code ?? classified.kind, classified.kind],
        );
        await pool.query("COMMIT");
      } catch {
        await pool.query("ROLLBACK");
      }
      result.failed += 1;
      result.errors.push(`${route.provider}:${route.destinationLabel ?? route.destinationId}: ${safeMessage}`);
    }
  }

  return result;
}

export async function dispatchTestNotificationJob(input: {
  clientProfileId: string | number;
  connectionId: string;
}): Promise<string> {
  return `test_${input.clientProfileId}_${input.connectionId}_${randomUUID()}`;
}
