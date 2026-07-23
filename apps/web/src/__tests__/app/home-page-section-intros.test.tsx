import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";

import HomePage, { PreviewSection, PreviewSkeleton } from "@/app/page";
import LandingDeliveryDemo from "@/app/landing-delivery-demo";
import LandingMethodology from "@/app/landing-methodology";
import { NoticeBox, SectionIntro, SurfaceCard } from "@/app/ui/page-primitives";
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

  return {
    ...actual,
    getPublicSampleDigestState: jest.fn(),
  };
});

const mockGetPublicSampleDigestState = getPublicSampleDigestState as jest.MockedFunction<
  typeof getPublicSampleDigestState
>;

function collectElements(node: ReactNode, type: unknown): React.ReactElement[] {
  const matches: React.ReactElement[] = [];

  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === type) matches.push(child);
    matches.push(...collectElements(child.props.children, type));
  });

  return matches;
}

function readVisibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);

  const parts: string[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement(child)) parts.push(readVisibleText(child.props.children));
    else if (typeof child === "string" || typeof child === "number") parts.push(String(child));
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
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
    // The stable preview wrapper and heading live outside Suspense. This keeps
    // the anchor and section hierarchy available while Postgres is still
    // resolving the real form/results workspace.
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

  it("keeps the preview wrapper stable and exposes both CTA anchors during Suspense", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const previewWrapper = collectElements(page, "section")
      .find((section) => section.props.id === "preview");
    const anchorHrefs = collectElements(page, "a").map((anchor) => anchor.props.href);
    const skeletonMarkup = renderToStaticMarkup(<PreviewSkeleton />);

    expect(previewWrapper).toBeDefined();
    expect(previewWrapper?.props["data-section"]).toBe("preview");
    expect(skeletonMarkup).toContain('id="preview-configurator"');
    expect(skeletonMarkup).toContain('id="preview-results"');
    expect(anchorHrefs).toContain("#preview-configurator");
    expect(anchorHrefs).toContain("#preview-results");
  });

  it("keeps the hero concise and makes the pilot the obvious first decision", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = readVisibleText(page);
    const alignedPlanCards = collectElements(page, SurfaceCard)
      .filter((card) => card.props.padding === "var(--plan-card-padding)");
    const pricingIntro = collectElements(page, SectionIntro)
      .find((section) => section.props.eyebrow === "Тарифы");

    expect(pageText).toContain("Компании, которым стоит написать сегодня. С доказательствами.");
    expect(pricingIntro?.props.title).toBe("Начните с недели. Продолжайте, только если радар полезен.");
    expect(pricingIntro?.props.description).toContain("Пилот — разовая оплата без продления.");
    expect(pageText).toContain("Проверьте новый канал за 7 дней");
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

  it("explains the role and delivery status of every source group", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = readVisibleText(page);
    const deliveryMarkup = renderToStaticMarkup(<LandingDeliveryDemo />);

    expect(pageText).toContain("Каждый источник отвечает за свою часть доказательства");
    expect(pageText).toContain("Источники клиентской выдачи");
    expect(pageText).toContain("hh.ru, Работа России и прямые карьерные страницы");
    expect(pageText).toContain("Компания и путь контакта");
    expect(pageText).toContain("Сайт компании и ЕГРЮЛ/ФНС");
    expect(pageText).toContain("Почему сейчас");
    expect(pageText).toContain("Корпоративные события, официальные публикации и отраслевой контекст");
    expect(pageText).toContain("Что пока не попадает в клиентскую выдачу");
    expect(pageText).toContain("SuperJob, Хабр Карьера, страницы компаний LinkedIn");
    expect(pageText).toContain("проверки уверенности, качества данных и правомерности доступа");
    expect(deliveryMarkup).toContain("Telegram");
    expect(deliveryMarkup).toContain("Email");
    expect(deliveryMarkup).toContain("Web push");
    expect(deliveryMarkup).toContain("VK");
    expect(deliveryMarkup).toContain("Webhook");
  });

  it("keeps filter submit and reset actions anchored to the preview", async () => {
    const input = readPublicPreviewInput({ specialization: "инженерный подбор" });
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: hasPublicPreviewInput(input),
      checkoutHref: buildCheckoutHref(input),
    });
    const forms = collectElements(preview, "form");
    const links = collectElements(preview, Link);
    const resetLink = links.find((link) => readVisibleText(link) === "Сбросить");

    expect(forms).toHaveLength(1);
    expect(forms[0].props.action).toBe("/#preview-results");
    expect(resetLink?.props.href).toBe("/#preview");
  });

  it("constrains the public profile fields before submission", async () => {
    const input = readPublicPreviewInput({});
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: hasPublicPreviewInput(input),
      checkoutHref: buildCheckoutHref(input),
    });
    const inputs = collectElements(preview, "input");
    const specialization = inputs.find((input) => input.props.name === "specialization");
    const targetCity = inputs.find((input) => input.props.name === "targetCity");

    expect(specialization?.props.maxLength).toBe(160);
    expect(targetCity?.props.maxLength).toBe(120);
  });

  it("renders lead cards as a scannable list with one recommendation expanded", async () => {
    mockGetPublicSampleDigestState.mockResolvedValueOnce({
      isLive: false,
      isPersonalized: false,
      hasExactMatches: true,
      items: [{
        rank: 1,
        org_id: "demo-industrial",
        employer_name: "Производственная компания",
        vacancies_count: 14,
        distinct_vacancy_names_count: 6,
        latest_published_at: "2026-07-19T09:00:00.000Z",
        total_score: 348,
        reasons: ["14 новых вакансий за 6 дней"],
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
      }, {
        rank: 2,
        org_id: "demo-service",
        employer_name: "Сервисная B2B-компания",
        vacancies_count: 9,
        distinct_vacancy_names_count: 5,
        latest_published_at: "2026-07-18T09:00:00.000Z",
        total_score: 312,
        reasons: ["Команда найма расширяет коммерческий блок"],
        opener: "Уточнить приоритетные роли и предложить короткий пилот",
        source_families: ["career-pages", "egrul-fns"],
        evidence_titles: ["Руководитель отдела продаж", "Менеджер по развитию"],
        candidate_source_keys: ["demo:career", "demo:egrul"],
        location_names: ["Санкт-Петербург"],
        confidence_gate: "B",
        confidenceLabel: "medium",
        sourceCount: 2,
        sourceKeys: ["demo:career", "demo:egrul"],
        structuredSignalCount: 2,
        curationLabels: [],
        lawfulContactPath: "career-page",
        negativeSignals: [],
        relevanceSignals: { fit: 0, intent: 0, urgency: 0, reachability: 0 },
      }],
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
    // The fake "column header" row above the dark lead cards was removed for a
    // cleaner, more premium read — each card self-labels its own rows.
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
    expect(methodologyMarkup).toContain("Сигнал проходит четыре проверки");
    expect(pageText.match(/Производственная компания/g)).toHaveLength(1);
  });
});
