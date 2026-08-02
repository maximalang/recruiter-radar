import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";

import HomePage from "@/app/page";
import ScrollReveal from "@/app/scroll-reveal";
import { SectionIntro } from "@/app/ui/page-primitives";
import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "@/lib/landing-analytics-contract";
import { getPublicSampleDigestState } from "@/lib/publicProduct";

jest.mock("@/lib/payments", () => ({
  getPaymentProviderSetupState: () => ({ configured: false }),
}));

jest.mock("@/lib/publicProduct", () => {
  const actual = jest.requireActual("@/lib/publicProduct");
  return { ...actual, getPublicSampleDigestState: jest.fn() };
});

const mockGetPublicSampleDigestState = getPublicSampleDigestState as jest.MockedFunction<
  typeof getPublicSampleDigestState
>;

function collectElements(node: ReactNode, type: unknown): ReactElement<Record<string, any>>[] {
  const matches: ReactElement<Record<string, any>>[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<Record<string, any>>(child)) return;
    if (child.type === type) matches.push(child);
    matches.push(...collectElements(child.props.children, type));
  });
  return matches;
}

function readVisibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  const parts: string[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement<{ children?: ReactNode }>(child)) {
      parts.push(readVisibleText(child.props.children));
    } else if (typeof child === "string" || typeof child === "number") {
      parts.push(String(child));
    }
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

describe("evidence-first landing v2 contract", () => {
  beforeEach(() => {
    mockGetPublicSampleDigestState.mockResolvedValue({
      isLive: false,
      isPersonalized: false,
      hasExactMatches: true,
      items: [],
    });
  });

  it("uses a short editorial sequence instead of pricing and feature-card sprawl", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const intros = collectElements(page, SectionIntro);

    expect(intros.map((intro) => intro.props.eyebrow)).toEqual([
      "Что меняется",
      "Продукт в работе",
      "Стандарт доказательств",
      "Рабочий ритм",
      "Вопросы",
    ]);
    expect(collectElements(page, "section").some((section) => section.props.id === "pricing")).toBe(false);
  });

  it("explains the product in one h1 and shows a dated, sourced opportunity above the fold", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = readVisibleText(page);

    expect(collectElements(page, "h1")).toHaveLength(1);
    expect(pageText).toContain("Компании, которым нужен подбор. До того, как это станет очевидно всем.");
    expect(pageText).toContain("Обезличенный пример");
    expect(pageText).toContain("31 июля 2026");
    expect(pageText).toContain("Карьерная страница");
    expect(pageText).toContain("hh.ru");
    expect(pageText).toContain("Следующий шаг");
    expect(pageText).not.toContain("Пауза");
    expect(collectElements(page, "canvas")).toHaveLength(0);
  });

  it("makes the agency audience and the daily decision rhythm explicit", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = readVisibleText(page);
    const deliverySection = collectElements(page, ScrollReveal)
      .find((section) => section.props.id === "delivery");
    const deliveryText = readVisibleText(deliverySection);

    expect(pageText).toContain("Для рекрутинговых агентств");
    expect(deliverySection).toBeDefined();
    expect(deliveryText).toContain("Радар проверяет рынок до начала рабочего дня");
    expect(deliveryText).toContain("Команда выбирает следующий шаг");
    expect(deliveryText).toContain("Ни одного автоматического сообщения");
  });

  it("keeps the real preview path and ends with one primary activation action", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const anchors = collectElements(page, "a");
    const finalCta = collectElements(page, "section")
      .find((section) => section.props["data-final-cta"] === "true");
    const finalLinks = collectElements(finalCta, Link);

    const heroPrimary = anchors.find((anchor) => anchor.props.href === "#preview-configurator");
    expect(heroPrimary?.props["data-analytics-event"]).toBe(LANDING_ANALYTICS_EVENT.previewStarted);
    expect(heroPrimary?.props["data-analytics-context"]).toBe(LANDING_ANALYTICS_CONTEXT.heroPrimary);
    expect(finalCta).toBeDefined();
    expect(finalLinks).toHaveLength(1);
    expect(finalLinks[0].props["data-analytics-event"]).toBe(LANDING_ANALYTICS_EVENT.checkoutStarted);
    expect(finalLinks[0].props["data-analytics-context"]).toBe(LANDING_ANALYTICS_CONTEXT.closing);
  });
});
