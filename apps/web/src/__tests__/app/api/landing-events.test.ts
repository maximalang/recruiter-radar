/** @jest-environment node */

import { POST } from "@/app/api/landing-events/route";
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
      ...headers,
    },
    body,
  });
}

describe("POST /api/landing-events", () => {
  beforeEach(() => {
    mockTryRecordProductEvent.mockClear();
  });

  it("persists an allowlisted, privacy-bounded event and returns 204", async () => {
    const response = await POST(request(JSON.stringify({
      name: "preview_started",
      context: "preview-form",
      timestamp: Date.now(),
    })));

    expect(response.status).toBe(204);
    expect(mockTryRecordProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "preview_started",
      metadata: { context: "preview-form" },
    }));
  });

  it("accepts the canonical motion-control context", async () => {
    const response = await POST(request(JSON.stringify({
      name: "motion_paused",
      context: "motion-control",
    })));

    expect(response.status).toBe(204);
  });

  it("rejects unknown events and contexts", async () => {
    const unknownEvent = await POST(request(JSON.stringify({ name: "email_captured" })));
    const unknownContext = await POST(request(JSON.stringify({
      name: "preview_started",
      context: "raw-form-value",
    })));

    expect(unknownEvent.status).toBe(400);
    expect(unknownContext.status).toBe(400);
    expect(mockTryRecordProductEvent).not.toHaveBeenCalled();
  });

  it("rejects oversized, malformed and cross-origin requests without a stack trace", async () => {
    const oversized = await POST(request(JSON.stringify({
      name: "preview_started",
      context: "x".repeat(5_000),
    })));
    const malformed = await POST(request("{"));
    const crossOrigin = await POST(request(
      JSON.stringify({ name: "landing_viewed" }),
      { origin: "https://attacker.example" },
    ));

    expect(oversized.status).toBe(413);
    expect(malformed.status).toBe(400);
    expect(crossOrigin.status).toBe(403);
    await expect(malformed.text()).resolves.not.toContain("SyntaxError");
  });
});
