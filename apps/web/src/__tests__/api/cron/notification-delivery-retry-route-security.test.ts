jest.mock("@/lib/notification-dispatch", () => ({
  retryDueNotificationDeliveries: jest.fn(),
}));
jest.mock("@/lib/runtime", () => ({
  logError: jest.fn(),
  logEvent: jest.fn(),
}));

import { POST } from "@/app/api/cron/notification-delivery-retry/route";
import { retryDueNotificationDeliveries } from "@/lib/notification-dispatch";

const mockRetryDueNotificationDeliveries = jest.mocked(retryDueNotificationDeliveries);
const API_KEY = "cron-test-api-key-at-least-32-characters";

describe("notification delivery retry route security", () => {
  const originalCronApiKey = process.env.CRON_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_API_KEY = API_KEY;
  });

  afterAll(() => {
    if (originalCronApiKey === undefined) {
      delete process.env.CRON_API_KEY;
    } else {
      process.env.CRON_API_KEY = originalCronApiKey;
    }
  });

  test("does not expose the cron credential name when configuration is missing", async () => {
    delete process.env.CRON_API_KEY;

    const response = await POST(requestWithApiKey(API_KEY));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Notification retry service is not configured.",
    });
    expect(JSON.stringify(body)).not.toContain("CRON_API_KEY");
  });

  test("does not expose internal provider, database, or network failures", async () => {
    mockRetryDueNotificationDeliveries.mockRejectedValueOnce(
      new Error("postgres://internal-db/recruiter_radar password=super-secret ECONNREFUSED"),
    );

    const response = await POST(requestWithApiKey(API_KEY));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Notification retry queue failed.",
    });
    expect(JSON.stringify(body)).not.toContain("internal-db");
    expect(JSON.stringify(body)).not.toContain("super-secret");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });
});

function requestWithApiKey(apiKey: string): Parameters<typeof POST>[0] {
  return new Request("http://localhost/api/cron/notification-delivery-retry", {
    method: "POST",
    headers: { "x-api-key": apiKey },
  }) as Parameters<typeof POST>[0];
}
