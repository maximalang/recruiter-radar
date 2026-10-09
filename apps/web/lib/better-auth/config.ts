const PROD_ORIGIN = "https://recruiter-radar.ru";

export const BETTER_AUTH_BASE_PATH = "/api/identity";

function exactTrue(value: string | undefined): boolean {
  return value?.trim() === "true";
}

export function isBetterAuthEnabled(): boolean {
  return exactTrue(process.env.BETTER_AUTH_ENABLED);
}

export function getBetterAuthBaseOrigin(): string {
  const raw = (
    process.env.BETTER_AUTH_URL
    ?? process.env.AUTH_SITE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.RR_APP_BASE_URL
    ?? (process.env.NODE_ENV === "production" ? PROD_ORIGIN : "http://localhost:3000")
  ).trim();
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.username || url.password || (url.protocol !== "https:" && !local)) {
    throw new Error("BETTER_AUTH_URL must be a canonical HTTPS origin outside local development.");
  }
  return url.origin;
}

export type BetterAuthRuntimeConfig = {
  databaseUrl: string;
  secret: string;
  baseOrigin: string;
};

export function getBetterAuthRuntimeConfig(): BetterAuthRuntimeConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required when Better Auth is enabled.");

  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be set and at least 32 characters.");
  }

  const baseOrigin = getBetterAuthBaseOrigin();
  if (process.env.NODE_ENV === "production" && baseOrigin !== PROD_ORIGIN) {
    throw new Error("Production Better Auth origin must be https://recruiter-radar.ru.");
  }

  return { databaseUrl, secret, baseOrigin };
}

export function getBetterAuthPublicState() {
  return {
    enabled: isBetterAuthEnabled(),
    basePath: BETTER_AUTH_BASE_PATH,
  } as const;
}
