import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";

describe("SlidingWindowRateLimiter fallback cleanup", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("evicts inactive in-memory buckets after the window expires", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
    const limiter = new SlidingWindowRateLimiter({ maxRequests: 2, windowMs: 1_000 });
    const buckets = (
      limiter as unknown as { buckets: Map<string, number[]> }
    ).buckets;

    await expect(limiter.isAllowed("expired-client")).resolves.toBe(true);
    expect(buckets.size).toBe(1);

    jest.advanceTimersByTime(1_001);
    await expect(limiter.isAllowed("active-client")).resolves.toBe(true);

    expect(buckets.has("expired-client")).toBe(false);
    expect(buckets.has("active-client")).toBe(true);
    expect(buckets.size).toBe(1);
  });
});
