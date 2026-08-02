import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";

import HomePage, { PreviewSection, PreviewSkeleton } from "@/app/home-page-content";
import LandingDeliveryDemo from "@/app/landing-delivery-demo";
import LandingHeader from "@/app/landing-header";
import LandingMethodology from "@/app/landing-methodology";
import LandingSourceArchitecture from "@/app/landing-source-architecture";
import { SectionIntro, SurfaceCard } from "@/app/ui/page-primitives";
import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "@/lib/landing-analytics-contract";
import {
  buildCheckoutHref,
  getPublicSampleDigestState,
  hasPublicPreviewInput,
  readPublicPreviewInput,
} from "@/lib/publicProduct";

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

type PreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

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

function getLandingChildren(page: ReactElement): ReactNode[] {
  const frameChildren = Children.toArray(
    (page as ReactElement<{ children?: ReactNode }>).props.children,
  );
  const motionShell = frameChildren.find((child) => isValidElement(child));
  if (!isValidElement<{ children?: ReactNode }>(motionShell)) return [];
  return Children.toArray(motionShell.props.children);
}

function makePreviewItem(overrides: Partial<PreviewItem> = {}): PreviewItem {
  return {
    rank: 1,
    org_id: "demo-industrial",
    hh_employer_id: "demo-industrial",
    employer_name: "Производственная компания",
    vacancies_count: 14,
    distinct_vacancy_names_count: 6,
    latest_published_at: "2026-07-19T09:00:00.000Z",
    total_score: 348,
    reasons: ["14 новых вакансий за 6 дней", "Сигнал подтверждён двумя источниками"],
    opener: "Предложить точечный подбор по инженерным ролям",
    source_families: ["hh", "career-pages"],
    evidence_titles: ["Инженер-конструктор", "Руководитель производства"],
    candidate_source_keys: ["demo:hh", "demo:career"],
    location_names: ["Москва и область"],
    confidence_gate: "A",
    confidenceLabel: "high",
    sourceCount: 2,
    sourceKeys: ["demo:hh", "demo:career"],
    structuredSignalCount: 2,
    curationLabels: [],
    lawfulContactPath: "career-page",
    negativeSignals: [],
    relevanceSignals: { fit: 0, intent: 0, urgency: 0, reachability: 0 },
    ...overrides,
  };
}

