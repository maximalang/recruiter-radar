import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import {
  checkLandingEventRateLimits,
  isAllowedLandingOrigin,
  resolveLandingAnalyticsRateLimitSecret,
} from "@/lib/landing-events-security";
import {
  isInternalMarker,
  isRefererClass,
  isUaClass,
  isUtmSourceClass,
} from "@/lib/telemetry-dimensions";
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
const MAX_ATTACHMENT_LENGTH = 64;
const ATTACHMENT_PATTERN = /^[0-9a-z_.:-]{1,64}$/;

type LandingEventPayload = {
  name: LandingAnalyticsEventName;
  context?: LandingAnalyticsContext;
  timestamp?: number;
  dryRun?: true;
  refererClass?: string;
  utmSourceClass?: string;
  uaClass?: string;
  internalMarker?: string;
  attachment?: string;
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

/**
 * Server-side pseudonymous visit id for dedupe and outcome linkage. Derived
 * from the same trusted IP normalizer and secret domain as the rate-limit
 * key, with a distinct HMAC prefix. 32 hex chars; raw IP never leaves the
 * process. Rotates daily like the rate-limit bucket, so retention of the
 * linkage key is bounded without extra deletion logic.
 */
function getServerVisitId(normalizedIp: string): string {
  const dayBucket = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", RATE_LIMIT_SECRET)
    .update(`landing-visit\0${dayBucket}\0${normalizedIp}`)
    .digest("hex")
    .slice(0, 32);
}

function parseLandingEvent(value: unknown): LandingEventPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some(
      (key) => ![
        "name",
        "context",
        "timestamp",
        "dryRun",
        "referer_class",
        "utm_source_class",
        "ua_class",
        "internal_marker",
        "attachment",
      ].includes(key),
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
  if (
    record.referer_class !== undefined &&
    !isRefererClass(record.referer_class)
  ) return null;
  if (
    record.utm_source_class !== undefined &&
    !isUtmSourceClass(record.utm_source_class)
  ) return null;
  if (record.ua_class !== undefined && !isUaClass(record.ua_class)) {
    return null;
  }
  if (
    record.internal_marker !== undefined &&
    !isInternalMarker(record.internal_marker)
  ) return null;
  if (
    record.attachment !== undefined &&
    (
      typeof record.attachment !== "string" ||
      record.attachment.length > MAX_ATTACHMENT_LENGTH ||
      !ATTACHMENT_PATTERN.test(record.attachment)
    )
  ) return null;

  return {
    name: record.name,
    ...(record.context ? { context: record.context } : {}),
    ...(record.timestamp ? { timestamp: record.timestamp } : {}),
    ...(record.dryRun === true ? { dryRun: true as const } : {}),
    ...(record.referer_class !== undefined
      ? { refererClass: record.referer_class }
      : {}),
    ...(record.utm_source_class !== undefined
      ? { utmSourceClass: record.utm_source_class }
      : {}),
    ...(record.ua_class !== undefined ? { uaClass: record.ua_class } : {}),
    ...(record.internal_marker !== undefined
      ? { internalMarker: record.internal_marker }
      : {}),
    ...(record.attachment !== undefined
      ? { attachment: record.attachment }
      : {}),
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

  if (hasDeclaredOversizedBody(request, MAX_BODY_BYTES)) {
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

  const body = await readBoundedBody(request, MAX_BODY_BYTES);
  if (body === null) return jsonError(413, "Payload too large");

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(body);
  } catch {
    return jsonError(400, "Invalid request");
  }

  const payload = parseLandingEvent(rawPayload);
  if (!payload) return jsonError(400, "Invalid request");

  if (!payload.dryRun) {
    const visitId = getServerVisitId(normalizedIp);
    const metadata = {
      ...(payload.context ? { context: payload.context } : {}),
      ...(payload.refererClass ? { referer_class: payload.refererClass } : {}),
      ...(payload.utmSourceClass
        ? { utm_source_class: payload.utmSourceClass }
        : {}),
      ...(payload.uaClass ? { ua_class: payload.uaClass } : {}),
      ...(payload.internalMarker
        ? { internal_marker: payload.internalMarker }
        : {}),
      ...(payload.attachment ? { attachment: payload.attachment } : {}),
    };
    await tryRecordProductEvent({
      eventName: payload.name,
      visitId,
      metadata,
      occurredAt: payload.timestamp
        ? new Date(payload.timestamp).toISOString()
        : undefined,
    });
  }

  return new Response(null, { status: 204 });
}

function hasDeclaredOversizedBody(request: Request, maximumBytes: number): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength || !/^\d+$/.test(contentLength)) return false;
  const declaredBytes = Number(contentLength);
  return Number.isSafeInteger(declaredBytes) && declaredBytes > maximumBytes;
}

async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("payload_too_large").catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
