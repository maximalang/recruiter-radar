import { Pool } from "pg";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

import {
  BETTER_AUTH_BASE_PATH,
  BETTER_AUTH_CORE_SCOPES,
  BETTER_AUTH_MCP_READ_SCOPE,
  BETTER_AUTH_MCP_RESOURCE,
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

const jwtPlugin = jwt({
  disableSettingJwtHeader: true,
  jwks: {
    // The operator resource server intentionally supports a small asymmetric
    // algorithm allowlist. ES256 keeps that contract narrow and interoperable.
    keyPairConfig: { alg: "ES256" },
    // Better Auth encrypts private keys by default. Rotate without invalidating
    // tokens signed by the previous key during the grace period.
    rotationInterval: 60 * 60 * 24 * 30,
    gracePeriod: 60 * 60 * 24 * 30,
  },
});

const oauthPlugin = runtime.mcpEnabled
  ? oauthProvider({
      loginPage: "/login",
      consentPage: "/auth/mcp-consent",
      validAudiences: [BETTER_AUTH_MCP_RESOURCE],
      scopes: [...BETTER_AUTH_CORE_SCOPES],
      clientRegistrationDefaultScopes: [
        "openid",
        "offline_access",
        BETTER_AUTH_MCP_READ_SCOPE,
      ],
      clientRegistrationAllowedScopes: ["profile", "email"],
      advertisedMetadata: {
        scopes_supported: [...BETTER_AUTH_CORE_SCOPES],
      },
      allowDynamicClientRegistration: runtime.dcrEnabled,
      allowUnauthenticatedClientRegistration: runtime.dcrEnabled,
    })
  : null;

export const auth = betterAuth({
  appName: "Recruiter Radar",
  database,
  secret: runtime.secret,
  baseURL: runtime.baseOrigin,
  basePath: BETTER_AUTH_BASE_PATH,
  trustedOrigins: [runtime.baseOrigin],
  // OAuth Provider mode has its own standards-compliant token endpoint.
  // Do not expose the generic JWT /token endpoint as a parallel bearer path.
  disabledPaths: ["/token"],
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
  plugins: oauthPlugin ? [jwtPlugin, oauthPlugin] : [jwtPlugin],
});

export type RecruiterRadarBetterAuth = typeof auth;
