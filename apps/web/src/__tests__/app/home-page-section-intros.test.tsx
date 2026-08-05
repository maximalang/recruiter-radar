import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import HomePage, { PreviewSection, PreviewSkeleton } from "@/app/home-page-content";
import ConversionPanel from "@/app/landing/conversion-panel";
import DetectionScene from "@/app/landing/detection-scene";
import EvidenceScene from "@/app/landing/evidence-scene";
import LandingHeader from "@/app/landing/landing-header";
import OutreachScene from "@/app/landing/outreach-scene";
import SignalTimelineScene from "@/app/landing/signal-timeline-scene";
import WorkspaceScene from "@/app/landing/workspace-scene";
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
    relevanceSignals: { fit: 0.88, intent: 0.84, urgency: 0.94, reachability: 0.82 },
    ...overrides,
  };
}

describe("signal lock landing contract", () => {
  beforeEach(() => {
    mockGetPublicSampleDigestState.mockResolvedValue({
      isLive: true,
      isPersonalized: false,
      hasExactMatches: true,
      items: [],
    });
  });

  it("composes five connected scenes without the legacy marketing-section stack", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });

    expect(collectElements(page, LandingHeader)).toHaveLength(1);
    expect(collectElements(page, DetectionScene)).toHaveLength(1);
    expect(collectElements(page, SignalTimelineScene)).toHaveLength(1);
    expect(collectElements(page, EvidenceScene)).toHaveLength(1);
    expect(collectElements(page, OutreachScene)).toHaveLength(1);
    expect(collectElements(page, WorkspaceScene)).toHaveLength(1);
    expect(collectElements(page, "main").find((main) => main.props.id === "main-content")).toBeDefined();
  });

  it("explains the product in the first scene and preserves hero analytics", () => {
    const markup = renderToStaticMarkup(<DetectionScene previewHref="#preview-configurator" />);

    expect(markup).toContain("Кому написать сегодня");
    expect(markup).toContain("видно по сигналам");
    expect(markup).toContain("Для рекрутинговых агентств");
    expect(markup).toContain("Получить пример");
    expect(markup).toContain('data-landing-scene="detection"');
    expect(markup).toContain(`data-analytics-event="${LANDING_ANALYTICS_EVENT.previewStarted}"`);
    expect(markup).toContain(`data-analytics-context="${LANDING_ANALYTICS_CONTEXT.heroPrimary}"`);
    expect(markup).not.toContain("data-hero-tilt");
  });

  it("uses one opportunity across signal, evidence and manual outreach scenes", () => {
    const timeline = renderToStaticMarkup(<SignalTimelineScene />);
    const evidence = renderToStaticMarkup(<EvidenceScene />);
    const outreach = renderToStaticMarkup(<OutreachScene />);

    for (const markup of [timeline, evidence, outreach]) {
      expect(markup).toContain("Производственная компания");
    }
    expect(timeline).toContain("Последовательность");
    expect(evidence).toContain("RADAR SCORE");
    expect(evidence).toContain("Доказательная база");
    expect(outreach).toContain("Черновик · не отправлено");
    expect(outreach).toContain("сигнал найма");
    expect(outreach).toContain("не отправляет сообщения компаниям автоматически");
    expect(outreach).not.toContain("частный email");
  });

  it("keeps the Suspense fallback busy without duplicating final hash anchors", () => {
    const markup = renderToStaticMarkup(<PreviewSkeleton />);
    expect(markup).toContain("data-preview-fallback");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain('id="scene-workspace"');
    expect(markup).not.toContain('id="preview-configurator"');
    expect(markup).not.toContain('id="preview-results"');
  });

  it("labels resilient preview data honestly and keeps checkout available", async () => {
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
    const text = readVisibleText(preview);

    expect(text).toContain("Обезличенный набор");
    expect(text).toContain("Радар для вашего профиля");
    expect(text).toContain("примерные данные");
    expect(text).toContain("Попробовать неделю");
    expect(text).not.toContain("восстановления источника");
  });

  it("keeps filter, reset and public input limits wired", async () => {
    const input = readPublicPreviewInput({ specialization: "инженерный подбор" });
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: true,
      checkoutHref: buildCheckoutHref(input),
    });
    const forms = collectElements(preview, "form");
    const links = collectElements(preview, Link);
    const inputs = collectElements(preview, "input");

    expect(forms).toHaveLength(1);
    expect(forms[0].props.action).toBe("/#preview-results");
    expect(links.find((link) => readVisibleText(link) === "Сбросить")?.props.href).toBe("/#scene-workspace");
    expect(inputs.find((input) => input.props.name === "specialization")?.props.maxLength).toBe(160);
    expect(inputs.find((input) => input.props.name === "targetCity")?.props.maxLength).toBe(120);
  });

  it("renders an evidence-backed lead list with one emphasized recommendation", async () => {
    mockGetPublicSampleDigestState.mockResolvedValueOnce({
      isLive: false,
      isPersonalized: false,
      hasExactMatches: true,
      items: [
        makePreviewItem(),
        makePreviewItem({ rank: 2, org_id: "demo-service", employer_name: "Сервисная B2B-компания" }),
      ],
    });
    const input = readPublicPreviewInput({});
    const preview = await PreviewSection({ previewInput: input, hasPreview: false, checkoutHref: buildCheckoutHref(input) });
    const markup = renderToStaticMarkup(preview);

    expect(markup.match(/data-lead-card="true"/g)).toHaveLength(2);
    expect(markup.match(/name="preview-leads"/g)).toHaveLength(2);
    expect(markup.match(/<details(?=[^>]*data-lead-card="true")(?=[^>]*open="")[^>]*>/g)).toHaveLength(1);
    expect(markup.match(/data-primary-lead="true"/g)).toHaveLength(1);
    expect(markup).toContain("Почему сейчас");
    expect(markup).toContain("Факты и источники");
    expect(markup).toContain("Без автоматической отправки");
    expect(markup).toContain("Совпадение");
    expect(markup).toContain("Срочность");
  });

  it("keeps payment-state copy and checkout analytics in the conversion panel", () => {
    const input = readPublicPreviewInput({});
    const panel = ConversionPanel({
      previewInput: input,
      paymentConfigured: false,
      faqItems: [{ question: "Как работает?", answer: "По проверяемым сигналам." }],
    });
    const text = readVisibleText(panel);
    const links = collectElements(panel, Link);

    expect(text).toContain("Сейчас пилот оформляется как заявка без списания");
    expect(text).toContain("Оставить заявку на неделю");
    expect(text).toContain("Вернуться к настройке выдачи");
    expect(text).not.toContain("Оплата через ЮKassa");
    expect(links.some((link) => link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.checkoutStarted)).toBe(true);
    expect(links.some((link) => link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.continuationCtaClicked)).toBe(true);
  });

  it("keeps motion CSS-only, reduced-motion complete and detached from legacy landing styles", () => {
    const css = readFileSync(resolve(process.cwd(), "app/landing/landing.module.css"), "utf8");
    const corrections = readFileSync(resolve(process.cwd(), "app/landing/landing-corrections.module.css"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "app/home-page-content.tsx"), "utf8");
    const layout = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(corrections).toContain("--landing-header-height");
    expect(corrections).toContain("scroll-margin-top");
    expect(corrections).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).not.toContain("requestAnimationFrame");
    expect(page).not.toContain("home-page-components.module.css");
    expect(layout).not.toContain("landing-cinematic.css");
    expect(layout).not.toContain("landing-cinematic-refinements.css");
  });
});
