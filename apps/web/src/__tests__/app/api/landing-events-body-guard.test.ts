/** @jest-environment node */

import { POST } from "@/app/api/landing-events/route";
import { resetLandingEventRateLimitsForTests } from "@/lib/landing-events-security";
import { tryRecordProductEvent } from "@/lib/telemetry";

jest.mock("@/lib/telemetry", () => ({
  ...jest.requireActual("@/lib/telemetry"),
  tryRecordProductEvent: jest.fn().mockResolvedValue(true),
}));

const mockTryRecordProductEvent = tryRecordProductEvent as jest.MockedFunction<
  typeof tryRecordProductEvent
>;

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://recruiter-radar.ru/api/landing-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://recruiter-radar.ru",
      "x-real-ip": "203.0.113.10",
      ...headers,
    },
    body,
  });
}

describe("POST /api/landing-events declared body guard", () => {
  beforeEach(async () => {
    process.env.PUBLIC_APP_ORIGIN = "https://recruiter-radar.ru/";
    mockTryRecordProductEvent.mockClear();
    await resetLandingEventRateLimitsForTests();
  });

  it("rejects a declared content-length above the bound before reading the body", async () => {
    const declaredOversized = await POST(request(
      JSON.stringify({ name: "landing_viewed" }),
      { "content-length": "1025" },
    ));

    expect(declaredOversized.status).toBe(413);
    expect(mockTryRecordProductEvent).not.toHaveBeenCalled();
  });

  it("keeps the actual body bound at 1024 bytes", async () => {
    const oversized = await POST(request(JSON.stringify({
      name: "preview_started",
      context: "x".repeat(5_000),
    })));

    expect(oversized.status).toBe(413);
    expect(mockTryRecordProductEvent).not.toHaveBeenCalled();
  });
});
