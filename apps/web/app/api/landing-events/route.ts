import { createHmac, randomBytes } from "node:crypto";

import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";
import {
  isLandingAnalyticsContext,
  isLandingAnalyticsEventName,
  type LandingAnalyticsContext,
  type LandingAnalyticsEventName,
} from "@/lib/landing-analytics-contract";
import { tryRecordProductEvent } from "@/lib/telemetry";

const MAX_BODY_BYTES = 1_024;
const CLIENT_EVENT_RATE_LIMIT = new SlidingWindowRateLimiter({
  maxRequests: 30,
  windowMs: 60_000,
});
const GLOBAL_EVENT_RATE_LIMIT = new SlidingWindowRateLimiter({
  maxRequests: 1_000,
  windowMs: 60_000,
});
const RATE_LIMIT_SECRET =
  process.env.LANDING_ANALYTICS_RATE_LIMIT_SALT?.trim() || randomBytes(32);

type LandingEventPayload = {
  name: LandingAnalyticsEventName;
  context?: LandingAnalyticsContext;
  timestamp?: number;
};

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function isSameOriginRequest(request: Request): boolean {
  const internalUrl = new URL(request.url);
  const host =
    request.headers.get("host")?.trim().toLowerCase() ||
    internalUrl.host.toLowerCase();
  const origin = request.headers.get("origin");
  if (origin) {
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim()
      .toLowerCase();
    const protocol =
      forwardedProtocol === "http" || forwardedProtocol === "https"
        ? forwardedProtocol
        : internalUrl.protocol.slice(0, -1);
    try {
      return new URL(origin).origin.toLowerCase() === `${protocol}://${host}`;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "none";
}

function normalizeClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const direct = request.headers.get("x-real-ip")?.trim();
  const candidate = (forwarded || direct || "unknown").toLowerCase();
  const normalized = candidate
    .replace(/^\[([0-9a-f:]+)\](?::\d+)?$/i, "$1")
    .replace(/^::ffff:/, "");
  return normalized.slice(0, 128) || "unknown";
}

function getEphemeralClientKey(request: Request): string {
  const dayBucket = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", RATE_LIMIT_SECRET)
    .update(`${dayBucket}\0${normalizeClientIp(request)}`)
    .digest("hex");
}

function parseLandingEvent(value: unknown): LandingEventPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !["name", "context", "timestamp"].includes(key))) return null;
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

  return {
    name: record.name,
    ...(record.context ? { context: record.context } : {}),
    ...(record.timestamp ? { timestamp: record.timestamp } : {}),
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonError(403, "Forbidden");

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonError(415, "Unsupported media type");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonError(413, "Payload too large");
  }

  const clientKey = getEphemeralClientKey(request);
  if (!(await CLIENT_EVENT_RATE_LIMIT.isAllowed(`landing-events:client:${clientKey}`))) {
    return jsonError(429, "Too many requests");
  }
  if (!(await GLOBAL_EVENT_RATE_LIMIT.isAllowed("landing-events:global"))) {
    return jsonError(429, "Too many requests");
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

  await tryRecordProductEvent({
    eventName: payload.name,
    metadata: payload.context ? { context: payload.context } : {},
    occurredAt: payload.timestamp
      ? new Date(payload.timestamp).toISOString()
      : undefined,
  });

  return new Response(null, { status: 204 });
}
