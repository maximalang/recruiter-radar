import { getPool } from "./db-pool";
import { getPaymentProviderSetupState } from "./paymentsProvider";
import {
  getConfiguredEmailIdentity,
  isFreshEmailDelivery,
} from "./email/delivery-health";

export type DependencyState = "ok" | "configured_unverified" | "optional_unavailable" | "error";
type ConfigurationState = "ready" | "missing";
type RuntimeState = "healthy" | "unverified" | "error";
type VerificationState = "successful_delivery" | "test_transport" | "unverified";

type EmailDependency = {
  state: DependencyState;
  provider: "postbox" | "smtp" | "test" | null;
  configurationState: ConfigurationState;
  runtimeState: RuntimeState;
  verificationState: VerificationState;
  lastVerifiedAt: string | null;
  lastSuccessfulDeliveryAt: string | null;
};

export type OperationalDependencyReport = {
  generatedAt: string;
  criticalReady: boolean;
  database: { state: DependencyState; latencyMs: number | null };
  email: EmailDependency;
  workflow: { state: DependencyState; queue: "database" };
  providers: {
    payment: { state: DependencyState; provider: string | null };
    telegram: { state: DependencyState };
    webPush: { state: DependencyState };
  };
};

function allConfigured(names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

export async function getOperationalDependencyReport(): Promise<OperationalDependencyReport> {
  const pool = getPool();
  const startedAt = Date.now();
  let database: OperationalDependencyReport["database"] = { state: "error", latencyMs: null };
  if (pool) {
    try {
      await pool.query("SELECT 1");
      database = { state: "ok", latencyMs: Date.now() - startedAt };
    } catch {
      database = { state: "error", latencyMs: Date.now() - startedAt };
    }
  }

  const email = await resolveEmailDependency(database.state === "ok");
  const workflow: OperationalDependencyReport["workflow"] = {
    state: process.env.CRON_API_KEY?.trim() && database.state === "ok" ? "ok" : "error",
    queue: "database",
  };
  const paymentSetup = getPaymentProviderSetupState();
  const paymentState: DependencyState = paymentSetup.configured
    ? "configured_unverified"
    : "optional_unavailable";

  return {
    generatedAt: new Date().toISOString(),
    criticalReady: database.state === "ok" && email.state === "ok" && workflow.state === "ok",
    database,
    email,
    workflow,
    providers: {
      payment: { state: paymentState, provider: paymentSetup.provider },
      telegram: {
        state: process.env.TELEGRAM_BOT_TOKEN?.trim() ? "configured_unverified" : "optional_unavailable",
      },
      webPush: {
        state: allConfigured(["WEB_PUSH_PUBLIC_KEY", "WEB_PUSH_PRIVATE_KEY", "WEB_PUSH_SUBJECT"])
          ? "configured_unverified"
          : "optional_unavailable",
      },
    },
  };
}

async function resolveEmailDependency(databaseReady: boolean): Promise<EmailDependency> {
  if (process.env.AUTH_EMAIL_TRANSPORT === "test" && process.env.NODE_ENV !== "production") {
    return {
      state: "ok",
      provider: "test",
      configurationState: "ready",
      runtimeState: "healthy",
      verificationState: "test_transport",
      lastVerifiedAt: null,
      lastSuccessfulDeliveryAt: null,
    };
  }
  const configured = getConfiguredEmailIdentity();
  if (!configured) {
    return {
      state: "error",
      provider: null,
      configurationState: "missing",
      runtimeState: "error",
      verificationState: "unverified",
      lastVerifiedAt: null,
      lastSuccessfulDeliveryAt: null,
    };
  }
  if (!databaseReady) {
    return unverifiedEmail(configured.provider, "error");
  }

  const pool = getPool();
  if (!pool) return unverifiedEmail(configured.provider, "error");
  try {
    const verification = await pool.query<{
      lastVerifiedAt: string | null;
      lastSuccessfulDeliveryAt: string | null;
    }>(
      `SELECT
         MAX(delivered_at)::TEXT AS "lastVerifiedAt",
         MAX(delivered_at)::TEXT AS "lastSuccessfulDeliveryAt"
       FROM email_delivery_health_events
       WHERE provider = $1
         AND configuration_fingerprint = $2`,
      [configured.provider, configured.fingerprint],
    );
    const lastVerifiedAt = verification.rows[0]?.lastVerifiedAt ?? null;
    const lastSuccessfulDeliveryAt = verification.rows[0]?.lastSuccessfulDeliveryAt ?? null;
    if (!lastSuccessfulDeliveryAt || !isFreshEmailDelivery(lastSuccessfulDeliveryAt)) {
      return unverifiedEmail(configured.provider, "unverified");
    }
    return {
      state: "ok",
      provider: configured.provider,
      configurationState: "ready",
      runtimeState: "healthy",
      verificationState: "successful_delivery",
      lastVerifiedAt,
      lastSuccessfulDeliveryAt,
    };
  } catch {
    return unverifiedEmail(configured.provider, "error");
  }
}

function unverifiedEmail(
  provider: "postbox" | "smtp",
  runtimeState: "unverified" | "error",
): EmailDependency {
  return {
    state: runtimeState === "error" ? "error" : "configured_unverified",
    provider,
    configurationState: "ready",
    runtimeState,
    verificationState: "unverified",
    lastVerifiedAt: null,
    lastSuccessfulDeliveryAt: null,
  };
}
