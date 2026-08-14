import { Pool } from "pg";
import { betterAuth } from "better-auth";

import {
  BETTER_AUTH_BASE_PATH,
  getBetterAuthRuntimeConfig,
} from "./config";

const runtime = getBetterAuthRuntimeConfig();

function buildDatabaseConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  const requiredOptions = "-c search_path=better_auth,public -c statement_timeout=10000";
  const existingOptions = url.searchParams.get("options")?.trim();
  url.searchParams.set(
    "options",
    existingOptions ? `${existingOptions} ${requiredOptions}` : requiredOptions,
  );
  url.searchParams.set("application_name", "recruiter-radar-better-auth");
  return url.toString();
}

const database = new Pool({
  connectionString: buildDatabaseConnectionString(runtime.databaseUrl),
});

export const auth = betterAuth({
  appName: "Recruiter Radar",
  database,
  secret: runtime.secret,
  baseURL: runtime.baseOrigin,
  basePath: BETTER_AUTH_BASE_PATH,
  trustedOrigins: [runtime.baseOrigin],
  emailAndPassword: {
    enabled: false,
  },
  account: {
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
      allowDifferentEmails: false,
      allowUnlinkingAll: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 15,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
  },
  advanced: {
    useSecureCookies: runtime.baseOrigin.startsWith("https://"),
    cookiePrefix: "rr_identity",
  },
});

export type RecruiterRadarBetterAuth = typeof auth;
