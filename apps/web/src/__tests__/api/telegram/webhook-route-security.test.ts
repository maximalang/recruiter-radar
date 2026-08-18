jest.mock("@/lib/db", () => ({
  getPool: jest.fn(),
  checkTelegramChatOwnsClientProfile: jest.fn(),
}));
jest.mock("@/lib/digestFeedback", () => ({
  isDigestFeedbackAction: jest.fn(() => true),
  updateDigestOrgStateFeedback: jest.fn(),
}));
jest.mock("@/lib/telegram", () => ({
  getTelegramBotToken: jest.fn(),
  answerTelegramCallbackQuery: jest.fn(),
  sendTelegramTextMessage: jest.fn(),
}));
jest.mock("@/lib/telegramConnect", () => ({ consumeTelegramConnectToken: jest.fn() }));
jest.mock("@/lib/telegramDigestFeedback", () => ({ verifyDigestFeedbackCallback: jest.fn() }));

import { POST } from "@/app/api/telegram/webhook/route";
import { checkTelegramChatOwnsClientProfile, getPool } from "@/lib/db";
import { getTelegramBotToken } from "@/lib/telegram";
import { verifyDigestFeedbackCallback } from "@/lib/telegramDigestFeedback";

const mockGetPool = jest.mocked(getPool);
const mockCheckOwnership = jest.mocked(checkTelegramChatOwnsClientProfile);
const mockGetTelegramBotToken = jest.mocked(getTelegramBotToken);
const mockVerifyCallback = jest.mocked(verifyDigestFeedbackCallback);

const SECRET = "telegram-test-secret";

describe("Telegram webhook failure hardening", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    mockGetTelegramBotToken.mockReturnValue({ botToken: "1234567890:AAH1bCdEfGhIjKlMnOpQrStUvWxYz012-_3", error: null });
    mockVerifyCallback.mockReturnValue(null);
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  afterAll(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  test("does not expose Telegram configuration details", async () => {
    mockGetTelegramBotToken.mockReturnValue({ botToken: null, error: "TELEGRAM_BOT_TOKEN is not configured." });

    const response = await POST(webhookRequest({ update_id: 1 }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Telegram service is not configured." });
    expect(JSON.stringify(body)).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  test("returns a retry-compatible response without exposing an initial database failure", async () => {
    const query = jest.fn().mockRejectedValueOnce(new Error("password authentication failed for user postgres"));
    mockGetPool.mockReturnValue({ query } as never);

    const response = await POST(webhookRequest({ update_id: 2 }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "Telegram webhook storage is unavailable." });
    expect(JSON.stringify(body)).not.toContain("postgres");
  });

  test("does not expose the database configuration name when storage is unavailable", async () => {
    mockGetPool.mockReturnValue(null);

    const response = await POST(webhookRequest({ update_id: 3 }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "Telegram webhook storage is unavailable." });
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });

  test("secondary failure-state persistence errors do not mask the public processing response", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 77, ownsClaim: true, status: "processing" }] })
      .mockRejectedValueOnce(new Error("secondary database persistence failure"));
    mockGetPool.mockReturnValue({ query } as never);
    mockVerifyCallback.mockReturnValue({
      client_profile_id: "7",
      org_id: "8",
      action: "accepted",
      exp: Math.floor(Date.now() / 1000) + 60,
    } as never);
    mockCheckOwnership.mockRejectedValueOnce(new Error("postgres://internal-host/recruiter_radar"));

    const response = await POST(webhookRequest({
      update_id: 4,
      callback_query: { id: "callback-4", data: "signed", from: { id: 12345 } },
    }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Unable to process Telegram webhook." });
    expect(JSON.stringify(body)).not.toContain("internal-host");
    expect(query).toHaveBeenCalledTimes(2);
  });
});

function webhookRequest(body: unknown): Request {
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": SECRET,
    },
    body: JSON.stringify(body),
  });
}
