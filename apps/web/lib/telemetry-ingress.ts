import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import {
  INTERNAL_MARKER,
  UA_CLASS,
  classifyReferer,
  classifyUtmSource,
  classifyUserAgent,
  isInternalMarker,
  type InternalMarker,
  type RefererClass,
  type UaClass,
  type UtmSourceClass,
} from "./telemetry-dimensions";
import { resolveLandingAnalyticsRateLimitSecret } from "./landing-events-security";

const RATE_LIMIT_SECRET = resolveLandingAnalyticsRateLimitSecret();

export type LandingRequestDimensions = {
  /**
   * Keyed pseudonymous visit identifier derived server-side from the trusted
   * proxy IP and the UTC day bucket. Never sent to the client, never logged,
   * not reversible without the server secret. Persisted in the dedicated
   * visit_id column for dedupe and linkage aggregation.
   */
  visitId: string | null;
  refererClass: RefererClass;
  utmSourceClass: UtmSourceClass;
  uaClass: UaClass;
  internalMarker: InternalMarker;
};

/**
 * Normalize the trusted proxy IP header exactly like the rate-limit client
 * key does: one shared normalizer feeds both the ephemeral HMAC bucket and
 * the pseudonymous visit derivation, so they always agree on identity.
 * Returns null for unusable values in production (fail closed, same as the
 * origin/rate-limit guards).
 */
export function normalizeTrustedClientIp(
  rawIp: string | null | undefined,
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
  requestUrl?: string,
): string | null {
  const candidate = rawIp?.trim().toLowerCase() ?? "";
  const normalized = candidate
    .replace(/^\[([0-9a-f:]+)\](?::\d+)?$/i, "$1")
    .replace(/^::ffff:/, "");
  if (isIP(normalized)) return normalized;
  if (nodeEnvironment === "production") return null;

  try {
    const hostname = new URL(requestUrl ?? "http://localhost/").hostname
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

function dayBucket(now?: Date): string {
  return (now ?? new Date()).toISOString().slice(0, 10);
}

/**
 * Deterministic per-(IP, day) pseudonymous id. Same secret trust domain as
 * the rate-limit client key, with a distinct HMAC domain prefix.
 */
export function derivePseudonymousVisitId(
  normalizedIp: string,
  now?: Date,
): string {
  return createHmac("sha256", RATE_LIMIT_SECRET)
    .update(`landing-visit\0${dayBucket(now)}\0${normalizedIp}`)
    .digest("hex")
    .slice(0, 32);
}

function firstUtmValue(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)?.trim();
  return value ? value.slice(0, 256) : null;
}

/**
 * Extract the preregistered observation dimensions from request-time data.
 * Only fixed-vocabulary classes leave this module — raw referer, UTM strings
 * and user agent never reach telemetry storage.
 */
export function extractLandingRequestDimensions(input: {
  rawClientIp: string | null | undefined;
  referer: string | null | undefined;
  userAgent: string | null | undefined;
  requestUrl: string;
  now?: Date;
}): LandingRequestDimensions {
  let utmSourceClass = "unknown" as UtmSourceClass;
  let internalMarker: InternalMarker = INTERNAL_MARKER.none;
  try {
    const url = new URL(input.requestUrl);
    utmSourceClass = classifyUtmSource(
      firstUtmValue(url, "utm_source"),
      firstUtmValue(url, "utm_campaign"),
    );
    const declaredMarker = url.searchParams.get("rr_internal")?.trim();
    if (declaredMarker && isInternalMarker(declaredMarker)) {
      internalMarker = declaredMarker;
    }
  } catch {
    // Malformed request URL: UTM stays unknown, no internal marker.
  }

  const normalizedIp = normalizeTrustedClientIp(
    input.rawClientIp,
    process.env.NODE_ENV,
    input.requestUrl,
  );

  return {
    visitId: normalizedIp
      ? derivePseudonymousVisitId(normalizedIp, input.now)
      : null,
    refererClass: classifyReferer(input.referer),
    utmSourceClass,
    uaClass: classifyUserAgent(input.userAgent) ?? UA_CLASS.bot,
    internalMarker,
  };
}
