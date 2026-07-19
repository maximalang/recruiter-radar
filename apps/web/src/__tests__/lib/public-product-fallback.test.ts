import { getHhDigestItems } from "@/lib/hhDigest";
import {
  buildPublicPreviewHref,
  getPublicSampleDigestState,
  PUBLIC_PLANS,
  readPublicPreviewInput,
} from "@/lib/publicProduct";
import { formatScorePoints } from "@/lib/scoring/score-display";

jest.mock("@/lib/hhDigest", () => ({
  getHhDigestItems: jest.fn(),
}));

const mockGetHhDigestItems = getHhDigestItems as jest.MockedFunction<typeof getHhDigestItems>;

describe("public preview resilience", () => {
  it("labels long-term plans as requests and keeps cadence separate from savings", () => {
    const recurringPlans = PUBLIC_PLANS.filter((plan) => plan.isRecurring);
    const quarterly = PUBLIC_PLANS.find((plan) => plan.code === "quarterly");

    expect(recurringPlans.every((plan) => plan.ctaLabel.startsWith("Оставить заявку"))).toBe(true);
    expect(quarterly?.cadence).toBe("90 дней");
  });

  it("caps public query text at product-safe lengths", () => {
    const input = readPublicPreviewInput({
      specialization: `  ${"с".repeat(200)}`,
      targetCity: `  ${"г".repeat(150)}`,
      includeKeywords: `  ${"к".repeat(400)}`,
      excludeKeywords: `  ${"и".repeat(400)}`,
    });

    expect(input.specialization).toHaveLength(160);
    expect(input.targetCity).toHaveLength(120);
    expect(input.includeKeywords).toHaveLength(300);
    expect(input.excludeKeywords).toHaveLength(300);
  });

  it("builds a landing return link that keeps filters and opens the preview", () => {
    const href = buildPublicPreviewHref({
      specialization: "инженерный подбор",
      targetCity: "Москва",
      includeKeywords: "инженер",
      excludeKeywords: "стажёр",
      dailyDigestLimit: 7,
    });
    const url = new URL(href, "https://radar.example");

    expect(url.pathname).toBe("/");
    expect(url.hash).toBe("#preview");
    expect(url.searchParams.get("specialization")).toBe("инженерный подбор");
    expect(url.searchParams.get("targetCity")).toBe("Москва");
    expect(url.searchParams.get("includeKeywords")).toBe("инженер");
    expect(url.searchParams.get("excludeKeywords")).toBe("стажёр");
    expect(url.searchParams.get("dailyDigestLimit")).toBe("7");
  });

  it("serves an explicitly non-live demo when the digest store is unavailable", async () => {
    const reportFallback = jest.spyOn(console, "info").mockImplementation(() => undefined);
    mockGetHhDigestItems.mockRejectedValueOnce(new Error("database unavailable"));

    const state = await getPublicSampleDigestState(readPublicPreviewInput({}));

    expect(state).toMatchObject({
      isLive: false,
      isPersonalized: false,
      hasExactMatches: true,
    });
    expect(state.items.length).toBeGreaterThan(0);
    expect(state.items.every((item) => item.org_id.startsWith("demo-"))).toBe(true);
    expect(state.items[0].source_families).toEqual(
      expect.arrayContaining(["hh", "career-pages"]),
    );
    expect(state.items.map((item) => formatScorePoints(item.total_score))).toEqual(["87", "78"]);
    expect(reportFallback).toHaveBeenCalledWith(
      "Public preview data unavailable; serving static demo fallback",
    );

    reportFallback.mockRestore();
  });

  it("serves demo cards when the preview store reports no usable items", async () => {
    const reportFallback = jest.spyOn(console, "info").mockImplementation(() => undefined);
    mockGetHhDigestItems.mockResolvedValueOnce([]);

    const state = await getPublicSampleDigestState(readPublicPreviewInput({}));

    expect(state.isLive).toBe(false);
    expect(state.isPersonalized).toBe(false);
    expect(state.items.length).toBeGreaterThan(0);
    expect(state.items.every((item) => item.org_id.startsWith("demo-"))).toBe(true);
    expect(reportFallback).toHaveBeenCalledWith(
      "Public preview has no eligible items; serving static demo fallback",
    );

    reportFallback.mockRestore();
  });

  it("keeps static demo freshness relative to the request date", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-18T12:00:00.000Z"));
    const reportFallback = jest.spyOn(console, "info").mockImplementation(() => undefined);
    mockGetHhDigestItems.mockResolvedValueOnce([]);

    const state = await getPublicSampleDigestState(readPublicPreviewInput({}));
    const newestPublishedAt = new Date(state.items[0].latest_published_at).getTime();

    expect(Date.now() - newestPublishedAt).toBeLessThan(24 * 60 * 60 * 1000);

    reportFallback.mockRestore();
    jest.useRealTimers();
  });

  it("does not claim demo results were personalized to submitted filters", async () => {
    const reportFallback = jest.spyOn(console, "info").mockImplementation(() => undefined);
    mockGetHhDigestItems.mockRejectedValueOnce(new Error("database unavailable"));

    const state = await getPublicSampleDigestState(readPublicPreviewInput({
      specialization: "инженерный подбор",
      targetCity: "Москва",
    }));

    expect(state.isLive).toBe(false);
    expect(state.isPersonalized).toBe(false);

    reportFallback.mockRestore();
  });
});
