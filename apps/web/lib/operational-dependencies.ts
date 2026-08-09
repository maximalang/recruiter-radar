import { getPool } from "./db-pool";
import { getPaymentProviderSetupState } from "./paymentsProvider";

export type DependencyState = "ok" | "configured_unverified" | "optional_unavailable" | "error";

export type OperationalDependencyReport = {
  generatedAt: string;
  criticalReady: boolean;
  database: { state: DependencyState; latencyMs: number | null };
  email: { state: DependencyState; provider: "postbox" | "smtp" | "test" | null };
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

  const email = resolveEmailDependency();
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

function resolveEmailDependency(): OperationalDependencyReport["email"] {
  if (process.env.AUTH_EMAIL_TRANSPORT === "test" && process.env.NODE_ENV !== "production") {
    return { state: "ok", provider: "test" };
  }
  if (allConfigured(["POSTBOX_ACCESS_KEY_ID", "POSTBOX_SECRET_ACCESS_KEY", "POSTBOX_FROM"])) {
    return { state: "configured_unverified", provider: "postbox" };
  }
  if (allConfigured(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"])) {
    return { state: "configured_unverified", provider: "smtp" };
  }
  return { state: "error", provider: null };
}
