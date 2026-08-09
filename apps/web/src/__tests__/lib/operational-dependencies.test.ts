jest.mock("@/lib/db-pool", () => ({ getPool: jest.fn() }));
jest.mock("@/lib/paymentsProvider", () => ({ getPaymentProviderSetupState: jest.fn() }));

import { getPool } from "@/lib/db-pool";
import { getOperationalDependencyReport } from "@/lib/operational-dependencies";
import { getPaymentProviderSetupState } from "@/lib/paymentsProvider";

const mockPool = jest.mocked(getPool);
const mockPayment = jest.mocked(getPaymentProviderSetupState);

describe("operational dependency report", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "test", CRON_API_KEY: "operator-key", AUTH_EMAIL_TRANSPORT: "test" };
    mockPool.mockReturnValue({ query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) } as never);
    mockPayment.mockReturnValue({ configured: false, provider: null } as never);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("reports verified local dependencies separately from unverified optional providers", async () => {
    const report = await getOperationalDependencyReport();
    expect(report).toMatchObject({
      criticalReady: true,
      database: { state: "ok" },
      email: { state: "ok", provider: "test" },
      workflow: { state: "ok", queue: "database" },
      providers: { payment: { state: "optional_unavailable", provider: null } },
    });
    expect(JSON.stringify(report)).not.toMatch(/key|token|secret|password/i);
  });

  it("fails critical readiness when database or email is unavailable", async () => {
    mockPool.mockReturnValue(null);
    delete process.env.AUTH_EMAIL_TRANSPORT;
    const report = await getOperationalDependencyReport();
    expect(report.criticalReady).toBe(false);
    expect(report.database.state).toBe("error");
    expect(report.email).toEqual({ state: "error", provider: null });
    expect(report.workflow.state).toBe("error");
  });

  it("keeps production readiness degraded when email is only configured", async () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    delete process.env.AUTH_EMAIL_TRANSPORT;
    process.env.SMTP_HOST = "smtp.example.invalid";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "configured-user";
    process.env.SMTP_PASS = "configured-password";
    process.env.SMTP_FROM = "configured@example.invalid";

    const report = await getOperationalDependencyReport();

    expect(report.email).toEqual({ state: "configured_unverified", provider: "smtp" });
    expect(report.criticalReady).toBe(false);
  });
});
