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

const database = new Pool({
  connectionString: runtime.databaseUrl,
  application_name: "recruiter-radar-better-auth",
  options: "-c search_path=better_auth,public -c statement_timeout=10000",
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const plugins = [jwt()];

if (runtime.mcpEnabled) {
  plugins.push(
    oauthProvider({
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
    }),
  );
}

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
  plugins,
});

export type RecruiterRadarBetterAuth = typeof auth;
