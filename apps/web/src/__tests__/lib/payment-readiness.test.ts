/** @jest-environment node */

describe("payment readiness", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test("fails closed when YooKassa is not selected", async () => {
    process.env.OPERATOR_PUBLIC_POSTAL_ADDRESS = "г. Москва, адрес для корреспонденции";
    const { buildPaymentReadinessReport } = await import("@/lib/payment-readiness");
    const report = buildPaymentReadinessReport({
      provider: null,
      configured: false,
      mode: null,
      webhookConfigured: false,
      siteUrlConfigured: false,
    });

    expect(report).toMatchObject({
      selfServePilotReady: false,
      liveLaunchReady: false,
      recurringBillingReady: false,
      rfProvider: { status: "blocked", provider: null },
      customerFlow: { pilot: "saved_request", monthly: "sales_request", quarterly: "sales_request" },
    });
  });

  test("separates technical integration from verified live launch", async () => {
    process.env.OPERATOR_PUBLIC_POSTAL_ADDRESS = "г. Москва, адрес для корреспонденции";
    const { buildPaymentReadinessReport } = await import("@/lib/payment-readiness");
    const report = buildPaymentReadinessReport({
      provider: "yookassa",
      configured: true,
      mode: "test",
      webhookConfigured: true,
      siteUrlConfigured: true,
    });

    expect(report.selfServePilotReady).toBe(true);
    expect(report.merchantModerationReady).toBe(true);
    expect(report.liveLaunchReady).toBe(false);
    expect(report.launch.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("YOOKASSA_MODE"),
      expect.stringContaining("тестовый платёж"),
      expect.stringContaining("чека НПД"),
      expect.stringContaining("Роскомнадзора"),
    ]));
  });

  test("requires explicit ISO verification records before live-ready", async () => {
    process.env.OPERATOR_PUBLIC_POSTAL_ADDRESS = "г. Москва, адрес для корреспонденции";
    process.env.YOOKASSA_LAUNCH_VERIFIED_AT = "2026-07-31T18:30:00.000Z";
    process.env.NPD_RECEIPT_FLOW_VERIFIED_AT = "2026-07-31T18:31:00.000Z";
    process.env.PDN_COMPLIANCE_VERIFIED_AT = "2026-07-31T18:32:00.000Z";
    const { buildPaymentReadinessReport } = await import("@/lib/payment-readiness");
    const report = buildPaymentReadinessReport({
      provider: "yookassa",
      configured: true,
      mode: "live",
      webhookConfigured: true,
      siteUrlConfigured: true,
    });

    expect(report.liveLaunchReady).toBe(true);
    expect(report.launch).toMatchObject({
      status: "ready",
      technicalVerificationRecorded: true,
      npdReceiptVerificationRecorded: true,
      pdnComplianceVerificationRecorded: true,
      blockers: [],
    });
  });
});
