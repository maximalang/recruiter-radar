import { createHash } from "node:crypto";
import type { Pool } from "pg";

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
const STALE_JOB_SECONDS = 120;
const MAX_ATTEMPTS = 5;

export type NotificationErrorClassification = ReturnType<typeof classifyNotificationProviderError>;

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

type ClaimedJob = {
  id: string;
  attemptCount: number;
};

type RetryBatchRow = {
  runId: string;
  clientProfileId: string;
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
    const first = titles.find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    );
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
  const lines = ["<b>Recruiter Radar — компании для контакта сегодня</b>", ""];
  leads.slice(0, MAX_DIGEST_ITEMS).forEach((lead, index) => {
    const score = lead.score == null ? "—" : lead.score.toFixed(1);
    lines.push(`<b>${index + 1}. ${escapeHtml(lead.orgName)}</b>`);
    lines.push(
      `Сигнал: ${escapeHtml(lead.confidenceGate ?? "B")} · score ${score} · вакансий ${lead.vacanciesCount}`,
    );
    const why = leadWhyNow(lead);
    if (why) lines.push(escapeHtml(why).slice(0, 420));
    if (baseUrl) lines.push(`<a href="${baseUrl}/leads/${lead.id}">Открыть карточку</a>`);
    lines.push("");
  });
  if (leads.length > MAX_DIGEST_ITEMS && baseUrl) {
    lines.push(
      `Ещё ${leads.length - MAX_DIGEST_ITEMS}: <a href="${baseUrl}/leads">открыть весь список</a>`,
    );
  }
  return lines.join("\n").slice(0, 4090);
}

function renderPlainDigest(leads: DigestLeadRow[]): string {
  const baseUrl = resolveAppBaseUrl();
  const lines = ["Recruiter Radar — компании для контакта сегодня", ""];
  leads.slice(0, MAX_DIGEST_ITEMS).forEach((lead, index) => {
    const score = lead.score == null ? "—" : lead.score.toFixed(1);
    lines.push(`${index + 1}. ${lead.orgName}`);
    lines.push(
      `Сигнал ${lead.confidenceGate ?? "B"} · score ${score} · вакансий ${lead.vacanciesCount}`,
    );
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
  const value = Number.parseInt(
    createHash("sha256").update(jobId).digest("hex").slice(0, 8),
    16,
  );
  return value % 2_147_483_647;
}

function buildIdempotencyKey(runId: string, route: RouteRow): string {
  return createHash("sha256")
    .update(
      ["digest", runId, route.routeId, route.endpointId, String(route.routeVersion)].join(":"),
    )
    .digest("hex");
}

export function notificationRetryDelaySeconds(
  attemptNo: number,
  classified: Pick<NotificationErrorClassification, "kind" | "retryAfterSeconds">,
): number | null {
  if (classified.kind === "permanent" || classified.kind === "auth" || attemptNo >= MAX_ATTEMPTS) {
    return null;
  }
  if (classified.kind === "rate_limited") {
    return Math.min(Math.max(classified.retryAfterSeconds ?? 60, 15), 10_800);
  }
  const schedule = [30, 300, 1_800, 10_800];
  return schedule[Math.min(Math.max(attemptNo - 1, 0), schedule.length - 1)];
}

async function claimDeliveryJob(
  pool: Pool,
  input: {
    runId: string;
    clientProfileId: string | number;
    route: RouteRow;
  },
): Promise<ClaimedJob | null> {
  const result = await pool.query<ClaimedJob>(
    `
      INSERT INTO notification_delivery_jobs (
        client_profile_id, route_id, endpoint_id, provider_account_id,
        digest_run_id, event_kind, idempotency_key, status
      ) VALUES ($1, $2, $3, $4, $5, 'daily_digest', $6, 'sending')
      ON CONFLICT (idempotency_key)
      DO UPDATE SET status = 'sending', updated_at = NOW()
      WHERE (
          notification_delivery_jobs.status IN ('failed', 'queued')
          AND notification_delivery_jobs.not_before <= NOW()
        ) OR (
          notification_delivery_jobs.status = 'sending'
          AND notification_delivery_jobs.updated_at < NOW() - ($7::int * INTERVAL '1 second')
        )
      RETURNING id::text AS id, attempt_count AS "attemptCount"
    `,
    [
      input.clientProfileId,
      input.route.routeId,
      input.route.endpointId,
      input.route.accountId,
      input.runId,
      buildIdempotencyKey(input.runId, input.route),
      STALE_JOB_SECONDS,
    ],
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function recordDeliverySuccess(
  pool: Pool,
  input: {
    job: ClaimedJob;
    endpointId: string;
    providerMessageId?: string;
    responseSnapshot: Record<string, unknown>;
    startedAt: Date;
  },
): Promise<void> {
  const client = await pool.connect();
  const attemptNo = input.job.attemptCount + 1;
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE notification_delivery_jobs
        SET status = 'sent', attempt_count = $2, sent_at = NOW(), failed_at = NULL,
            not_before = NOW(), last_error_code = NULL, last_error_message = NULL,
            updated_at = NOW()
        WHERE id = $1 AND status = 'sending'
      `,
      [input.job.id, attemptNo],
    );
    await client.query(
      `
        INSERT INTO notification_delivery_attempts (
          job_id, attempt_no, status, provider_message_id, response_snapshot,
          started_at, finished_at
        ) VALUES ($1, $2, 'sent', $3, $4::jsonb, $5, NOW())
      `,
      [
        input.job.id,
        attemptNo,
        input.providerMessageId ?? null,
        JSON.stringify(input.responseSnapshot),
        input.startedAt.toISOString(),
      ],
    );
    await client.query(
      `
        UPDATE notification_endpoints
        SET last_delivery_at = NOW(), last_error_at = NULL, last_error_code = NULL,
            status = 'active', updated_at = NOW()
        WHERE id = $1
      `,
      [input.endpointId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordDeliveryFailure(
  pool: Pool,
  input: {
    job: ClaimedJob;
    endpointId: string;
    startedAt: Date;
    classified: NotificationErrorClassification;
    safeMessage: string;
  },
): Promise<void> {
  const client = await pool.connect();
  const attemptNo = input.job.attemptCount + 1;
  const attemptStatus =
    input.classified.kind === "rate_limited"
      ? "rate_limited"
      : input.classified.kind === "auth"
        ? "auth_error"
        : input.classified.kind === "permanent"
          ? "permanent_error"
          : "retryable_error";
  const retryDelaySeconds = notificationRetryDelaySeconds(attemptNo, input.classified);
  const jobStatus = retryDelaySeconds == null ? "dead_letter" : "failed";

  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE notification_delivery_jobs
        SET status = $2, attempt_count = $3, failed_at = NOW(),
            not_before = CASE
              WHEN $6::int IS NULL THEN not_before
              ELSE NOW() + ($6::int * INTERVAL '1 second')
            END,
            last_error_code = $4, last_error_message = $5, updated_at = NOW()
        WHERE id = $1 AND status = 'sending'
      `,
      [
        input.job.id,
        jobStatus,
        attemptNo,
        input.classified.code ?? input.classified.kind,
        input.safeMessage,
        retryDelaySeconds,
      ],
    );
    await client.query(
      `
        INSERT INTO notification_delivery_attempts (
          job_id, attempt_no, status, http_status, provider_error_code,
          provider_error_message, started_at, finished_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `,
      [
        input.job.id,
        attemptNo,
        attemptStatus,
        input.classified.status ?? null,
        input.classified.code ?? input.classified.kind,
        input.safeMessage,
        input.startedAt.toISOString(),
      ],
    );
    await client.query(
      `
        UPDATE notification_endpoints
        SET last_error_at = NOW(), last_error_code = $2, updated_at = NOW(),
            status = CASE WHEN $3 IN ('auth', 'permanent') THEN 'error' ELSE status END
        WHERE id = $1
      `,
      [
        input.endpointId,
        input.classified.code ?? input.classified.kind,
        input.classified.kind,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  if (!pool) {
    return { sent: 0, failed: 0, skipped: 0, errors: ["DATABASE_URL is not set."] };
  }

  const providers = input.providers?.length
    ? input.providers
    : (["telegram", "vk", "webhook"] as NotificationProvider[]);
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

    const job = await claimDeliveryJob(pool, {
      runId: input.runId,
      clientProfileId: input.clientProfileId,
      route,
    });
    if (!job) {
      result.skipped += 1;
      continue;
    }

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
        const baseUrl = resolveAppBaseUrl();
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
              url: baseUrl ? `${baseUrl}/leads/${lead.id}` : null,
            })),
          },
        });
        responseSnapshot = { status: webhook.status, response: webhook.responseText };
      }

      await recordDeliverySuccess(pool, {
        job,
        endpointId: route.endpointId,
        providerMessageId,
        responseSnapshot,
        startedAt,
      });
      result.sent += 1;
    } catch (error) {
      const classified = classifyNotificationProviderError(error);
      const safeMessage = redactProviderSecret(classified.message).slice(0, 1000);
      try {
        await recordDeliveryFailure(pool, {
          job,
          endpointId: route.endpointId,
          startedAt,
          classified,
          safeMessage,
        });
      } catch (recordError) {
        result.errors.push(
          `${route.provider}:${route.destinationLabel ?? route.destinationId}: failed to persist delivery error`,
        );
        console.error("Failed to persist notification delivery failure", recordError);
      }
      result.failed += 1;
      result.errors.push(
        `${route.provider}:${route.destinationLabel ?? route.destinationId}: ${safeMessage}`,
      );
    }
  }

  return result;
}

