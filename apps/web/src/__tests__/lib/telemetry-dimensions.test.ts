/** @jest-environment node */

import {
  INTERNAL_MARKER,
  UA_CLASS,
  classifyReferer,
  classifyUtmSource,
  classifyUserAgent,
  isExcludedInternalMarker,
  isExcludedUaClass,
  isInternalMarker,
  isRefererClass,
  isUaClass,
  isUtmSourceClass,
  isVisitId,
} from "@/lib/telemetry-dimensions";
import { extractLandingRequestDimensions } from "@/lib/telemetry-ingress";

describe("telemetry-dimensions class vocabularies", () => {
  it("classifies preregistered referer hosts", () => {
    expect(classifyReferer("https://hh.ru/search")).toBe("relevant");
    expect(classifyReferer("https://career.habr.com/vacancies")).toBe("relevant");
    expect(classifyReferer("https://t.me/somechannel")).toBe("relevant");
    expect(classifyReferer("https://www.google.com/")).toBe("not_relevant");
    expect(classifyReferer("https://recruiter-radar.ru/")).toBe("not_relevant");
    expect(classifyReferer("https://unknown-forum.example/")).toBe("unknown");
    expect(classifyReferer(null)).toBe("unknown");
    expect(classifyReferer("::not a url::")).toBe("unknown");
  });

  it("classifies utm sources with relevant precedence", () => {
    expect(classifyUtmSource("telegram", null)).toBe("relevant");
    expect(classifyUtmSource(null, "hh-agency-week")).toBe("relevant");
    expect(classifyUtmSource("yandex_direct", null)).toBe("not_relevant");
    expect(classifyUtmSource("google", "cpc-ads")).toBe("not_relevant");
    expect(classifyUtmSource(null, null)).toBe("unknown");
    expect(classifyUtmSource("mystery-source", "mystery")).toBe("unknown");
    expect(classifyUtmSource("tg", "yandex_direct")).toBe("relevant");
  });

  it("classifies user agents fail-closed", () => {
    expect(classifyUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    )).toBe(UA_CLASS.browser);
    expect(classifyUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(
      UA_CLASS.browser,
    );
    expect(classifyUserAgent("curl/8.4.0")).toBe(UA_CLASS.bot);
    expect(classifyUserAgent("Googlebot/2.1")).toBe(UA_CLASS.bot);
    expect(classifyUserAgent("Mozilla/5.0 HeadlessChrome/126")).toBe(UA_CLASS.bot);
    expect(classifyUserAgent("UptimeRobot/2.0")).toBe(UA_CLASS.monitoring);
    expect(classifyUserAgent("pingdom.com_bot")).toBe(UA_CLASS.monitoring);
    expect(classifyUserAgent("")).toBe(UA_CLASS.bot);
    expect(classifyUserAgent(undefined)).toBe(UA_CLASS.bot);
  });

  it("keeps exclusion helpers aligned with the funnel rule", () => {
    expect(isExcludedUaClass(UA_CLASS.browser)).toBe(false);
    expect(isExcludedUaClass(UA_CLASS.bot)).toBe(true);
    expect(isExcludedUaClass(UA_CLASS.monitoring)).toBe(true);
    expect(isExcludedUaClass(UA_CLASS.internal)).toBe(true);
    expect(isExcludedInternalMarker(INTERNAL_MARKER.none)).toBe(false);
    expect(isExcludedInternalMarker(INTERNAL_MARKER.preview)).toBe(true);
    expect(isExcludedInternalMarker(INTERNAL_MARKER.staff)).toBe(true);
    expect(isExcludedInternalMarker(INTERNAL_MARKER.healthcheck)).toBe(true);
  });

  it("validates fixed vocabularies and visit ids", () => {
    expect(isRefererClass("relevant")).toBe(true);
    expect(isRefererClass("search")).toBe(false);
    expect(isUtmSourceClass("not_relevant")).toBe(true);
    expect(isUtmSourceClass("internal")).toBe(false);
    expect(isUaClass("browser")).toBe(true);
    expect(isUaClass("desktop")).toBe(false);
    expect(isInternalMarker("none")).toBe(true);
    expect(isInternalMarker("internal")).toBe(false);
    expect(isVisitId("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isVisitId("0123456789ABCDEF0123456789ABCDEF")).toBe(false);
    expect(isVisitId("short")).toBe(false);
    expect(isVisitId(42)).toBe(false);
  });
});

describe("extractLandingRequestDimensions", () => {
  it("extracts request-time dimensions without persisting raw values", () => {
    const dimensions = extractLandingRequestDimensions({
      rawClientIp: "203.0.113.50",
      referer: "https://hh.ru/search",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126",
      requestUrl:
        "https://recruiter-radar.ru/?utm_source=telegram&rr_internal=preview",
    });

    expect(dimensions.refererClass).toBe("relevant");
    expect(dimensions.utmSourceClass).toBe("relevant");
    expect(dimensions.uaClass).toBe(UA_CLASS.browser);
    expect(dimensions.internalMarker).toBe(INTERNAL_MARKER.preview);
    expect(dimensions.visitId).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(dimensions)).not.toContain("hh.ru");
    expect(JSON.stringify(dimensions)).not.toContain("telegram");
  });

  it("ignores unknown internal markers and keeps the visit measurable", () => {
    const dimensions = extractLandingRequestDimensions({
      rawClientIp: "203.0.113.51",
      referer: null,
      userAgent: null,
      requestUrl: "https://recruiter-radar.ru/?rr_internal=mystery",
    });

    expect(dimensions.internalMarker).toBe(INTERNAL_MARKER.none);
    expect(dimensions.utmSourceClass).toBe("unknown");
    expect(dimensions.uaClass).toBe(UA_CLASS.bot);
  });

  it("returns null visit id when no trusted ip is available", () => {
    const dimensions = extractLandingRequestDimensions({
      rawClientIp: null,
      referer: null,
      userAgent: "Mozilla/5.0",
      requestUrl: "https://recruiter-radar.ru/",
    });

    expect(dimensions.visitId).toBeNull();
  });
});
