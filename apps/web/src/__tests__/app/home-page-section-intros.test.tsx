import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import HomePage, { PreviewSection, PreviewSkeleton } from "@/app/home-page-content";
import ConversionPanel from "@/app/landing/conversion-panel";
import DeliveryScene from "@/app/landing/delivery-scene";
import DetectionScene from "@/app/landing/detection-scene";
import EvidenceScene from "@/app/landing/evidence-scene";
import LandingHeader from "@/app/landing/landing-header";
import OutreachScene from "@/app/landing/outreach-scene";
import SignalTimelineScene from "@/app/landing/signal-timeline-scene";
import WorkspaceScene, { WorkspaceResults } from "@/app/landing/workspace-scene";
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

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

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

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("final unified evidence-first landing contract", () => {
  beforeEach(() => {
    mockGetPublicSampleDigestState.mockReset();
    mockGetPublicSampleDigestState.mockResolvedValue({
      isLive: true,
      isPersonalized: false,
      hasExactMatches: true,
      items: [],
    });
  });

  it("keeps the required scene order and conversion outside workspace suspense", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    expect(collectElements(page, LandingHeader)).toHaveLength(1);
    expect(collectElements(page, DetectionScene)).toHaveLength(1);
    expect(collectElements(page, SignalTimelineScene)).toHaveLength(1);
    expect(collectElements(page, WorkspaceScene)).toHaveLength(1);
    expect(collectElements(page, EvidenceScene)).toHaveLength(1);
    expect(collectElements(page, DeliveryScene)).toHaveLength(1);
    expect(collectElements(page, OutreachScene)).toHaveLength(1);
    expect(collectElements(page, ConversionPanel)).toHaveLength(1);

    const landing = source("app/landing/landing-page.tsx");
    const expectedOrder = [
      "<DetectionScene",
      "<SignalTimelineScene",
      "<WorkspaceScene",
      "<EvidenceScene",
      "<DeliveryScene",
      "<OutreachScene",
      "<ConversionPanel",
      "<SiteFooter",
    ];
    let cursor = -1;
    for (const token of expectedOrder) {
      const next = landing.indexOf(token);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(landing).not.toContain("<Suspense");
  });

  it("keeps the workspace shell synchronous and only results asynchronous", () => {
    const workspace = source("app/landing/workspace-scene.tsx");
    expect(workspace).toContain("export default function WorkspaceScene");
    expect(workspace).toContain("function WorkspaceIntro");
    expect(workspace).toContain("function PreviewConfigurator");
    expect(workspace).toContain("export async function WorkspaceResults");
    expect(workspace).toContain("<Suspense fallback={<WorkspaceResultsSkeleton />}");
    expect(workspace.indexOf("<PreviewConfigurator")).toBeLessThan(workspace.indexOf("<Suspense"));
    expect(workspace.match(/getPublicSampleDigestState\(/g)).toHaveLength(1);
  });

  it("renders the static configurator and stable results target before data resolves", () => {
    const input = readPublicPreviewInput({ specialization: "инженерный подбор" });
    const preview = PreviewSection({
      previewInput: input,
      hasPreview: hasPublicPreviewInput(input),
      checkoutHref: buildCheckoutHref(input),
    });
    expect(preview.type).toBe(WorkspaceScene);

    const workspace = source("app/landing/workspace-scene.tsx");
    const configuratorCallIndex = workspace.indexOf("<PreviewConfigurator");
    const suspenseIndex = workspace.indexOf("<Suspense");
    expect(configuratorCallIndex).toBeGreaterThan(-1);
    expect(configuratorCallIndex).toBeLessThan(suspenseIndex);
    expect(workspace).toContain('id="preview-configurator"');
    expect(workspace).toContain('action="/#preview-results"');

    const skeleton = renderToStaticMarkup(<PreviewSkeleton />);
    expect(skeleton).toContain('id="preview-results"');
    expect(skeleton).toContain("data-preview-results-skeleton");
    expect(skeleton).toContain('aria-busy="true"');
  });

  it("fails open when preview data throws and preserves the next action", async () => {
    mockGetPublicSampleDigestState.mockRejectedValueOnce(new Error("database unavailable"));
    const input = readPublicPreviewInput({});
    const results = await WorkspaceResults({ previewInput: input, checkoutHref: buildCheckoutHref(input) });
    const markup = renderToStaticMarkup(results);
    expect(markup).toContain('id="preview-results"');
    expect(markup).toContain("data-preview-results-ready");
    expect(markup).toContain("Временная ошибка загрузки");
    expect(markup).toContain("Тарифы, FAQ и следующий шаг доступны ниже");
    expect(markup).toContain("Оставить заявку на неделю");
  });

  it("renders an evidence-backed lead list with one expanded recommendation", async () => {
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
    const results = await WorkspaceResults({ previewInput: input, checkoutHref: buildCheckoutHref(input) });
    const markup = renderToStaticMarkup(results);

    expect(markup.match(/data-lead-card="true"/g)).toHaveLength(2);
    expect(markup.match(/data-primary-lead="true"/g)).toHaveLength(1);
    expect(markup.match(/name="preview-leads"/g)).toHaveLength(2);
    expect(markup).toContain("Почему сейчас");
    expect(markup).toContain("Факты и источники");
    expect(markup).toContain("Без автоматической отправки");
  });

  it("keeps product copy, analytics and manual outreach boundary", () => {
    const hero = renderToStaticMarkup(<DetectionScene previewHref="#preview-configurator" />);
    const evidence = renderToStaticMarkup(<EvidenceScene />);
    const delivery = renderToStaticMarkup(<DeliveryScene />);
    const outreach = renderToStaticMarkup(<OutreachScene />);

    expect(hero).toContain("Кому написать сегодня");
    expect(hero).toContain("Получить пример");
    expect(hero).toContain(`data-analytics-event="${LANDING_ANALYTICS_EVENT.previewStarted}"`);
    expect(hero).toContain(`data-analytics-context="${LANDING_ANALYTICS_CONTEXT.heroPrimary}"`);
    expect(evidence).toContain("ОЦЕНКА РАДАРА");
    expect(evidence).toContain("ДОКАЗАТЕЛЬНАЯ БАЗА");
    expect(delivery).toContain("Recruiter Radar доставляет рекомендацию, но не отправляет сообщение компании");
    expect(outreach).toContain("ЧЕРНОВИК / НЕ ОТПРАВЛЕНО");
    expect(outreach).toContain("не отправляет сообщения компаниям автоматически");
  });

  it("keeps pricing data untouched and checkout analytics available", () => {
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
    expect(text).toContain("Перед запуском");
    expect(links.some((link) => link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.checkoutStarted)).toBe(true);
    expect(links.some((link) => link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.continuationCtaClicked)).toBe(true);
  });

  it("prevents regression to corrective layers, compass labels and sweep", () => {
    const heroInstrument = source("app/landing/hero-instrument.tsx");
    const reducedMotionCss = [
      source("app/landing/landing.module.css"),
      source("app/landing/landing-header.module.css"),
      source("app/landing/detection-scene.module.css"),
    ].join("\n");
    const correctivePath = resolve(WEB_ROOT, "app/landing/landing-corrections.module.css");

    expect(existsSync(correctivePath)).toBe(false);
    expect(heroInstrument).not.toMatch(/NORTH|EAST|SOUTH|WEST/);
    expect(heroInstrument).not.toMatch(/radarSweep|sweep/i);
    expect(reducedMotionCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps active navigation, tone switching and a trapped mobile dialog", () => {
    const header = source("app/landing/landing-header.tsx");
    expect(header).toContain("IntersectionObserver");
    expect(header).toContain("aria-current");
    expect(header).toContain("data-tone={tone}");
    expect(header).toContain('role="dialog"');
    expect(header).toContain('aria-modal="true"');
    expect(header).toContain('event.key !== "Tab"');
    expect(header).toContain('event.key === "Escape"');
    expect(header).toContain('document.body.style.overflow = "hidden"');
    expect(header).toContain("scrollbarWidth");
    expect(header).toContain("menuButtonRef.current?.focus");
    expect(header).toContain("Получить пример");
  });

  it("uses one bounded observer instead of fixed delayed hash scrolling", () => {
    const hashNavigation = source("app/landing/landing-hash-navigation.tsx");
    expect(hashNavigation).toContain("MutationObserver");
    expect(hashNavigation).toContain("OBSERVER_TIMEOUT_MS");
    expect(hashNavigation).toContain("aligned = true");
    expect(hashNavigation).not.toMatch(/setTimeout\([^,]+,\s*(0|80|240|640)\)/);
  });
});
