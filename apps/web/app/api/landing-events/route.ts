import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import {
  checkLandingEventRateLimits,
  isAllowedLandingOrigin,
  resolveLandingAnalyticsRateLimitSecret,
} from "@/lib/landing-events-security";
import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
  isLandingAnalyticsContext,
  isLandingAnalyticsEventName,
  type LandingAnalyticsContext,
  type LandingAnalyticsEventName,
} from "@/lib/landing-analytics-contract";
import { tryRecordProductEvent } from "@/lib/telemetry";

const MAX_BODY_BYTES = 1_024;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
const RATE_LIMIT_SECRET = resolveLandingAnalyticsRateLimitSecret();

type LandingEventPayload = {
  name: LandingAnalyticsEventName;
  context?: LandingAnalyticsContext;
  timestamp?: number;
  dryRun?: true;
};

function jsonError(
  status: number,
  error: string,
  headers?: HeadersInit,
): Response {
  return Response.json({ error }, { status, headers });
}

function normalizeClientIp(request: Request): string | null {
  const candidate = request.headers.get("x-real-ip")?.trim().toLowerCase() ?? "";
  const normalized = candidate
    .replace(/^\[([0-9a-f:]+)\](?::\d+)?$/i, "$1")
    .replace(/^::ffff:/, "");
  if (isIP(normalized)) return normalized;
  if (process.env.NODE_ENV === "production") return null;

  try {
    const hostname = new URL(request.url).hostname
      .replace(/^\[([0-9a-f:]+)\]$/i, "$1")
      .toLowerCase();
    if (hostname === "localhost") return "127.0.0.1";
    if (hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname)) {
      return hostname;
    }
  } catch {
    return null;
  }
  return null;
}

function getEphemeralClientKey(normalizedIp: string): string {
  const dayBucket = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", RATE_LIMIT_SECRET)
    .update(`${dayBucket}\0${normalizedIp}`)
    .digest("hex");
}

function parseLandingEvent(value: unknown): LandingEventPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some(
      (key) => !["name", "context", "timestamp", "dryRun"].includes(key),
    )
  ) return null;
  if (!isLandingAnalyticsEventName(record.name)) {
    return null;
  }
  if (
    record.context !== undefined &&
    !isLandingAnalyticsContext(record.context)
  ) {
    return null;
  }
  if (record.timestamp !== undefined) {
    if (
      typeof record.timestamp !== "number" ||
      !Number.isFinite(record.timestamp) ||
      !Number.isInteger(record.timestamp)
    ) {
      return null;
    }
    const now = Date.now();
    if (record.timestamp < now - 86_400_000 || record.timestamp > now + 300_000) {
      return null;
    }
  }
  if (record.dryRun !== undefined && record.dryRun !== true) return null;
  if (
    record.dryRun === true &&
    (
      record.name !== LANDING_ANALYTICS_EVENT.landingViewed ||
      record.context !== LANDING_ANALYTICS_CONTEXT.landing
    )
  ) {
    return null;
  }

  return {
    name: record.name,
    ...(record.context ? { context: record.context } : {}),
    ...(record.timestamp ? { timestamp: record.timestamp } : {}),
    ...(record.dryRun === true ? { dryRun: true as const } : {}),
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!isAllowedLandingOrigin(request.headers.get("origin"))) {
    return jsonError(403, "Forbidden");
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonError(415, "Unsupported media type");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonError(413, "Payload too large");
  }

  const normalizedIp = normalizeClientIp(request);
  if (!normalizedIp) return jsonError(403, "Forbidden");
  const clientKey = getEphemeralClientKey(normalizedIp);
  if (await checkLandingEventRateLimits(clientKey)) {
    return jsonError(429, "Too many requests", {
      "retry-after": String(RATE_LIMIT_RETRY_AFTER_SECONDS),
    });
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return jsonError(413, "Payload too large");
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(body);
  } catch {
    return jsonError(400, "Invalid request");
  }

  const payload = parseLandingEvent(rawPayload);
  if (!payload) return jsonError(400, "Invalid request");

  if (!payload.dryRun) {
    await tryRecordProductEvent({
      eventName: payload.name,
      metadata: payload.context ? { context: payload.context } : {},
      occurredAt: payload.timestamp
        ? new Date(payload.timestamp).toISOString()
        : undefined,
    });
  }

  return new Response(null, { status: 204 });
}
