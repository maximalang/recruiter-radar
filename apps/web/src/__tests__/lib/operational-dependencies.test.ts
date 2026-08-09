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
    for (const key of [
      "POSTBOX_ACCESS_KEY_ID", "POSTBOX_SECRET_ACCESS_KEY", "POSTBOX_FROM",
      "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
    ]) delete process.env[key];
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
      email: {
        state: "ok",
        provider: "test",
        configurationState: "ready",
        runtimeState: "healthy",
        verificationState: "test_transport",
        lastVerifiedAt: null,
        lastSuccessfulDeliveryAt: null,
      },
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
    expect(report.email).toEqual({
      state: "error",
      provider: null,
      configurationState: "missing",
      runtimeState: "error",
      verificationState: "unverified",
      lastVerifiedAt: null,
      lastSuccessfulDeliveryAt: null,
    });
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

    expect(report.email).toEqual({
      state: "configured_unverified",
      provider: "smtp",
      configurationState: "ready",
      runtimeState: "unverified",
      verificationState: "unverified",
      lastVerifiedAt: null,
      lastSuccessfulDeliveryAt: null,
    });
    expect(report.criticalReady).toBe(false);
  });

  it("promotes configured production email to healthy after an audited delivery", async () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    delete process.env.AUTH_EMAIL_TRANSPORT;
    process.env.POSTBOX_ACCESS_KEY_ID = "configured-id";
    process.env.POSTBOX_SECRET_ACCESS_KEY = "configured-secret";
    process.env.POSTBOX_FROM = "configured@example.invalid";
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({
        rows: [{ lastVerifiedAt: new Date().toISOString(), lastSuccessfulDeliveryAt: new Date().toISOString() }],
      });
    mockPool.mockReturnValue({ query } as never);

    const report = await getOperationalDependencyReport();

    expect(report.email).toMatchObject({
      state: "ok",
      provider: "postbox",
      configurationState: "ready",
      runtimeState: "healthy",
      verificationState: "successful_delivery",
    });
    expect(report.criticalReady).toBe(true);
    expect(JSON.stringify(report)).not.toContain("configured-secret");
    expect(JSON.stringify(report)).not.toContain("configured@example.invalid");
    expect(query.mock.calls[1]?.[1]).toEqual([
      "postbox",
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
  });

  it("does not certify rotated credentials with stale or mismatched evidence", async () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    delete process.env.AUTH_EMAIL_TRANSPORT;
    process.env.SMTP_HOST = "smtp.example.invalid";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "configured-user";
    process.env.SMTP_PASS = "credential-v1";
    process.env.SMTP_FROM = "configured@example.invalid";
    const stale = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ lastVerifiedAt: stale, lastSuccessfulDeliveryAt: stale }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ lastVerifiedAt: null, lastSuccessfulDeliveryAt: null }] });
    mockPool.mockReturnValue({ query } as never);

    const staleReport = await getOperationalDependencyReport();
    process.env.SMTP_PASS = "credential-v2";
    const rotatedReport = await getOperationalDependencyReport();

    expect(staleReport.email.runtimeState).toBe("unverified");
    expect(rotatedReport.email.runtimeState).toBe("unverified");
    expect(query.mock.calls[1]?.[1]?.[1]).not.toBe(query.mock.calls[3]?.[1]?.[1]);
  });
});
