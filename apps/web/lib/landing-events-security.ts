import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";

const CLIENT_EVENT_RATE_LIMIT = new SlidingWindowRateLimiter({
  maxRequests: 30,
  windowMs: 60_000,
});
const GLOBAL_EVENT_RATE_LIMIT = new SlidingWindowRateLimiter({
  maxRequests: 1_000,
  windowMs: 60_000,
});
const LOCAL_RATE_LIMIT_SECRET =
  "recruiter-radar-local-landing-analytics-rate-limit-v1";
const BUILD_RATE_LIMIT_SECRET =
  "recruiter-radar-build-only-landing-analytics-rate-limit-v1";
const LOCAL_DEVELOPMENT_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

export function resolveLandingAnalyticsRateLimitSecret(
  options: {
    nodeEnvironment?: string;
    configuredSalt?: string;
    nextPhase?: string;
  } = {},
): string {
  const nodeEnvironment = options.nodeEnvironment ?? process.env.NODE_ENV;
  const nextPhase = options.nextPhase ?? process.env.NEXT_PHASE;
  const configuredSalt = (
    options.configuredSalt ?? process.env.LANDING_ANALYTICS_RATE_LIMIT_SALT
  )?.trim();
  if (configuredSalt) {
    if (nodeEnvironment === "production" && configuredSalt.length < 32) {
      throw new Error(
        "LANDING_ANALYTICS_RATE_LIMIT_SALT must contain at least 32 characters",
      );
    }
    return configuredSalt;
  }
  if (
    nodeEnvironment === "production" &&
    nextPhase === "phase-production-build"
  ) {
    return BUILD_RATE_LIMIT_SECRET;
  }
  if (nodeEnvironment === "production") {
    throw new Error("LANDING_ANALYTICS_RATE_LIMIT_SALT is required");
  }
  return LOCAL_RATE_LIMIT_SECRET;
}

function normalizeOrigin(
  rawOrigin: string | null | undefined,
  nodeEnvironment: string | undefined,
): string | null {
  if (!rawOrigin) return null;

  try {
    const url = new URL(rawOrigin.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    if (nodeEnvironment === "production" && url.protocol !== "https:") {
      return null;
    }
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowedLandingOrigin(
  requestOrigin: string | null,
  options: {
    configuredOrigin?: string;
    nodeEnvironment?: string;
  } = {},
): boolean {
  const nodeEnvironment = options.nodeEnvironment ?? process.env.NODE_ENV;
  const origin = normalizeOrigin(requestOrigin, nodeEnvironment);
  if (!origin) return false;

  const configuredOrigin = normalizeOrigin(
    options.configuredOrigin ?? process.env.PUBLIC_APP_ORIGIN,
    nodeEnvironment,
  );
  if (configuredOrigin && origin === configuredOrigin) return true;

  return (
    nodeEnvironment !== "production" &&
    LOCAL_DEVELOPMENT_ORIGINS.has(origin)
  );
}

export async function checkLandingEventRateLimits(
  clientKey: string,
): Promise<"client" | "global" | null> {
  if (!(await CLIENT_EVENT_RATE_LIMIT.isAllowed(`landing-events:client:${clientKey}`))) {
    return "client";
  }
  if (!(await GLOBAL_EVENT_RATE_LIMIT.isAllowed("landing-events:global"))) {
    return "global";
  }
  return null;
}

export async function resetLandingEventRateLimitsForTests(): Promise<void> {
  if (process.env.NODE_ENV !== "test") return;
  await Promise.all([
    CLIENT_EVENT_RATE_LIMIT.reset(),
    GLOBAL_EVENT_RATE_LIMIT.reset(),
  ]);
}
