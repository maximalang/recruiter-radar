/** @jest-environment node */

import {
  POST,
  isAllowedLandingOrigin,
  resetLandingEventRateLimitsForTests,
  resolveLandingAnalyticsRateLimitSecret,
} from "@/app/api/landing-events/route";
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

describe("POST /api/landing-events", () => {
  beforeEach(async () => {
    process.env.PUBLIC_APP_ORIGIN = "https://recruiter-radar.ru/";
    mockTryRecordProductEvent.mockClear();
    await resetLandingEventRateLimitsForTests();
  });

  it("allows only canonical HTTPS in production and explicit localhost in test", () => {
    expect(isAllowedLandingOrigin("https://recruiter-radar.ru", {
      configuredOrigin: "https://recruiter-radar.ru/",
      nodeEnvironment: "production",
    })).toBe(true);
    expect(isAllowedLandingOrigin("http://recruiter-radar.ru", {
      configuredOrigin: "http://recruiter-radar.ru",
      nodeEnvironment: "production",
    })).toBe(false);
    expect(isAllowedLandingOrigin("http://localhost:3000", {
      configuredOrigin: "https://recruiter-radar.ru",
      nodeEnvironment: "production",
    })).toBe(false);
    expect(isAllowedLandingOrigin("http://localhost:3000", {
      configuredOrigin: "https://recruiter-radar.ru",
      nodeEnvironment: "test",
    })).toBe(true);
    expect(isAllowedLandingOrigin("https://recruiter-radar.ru/path", {
      configuredOrigin: "https://recruiter-radar.ru",
      nodeEnvironment: "production",
    })).toBe(false);
  });

  it("persists an allowlisted, privacy-bounded event and returns 204", async () => {
    const response = await POST(request(JSON.stringify({
      name: "preview_started",
      context: "form",
      timestamp: Date.now(),
    })));

    expect(response.status).toBe(204);
    expect(mockTryRecordProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "preview_started",
      metadata: { context: "form" },
    }));
  });

  it("supports a non-persisting deployment smoke payload", async () => {
    const response = await POST(request(JSON.stringify({
      name: "landing_viewed",
      context: "landing",
      dryRun: true,
    })));
    const invalidDryRun = await POST(request(JSON.stringify({
      name: "checkout_started",
      context: "pricing_pilot",
      dryRun: true,
    })));

    expect(response.status).toBe(204);
    expect(invalidDryRun.status).toBe(400);
    expect(mockTryRecordProductEvent).not.toHaveBeenCalled();
  });

  it("accepts the canonical motion-control context", async () => {
    const response = await POST(request(JSON.stringify({
      name: "motion_paused",
      context: "motion_control",
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

  it("uses configured canonical origin instead of trusting Host", async () => {
    const wrongType = await POST(request(
      JSON.stringify({ name: "landing_viewed" }),
      { "content-type": "text/plain" },
    ));
    const canonicalOriginWithForgedHost = await POST(request(
      JSON.stringify({ name: "landing_viewed" }),
      { host: "attacker.example" },
    ));
    const forgedHostAndOrigin = await POST(request(
      JSON.stringify({ name: "landing_viewed" }),
      {
        host: "attacker.example",
        origin: "https://attacker.example",
      },
    ));

    expect(wrongType.status).toBe(415);
    expect(canonicalOriginWithForgedHost.status).toBe(204);
    expect(forgedHostAndOrigin.status).toBe(403);
  });

  it("rejects malformed and missing Origin headers", async () => {
    const malformedOrigin = await POST(request(
      JSON.stringify({ name: "landing_viewed" }),
      { origin: "not a url" },
    ));
    const missingOriginHeaders = new Headers({
      "content-type": "application/json",
      "x-real-ip": "203.0.113.11",
    });
    const missingOrigin = await POST(new Request(
      "https://recruiter-radar.ru/api/landing-events",
      {
        method: "POST",
        headers: missingOriginHeaders,
        body: JSON.stringify({ name: "landing_viewed" }),
      },
    ));

    expect(malformedOrigin.status).toBe(403);
    expect(missingOrigin.status).toBe(403);
  });

  it("uses trusted X-Real-IP for independent buckets and ignores forged X-Forwarded-For", async () => {
    const body = JSON.stringify({ name: "landing_viewed" });
    const limitedIp = "203.0.113.71";

    for (let index = 0; index < 30; index += 1) {
      const response = await POST(request(body, {
        "x-real-ip": limitedIp,
        "x-forwarded-for": `198.51.100.${index + 1}`,
      }));
      expect(response.status).toBe(204);
    }

    const rejected = await POST(request(body, {
      "x-real-ip": limitedIp,
      "x-forwarded-for": "192.0.2.250",
    }));
    const otherClient = await POST(request(body, {
      "x-real-ip": "203.0.113.72",
      "x-forwarded-for": "192.0.2.250",
    }));

    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("60");
    expect(otherClient.status).toBe(204);
    expect(JSON.stringify(mockTryRecordProductEvent.mock.calls)).not.toContain(limitedIp);
  });

  it("rejects missing or malformed trusted proxy IP headers", async () => {
    const body = JSON.stringify({ name: "landing_viewed" });
    const missingIp = await POST(new Request(
      "https://recruiter-radar.ru/api/landing-events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://recruiter-radar.ru",
        },
        body,
      },
    ));
    const malformedIp = await POST(request(body, { "x-real-ip": "not-an-ip" }));

    expect(missingIp.status).toBe(403);
    expect(malformedIp.status).toBe(403);
    expect(mockTryRecordProductEvent).not.toHaveBeenCalled();
  });

  it("allows direct loopback development requests without a proxy header", async () => {
    const response = await POST(new Request(
      "http://127.0.0.1:3000/api/landing-events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({ name: "landing_viewed" }),
      },
    ));

    expect(response.status).toBe(204);
  });

  it("requires a stable rate-limit salt in production", () => {
    expect(() => resolveLandingAnalyticsRateLimitSecret({
      nodeEnvironment: "production",
      configuredSalt: "",
      nextPhase: "",
    })).toThrow("LANDING_ANALYTICS_RATE_LIMIT_SALT is required");
    expect(() => resolveLandingAnalyticsRateLimitSecret({
      nodeEnvironment: "production",
      configuredSalt: "too-short",
      nextPhase: "",
    })).toThrow("LANDING_ANALYTICS_RATE_LIMIT_SALT must contain at least 32 characters");
    expect(resolveLandingAnalyticsRateLimitSecret({
      nodeEnvironment: "production",
      configuredSalt: "0123456789abcdef0123456789abcdef",
      nextPhase: "",
    })).toBe("0123456789abcdef0123456789abcdef");
    expect(resolveLandingAnalyticsRateLimitSecret({
      nodeEnvironment: "production",
      configuredSalt: "",
      nextPhase: "phase-production-build",
    })).toContain("build-only");
    expect(resolveLandingAnalyticsRateLimitSecret({
      nodeEnvironment: "development",
      configuredSalt: "",
    })).toBe(resolveLandingAnalyticsRateLimitSecret({
      nodeEnvironment: "development",
      configuredSalt: "",
    }));
  });

  it("accepts the configured external origin when standalone uses an internal URL", async () => {
    const response = await POST(new Request(
      "http://127.0.0.1:3000/api/landing-events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "recruiter-radar.ru",
          origin: "https://recruiter-radar.ru",
          "x-forwarded-proto": "https",
          "x-real-ip": "203.0.113.80",
        },
        body: JSON.stringify({ name: "landing_viewed" }),
      },
    ));

    expect(response.status).toBe(204);
  });

  it("enforces the global emergency limit separately from per-client limits", async () => {
    const body = JSON.stringify({ name: "landing_viewed" });
    for (let index = 0; index < 1_000; index += 1) {
      const thirdOctet = Math.floor(index / 250);
      const fourthOctet = (index % 250) + 1;
      const response = await POST(request(body, {
        "x-real-ip": `198.18.${thirdOctet}.${fourthOctet}`,
      }));
      expect(response.status).toBe(204);
    }

    const rejected = await POST(request(body, {
      "x-real-ip": "198.19.0.1",
    }));
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("60");
  });
});
