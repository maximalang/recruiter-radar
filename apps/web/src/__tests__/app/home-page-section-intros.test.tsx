import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";

import HomePage, { PreviewSection } from "@/app/page";
import { NoticeBox, SectionIntro } from "@/app/ui/page-primitives";
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
    // The live preview is now an async <PreviewSection> behind a <Suspense>
    // boundary (the home page is `force-dynamic` and the digest query blocked
    // the whole render — see page.tsx). HomePage's static tree no longer
    // contains the preview's children, so we render both halves and combine:
    // HomePage renders Проблема / Как работает / Проверка сигнала / Тарифы /
    // FAQ (5 SectionIntros), PreviewSection renders Интерактивный пример
    // (1) — six total. The duplicate "Что внутри" block must not return.
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const preview = await PreviewSection({
      previewInput: readPublicPreviewInput({}),
      hasPreview: false,
      checkoutHref: buildCheckoutHref(readPublicPreviewInput({})),
    });
    const sectionIntros = [
      ...collectElements(page, SectionIntro),
      ...collectElements(preview, SectionIntro),
    ];

    expect(sectionIntros).toHaveLength(6);
    expect(sectionIntros.every((section) => section.props.accent === true)).toBe(true);
    expect(sectionIntros.map((section) => section.props.eyebrow)).toEqual([
      "Проблема",
      "Как работает",
      "Проверка сигнала",
      "Тарифы",
      "FAQ",
      "Интерактивный пример",
    ]);
  });

  it("keeps the hero concise and makes the pilot the obvious first decision", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = readVisibleText(page);
    const pricingIntro = collectElements(page, SectionIntro)
      .find((section) => section.props.eyebrow === "Тарифы");

    expect(pageText).toContain("Компании, которым стоит написать сегодня. С доказательствами.");
    expect(pricingIntro?.props.title).toBe("Начните с недели. Продолжайте, только если радар полезен.");
    expect(pricingIntro?.props.description).toContain("Пилот — разовая оплата без продления.");
    expect(pageText).toContain("Проверьте новый канал за 7 дней");
    expect(pageText).not.toContain("0 автоспама");
    expect(pageText).not.toContain("Один радар — на неделю, месяц или квартал");
  });

  it("labels the resilient fallback as demo instead of personalized live data", async () => {
    mockGetPublicSampleDigestState.mockResolvedValueOnce({
      isLive: false,
      isPersonalized: false,
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
    const previewIntro = collectElements(preview, SectionIntro)
      .find((section) => section.props.eyebrow === "Интерактивный пример");

    expect(previewIntro?.props.title).toBe("Проверьте радар на своём профиле");
    expect(previewText).toContain("Демонстрационный радар");
    expect(previewText).not.toContain("Радар для вашего профиля");
    expect(previewText).not.toContain("временно недоступна");
    expect(previewText).not.toContain("восстановления источника");
    expect(previewText).toContain("Получить актуальный радар");
    expect(previewIntro?.props.description).toBe(
      "Укажите специализацию и географию, чтобы увидеть логику отбора. Ниже — демонстрационные карточки в формате реального утреннего радара.",
    );
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
    expect(forms[0].props.action).toBe("/#preview");
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

    expect(pageText).toContain("Сигнал проходит четыре проверки");
    expect(pageText.match(/Производственная компания/g)).toHaveLength(1);
  });
});
