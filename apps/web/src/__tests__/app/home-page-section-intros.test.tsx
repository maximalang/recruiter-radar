import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";

import HomePage, { PreviewSection, PreviewSkeleton } from "@/app/page";
import LandingHeader from "@/app/landing-header";
import LandingMethodology from "@/app/landing-methodology";
import { SectionIntro } from "@/app/ui/page-primitives";
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

function makePreviewItem(overrides: Partial<PreviewItem> = {}): PreviewItem {
  return {
    rank: 1,
    org_id: "demo-industrial",
    hh_employer_id: "demo-industrial",
    employer_name: "Производственная компания",
    vacancies_count: 14,
    distinct_vacancy_names_count: 6,
    latest_published_at: "2026-07-31T09:00:00.000Z",
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

  it("uses one deliberate editorial sequence", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const intros = collectElements(page, SectionIntro);

    expect(intros).toHaveLength(6);
    expect(intros.every((section) => section.props.accent === true)).toBe(true);
    expect(intros.map((section) => section.props.eyebrow)).toEqual([
      "Почему обычный поиск не работает",
      "Как работает радар",
      "Продукт в работе",
      "Evidence-first",
      "Для рекрутинговых агентств",
      "Вопросы",
    ]);
    expect(collectElements(page, "section").some((section) => section.props.id === "pricing")).toBe(false);
  });

  it("places navigation before main content and keeps preview anchors stable", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const children = Children.toArray((page as ReactElement<{ children?: ReactNode }>).props.children);
    const previewWrapper = collectElements(page, "section").find((section) => section.props.id === "preview");
    const skeletonMarkup = renderToStaticMarkup(<PreviewSkeleton />);
    const headerIndex = children.findIndex((child) => isValidElement(child) && child.type === LandingHeader);
    const mainIndex = children.findIndex((child) =>
      isValidElement<Record<string, any>>(child) && child.type === "section" && child.props.id === "main-content"
    );

    expect(previewWrapper?.props["data-section"]).toBe("preview");
    expect(skeletonMarkup).toContain('id="preview-configurator"');
    expect(skeletonMarkup).toContain('id="preview-results"');
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(mainIndex).toBeGreaterThan(headerIndex);
  });

  it("keeps activation honest while payment is unavailable", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = readVisibleText(page);
    const finalCta = collectElements(page, "section").find(
      (section) => section.props["data-final-cta"] === "true",
    );

    expect(pageText).toContain("Находите компании, которым нужен подбор — до массового отклика агентств");
    expect(pageText).toContain("Обезличенный пример");
    expect(pageText).toContain("заявка без списания, профиль сохранится");
    expect(pageText).toContain("Оставить заявку на пилот");
    expect(pageText).not.toContain("Оплата через ЮKassa");
    expect(pageText).not.toContain("14 990 ₽/мес");
    expect(collectElements(finalCta, Link)).toHaveLength(1);
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
    expect(previewText).toContain("Попробовать неделю");
  });

  it("keeps analytics aligned with preview and checkout transitions", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const anchors = collectElements(page, "a");
    const links = collectElements(page, Link);
    const heroPrimary = anchors.find((anchor) => anchor.props.href === "#preview-configurator");
    const heroExample = anchors.find((anchor) => anchor.props.href === "#opportunity-example");
    const trackedLinks = links.filter((link) => link.props["data-analytics-event"]);

    expect(heroPrimary?.props["data-analytics-event"]).toBe(LANDING_ANALYTICS_EVENT.previewStarted);
    expect(heroPrimary?.props["data-analytics-context"]).toBe(LANDING_ANALYTICS_CONTEXT.heroPrimary);
    expect(heroExample?.props["data-analytics-event"]).toBe(LANDING_ANALYTICS_EVENT.previewResultsClicked);
    expect(heroExample?.props["data-analytics-context"]).toBe(LANDING_ANALYTICS_CONTEXT.heroSecondary);
    expect(trackedLinks.some((link) => link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.checkoutStarted)).toBe(true);
    expect(trackedLinks.some((link) => link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.continuationCtaClicked)).toBe(false);
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
    expect(previewMarkup.match(/<details(?=[^>]*data-lead-card="true")(?=[^>]*open="")[^>]*>/g)).toHaveLength(1);
    expect(previewMarkup).toContain("Рекомендация на сегодня");
    expect(previewMarkup).toContain("Почему сейчас");
    expect(previewMarkup).toContain("Факты и источники");
    expect(previewMarkup).toContain("Следующий шаг");
  });

  it("explains all four quality dimensions without an interaction tax", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const methodologies = collectElements(page, LandingMethodology);
    const methodologyMarkup = renderToStaticMarkup(<LandingMethodology />);

    expect(methodologies).toHaveLength(1);
    expect(methodologyMarkup).toContain("Из чего складывается Radar Score");
    expect(methodologyMarkup).toContain("Fit");
    expect(methodologyMarkup).toContain("Intent");
    expect(methodologyMarkup).toContain("Urgency");
    expect(methodologyMarkup).toContain("Reachability");
    expect(methodologyMarkup).not.toContain("<button");
  });
});