describe("landing section hierarchy", () => {
  beforeEach(() => {
    mockGetPublicSampleDigestState.mockResolvedValue({
      isLive: true,
      isPersonalized: false,
      hasExactMatches: true,
      items: [],
    });
  });

  it("uses the brand-accent eyebrow on every public landing section", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const sectionIntros = collectElements(page, SectionIntro);

    expect(sectionIntros).toHaveLength(6);
    expect(sectionIntros.every((section) => section.props.accent === true)).toBe(true);
    expect(sectionIntros.map((section) => section.props.eyebrow)).toEqual([
      "Проблема",
      "Рабочий радар",
      "Как работает",
      "Проверка сигнала",
      "Тарифы",
      "FAQ",
    ]);
  });

  it("places navigation before main content and keeps preview anchors stable", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const previewWrapper = collectElements(page, "section")
      .find((section) => section.props.id === "preview");
    const anchorHrefs = collectElements(page, "a").map((anchor) => anchor.props.href);
    const skeletonMarkup = renderToStaticMarkup(<PreviewSkeleton />);
    const landingChildren = getLandingChildren(page);
    const headerIndex = landingChildren.findIndex(
      (child) => isValidElement(child) && child.type === LandingHeader,
    );
    const mainIndex = landingChildren.findIndex(
      (child) => isValidElement<Record<string, any>>(child)
        && child.type === "section"
        && child.props.id === "main-content",
    );

    expect(previewWrapper).toBeDefined();
    expect(previewWrapper?.props["data-section"]).toBe("preview");
    expect(skeletonMarkup).toContain('id="preview-configurator"');
    expect(skeletonMarkup).toContain('id="preview-results"');
    expect(anchorHrefs).toContain("#preview-configurator");
    expect(anchorHrefs).toContain("#preview-results");
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(mainIndex).toBeGreaterThan(headerIndex);
  });

  it("keeps the hero concise and makes the unavailable-payment state explicit", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = readVisibleText(page);
    const alignedPlanCards = collectElements(page, SurfaceCard)
      .filter((card) => card.props.padding === "var(--plan-card-padding)");
    const pricingIntro = collectElements(page, SectionIntro)
      .find((section) => section.props.eyebrow === "Тарифы");

    expect(pageText).toContain("Компании, которым стоит написать сегодня. С доказательствами.");
    expect(pricingIntro?.props.title).toBe("Начните с недели. Продолжайте, только если радар полезен.");
    expect(pricingIntro?.props.description).toContain("Сейчас пилот оформляется как заявка без списания.");
    expect(pageText).toContain("Проверьте новый канал за 7 дней");
    expect(pageText).toContain("Оставить заявку на неделю");
    expect(pageText).toContain("Сейчас заявка сохраняется без списания");
    expect(pageText).not.toContain("Оплата через ЮKassa");
    expect(alignedPlanCards).toHaveLength(3);
    expect(pageText).not.toContain("0 автоспама");
    expect(pageText).not.toContain("Один радар — на неделю, месяц или квартал");
  });

  it("labels the resilient fallback as a personalized sample instead of live data", async () => {
    mockGetPublicSampleDigestState.mockResolvedValueOnce({
      isLive: false,
      isPersonalized: true,
      hasExactMatches: true,
      items: [],
    });
    const input = readPublicPreviewInput({ specialization: "инженерный подбор" });
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: hasPublicPreviewInput(input),
      checkoutHref: buildCheckoutHref(input),
    });
    const previewText = readVisibleText(preview);

    expect(previewText).toContain("Обезличенный набор");
    expect(previewText).toContain("Радар для вашего профиля");
    expect(previewText).toContain("примерные данные");
    expect(previewText).not.toContain("временно недоступна");
    expect(previewText).not.toContain("восстановления источника");
    expect(previewText).toContain("Попробовать неделю");
  });

  it("keeps CTA analytics aligned with the real funnel transition", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const anchors = collectElements(page, "a");
    const links = collectElements(page, Link);
    const heroPrimary = anchors.find((anchor) => anchor.props.href === "#preview-configurator");
    const heroResults = anchors.find((anchor) => anchor.props.href === "#preview-results");
    const trackedLinks = links.filter((link) => link.props["data-analytics-event"]);

    expect(heroPrimary?.props["data-analytics-event"]).toBe(LANDING_ANALYTICS_EVENT.previewStarted);
    expect(heroPrimary?.props["data-analytics-context"]).toBe(LANDING_ANALYTICS_CONTEXT.heroPrimary);
    expect(heroResults?.props["data-analytics-context"]).toBe(LANDING_ANALYTICS_CONTEXT.heroSecondary);
    expect(heroResults?.props["data-analytics-event"]).toBe(LANDING_ANALYTICS_EVENT.previewResultsClicked);
    expect(trackedLinks.some((link) =>
      link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.checkoutStarted
    )).toBe(true);
    expect(trackedLinks.some((link) =>
      link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.continuationCtaClicked
    )).toBe(true);
    expect(trackedLinks.some((link) =>
      link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.continuationRequested
    )).toBe(false);
    expect(trackedLinks.some((link) =>
      link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.paymentStarted
    )).toBe(false);
  });

  it("explains verification without exposing internal backlog or unready channels", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const deliveryMarkup = renderToStaticMarkup(<LandingDeliveryDemo />);
    const sourceMarkup = renderToStaticMarkup(<LandingSourceArchitecture />);

    expect(collectElements(page, LandingSourceArchitecture)).toHaveLength(1);
    expect(sourceMarkup).toContain("Почему рекомендация заслуживает внимания");
    expect(sourceMarkup).toContain("Находим реальное изменение в найме");
    expect(sourceMarkup).toContain("Подтверждаем компанию и силу сигнала");
    expect(sourceMarkup).toContain("Формируем понятный следующий шаг");
    expect(sourceMarkup).not.toContain("production-выдачи");
    expect(sourceMarkup).not.toContain("LinkedIn");
    expect(deliveryMarkup).toContain("Telegram");
    expect(deliveryMarkup).toContain("Email");
    expect(deliveryMarkup).not.toContain("Web push");
    expect(deliveryMarkup).not.toContain(">VK<");
    expect(deliveryMarkup).not.toContain("Webhook");
  });

  it("keeps filter/reset actions anchored and constrains public profile fields", async () => {
    const input = readPublicPreviewInput({ specialization: "инженерный подбор" });
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: hasPublicPreviewInput(input),
      checkoutHref: buildCheckoutHref(input),
    });
    const forms = collectElements(preview, "form");
    const links = collectElements(preview, Link);
    const inputs = collectElements(preview, "input");

    expect(forms).toHaveLength(1);
    expect(forms[0].props.action).toBe("/#preview-results");
    expect(links.find((link) => readVisibleText(link) === "Сбросить")?.props.href).toBe("/#preview");
    expect(inputs.find((input) => input.props.name === "specialization")?.props.maxLength).toBe(160);
    expect(inputs.find((input) => input.props.name === "targetCity")?.props.maxLength).toBe(120);
  });

  it("renders lead cards as a scannable list with one recommendation expanded", async () => {
    mockGetPublicSampleDigestState.mockResolvedValueOnce({
      isLive: false,
      isPersonalized: false,
      hasExactMatches: true,
      items: [
        makePreviewItem(),
        makePreviewItem({
          rank: 2,
          org_id: "demo-service",
          hh_employer_id: "demo-service",
          employer_name: "Сервисная B2B-компания",
          total_score: 312,
          confidence_gate: "B",
          confidenceLabel: "medium",
          location_names: ["Санкт-Петербург"],
        }),
      ],
    });
    const input = readPublicPreviewInput({});
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: false,
      checkoutHref: buildCheckoutHref(input),
    });
    const previewMarkup = renderToStaticMarkup(preview);

    expect(previewMarkup.match(/data-lead-card="true"/g)).toHaveLength(2);
    expect(previewMarkup.match(/name="preview-leads"/g)).toHaveLength(2);
    expect(previewMarkup.match(/padding:var\(--preview-surface-padding\)/g)).toHaveLength(2);
    expect(previewMarkup).not.toContain('data-lead-columns="true"');
    expect(previewMarkup.match(/<details(?=[^>]*data-lead-card="true")(?=[^>]*open="")[^>]*>/g)).toHaveLength(1);
    expect(previewMarkup).toContain("Рекомендация на сегодня");
    expect(previewMarkup).toContain("Почему сейчас");
    expect(previewMarkup).toContain("Факты и источники");
    expect(previewMarkup).toContain("Следующий шаг");
    expect(previewMarkup).not.toContain("Проверка и источники");
  });

  it("explains the four quality checks without duplicating the hero company card", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = readVisibleText(page);
    const methodologies = collectElements(page, LandingMethodology);
    const methodologyMarkup = renderToStaticMarkup(<LandingMethodology />);

    expect(methodologies).toHaveLength(1);
    expect(methodologyMarkup).toContain("Баллы всегда можно объяснить");
    expect(methodologyMarkup).toContain("4 проверки · без чёрного ящика");
    expect(pageText.match(/Производственная компания/g)).toHaveLength(1);
  });
});