export type NotificationRetryResult = NotificationDispatchResult & {
  batches: number;
};

export async function retryDueNotificationDeliveries(input?: {
  limit?: number;
}): Promise<NotificationRetryResult> {
  const pool = getPool();
  if (!pool) {
    return {
      batches: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: ["DATABASE_URL is not set."],
    };
  }
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
  const due = await pool.query<RetryBatchRow>(
    `
      SELECT
        digest_run_id::text AS "runId",
        client_profile_id::text AS "clientProfileId"
      FROM notification_delivery_jobs
      WHERE digest_run_id IS NOT NULL
        AND (
          (status = 'failed' AND not_before <= NOW())
          OR (status = 'sending' AND updated_at < NOW() - ($2::int * INTERVAL '1 second'))
        )
      GROUP BY digest_run_id, client_profile_id
      ORDER BY MIN(not_before) ASC
      LIMIT $1
    `,
    [limit, STALE_JOB_SECONDS],
  );

  const result: NotificationRetryResult = {
    batches: due.rowCount,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };
  for (const batch of due.rows) {
    try {
      const dispatched = await dispatchDigestNotifications({
        runId: batch.runId,
        clientProfileId: batch.clientProfileId,
      });
      result.sent += dispatched.sent;
      result.failed += dispatched.failed;
      result.skipped += dispatched.skipped;
      result.errors.push(...dispatched.errors);
    } catch (error) {
      result.failed += 1;
      result.errors.push(
        redactProviderSecret(
          error instanceof Error ? error.message : "Notification retry batch failed.",
        ).slice(0, 1000),
      );
    }
  }
  return result;
}
