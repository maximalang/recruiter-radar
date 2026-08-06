import {
  createRobokassaRefund,
  getRobokassaRefundSetupState,
  getRobokassaRefundState,
} from "../../../lib/paymentsRobokassaRefunds";

const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;
const REQUEST_ID = "68cd7fa6-1338-4745-ba5c-28d16cbcdb3d";

function configureLive() {
  process.env = {
    ...ORIGINAL_ENV,
    ROBOKASSA_MODE: "live",
    ROBOKASSA_PASSWORD_3: "refund-password-three",
    ROBOKASSA_REFUND_JWT_ALGORITHM: "HS256",
  };
}

function decodePayload(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("Robokassa Refund API", () => {
  beforeEach(() => {
    configureLive();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
    global.fetch = ORIGINAL_FETCH;
  });

  it("reports live Password3 readiness", () => {
    expect(getRobokassaRefundSetupState()).toEqual({
      configured: true,
      mode: "live",
      algorithm: "HS256",
    });
  });

  it("creates a full refund without RefundSum", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ success: true, message: null, requestId: REQUEST_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await createRobokassaRefund({
      opKey: "0005F891-8CCD-434B-8455-816AFFFDBF37-0VOisWikFF",
      orderAmountMinor: 299000,
    });

    expect(result).toMatchObject({
      ok: true,
      requestId: REQUEST_ID,
      amountMinor: 299000,
      full: true,
    });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const token = JSON.parse(String(init.body));
    expect(token.split(".")).toHaveLength(3);
    expect(decodePayload(token)).toEqual({
      OpKey: "0005F891-8CCD-434B-8455-816AFFFDBF37-0VOisWikFF",
    });
  });

  it("creates a partial refund with a kopeck-safe RefundSum", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ success: true, message: null, requestId: REQUEST_ID }), {
        status: 200,
      }),
    );

    const result = await createRobokassaRefund({
      opKey: "0005F891-8CCD-434B-8455-816AFFFDBF37-0VOisWikFF",
      orderAmountMinor: 299000,
      amountMinor: 125050,
    });

    expect(result).toMatchObject({ ok: true, amountMinor: 125050, full: false });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const token = JSON.parse(String(init.body));
    expect(decodePayload(token)).toEqual({
      OpKey: "0005F891-8CCD-434B-8455-816AFFFDBF37-0VOisWikFF",
      RefundSum: 1250.5,
    });
  });

  it("fails closed outside live mode", async () => {
    process.env.ROBOKASSA_MODE = "test";
    const result = await createRobokassaRefund({
      opKey: "0005F891-8CCD-434B-8455-816AFFFDBF37-0VOisWikFF",
      orderAmountMinor: 299000,
    });
    expect(result).toEqual({
      ok: false,
      message: "Refund API доступен только после настройки live-магазина и Password3.",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reads a finished refund state", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({
        requestId: REQUEST_ID,
        amount: 1250.5,
        label: "finished",
      }), { status: 200 }),
    );

    await expect(getRobokassaRefundState(REQUEST_ID)).resolves.toEqual({
      requestId: REQUEST_ID,
      label: "finished",
      amountMinor: 125050,
      finished: true,
      failed: false,
      message: null,
    });
  });
});
