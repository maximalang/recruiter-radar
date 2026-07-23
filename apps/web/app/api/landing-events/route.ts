import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";
import {
  isLandingAnalyticsContext,
  isLandingAnalyticsEventName,
  type LandingAnalyticsContext,
  type LandingAnalyticsEventName,
} from "@/lib/landing-analytics-contract";
import { tryRecordProductEvent } from "@/lib/telemetry";

const MAX_BODY_BYTES = 1_024;
const EVENT_RATE_LIMIT = new SlidingWindowRateLimiter({
  maxRequests: 180,
  windowMs: 60_000,
});

type LandingEventPayload = {
  name: LandingAnalyticsEventName;
  context?: LandingAnalyticsContext;
  timestamp?: number;
};

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function isSameOriginRequest(request: Request): boolean {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expectedOrigin;

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "none";
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

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonError(413, "Payload too large");
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

  // One endpoint bucket avoids storing or repurposing visitor IP/UA data.
  if (!(await EVENT_RATE_LIMIT.isAllowed("landing-events"))) {
    return jsonError(429, "Too many requests");
  }

  await tryRecordProductEvent({
    eventName: payload.name,
    metadata: payload.context ? { context: payload.context } : {},
    occurredAt: payload.timestamp
      ? new Date(payload.timestamp).toISOString()
      : undefined,
  });

  return new Response(null, { status: 204 });
}
