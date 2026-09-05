import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { existsSync, readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";

import HomePage, { PreviewSection, PreviewSkeleton } from "@/app/home-page-content";
import ConversionPanel from "@/app/landing/conversion-panel";
import DeliveryScene from "@/app/landing/delivery-scene";
import DetectionScene from "@/app/landing/detection-scene";
import EvidenceScene from "@/app/landing/evidence-scene";
import LandingHeader from "@/app/landing/landing-header";
import WorkspaceScene from "@/app/landing/workspace-scene";
import { SiteFooter } from "@/app/ui/site-footer";
import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "@/lib/landing-analytics-contract";
import {
  buildCheckoutHref,
  hasPublicPreviewInput,
  readPublicPreviewInput,
} from "@/lib/publicProduct";

jest.mock("@/lib/payments", () => ({
  getPaymentProviderSetupState: () => ({ configured: false }),
}));

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

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

function renderServerHtml(node: ReactNode): Promise<string> {
  return new Promise((resolveHtml, reject) => {
    const output = new PassThrough();
    let html = "";
    let settled = false;

    output.setEncoding("utf8");
    output.on("data", (chunk) => {
      html += chunk;
    });
    output.on("end", () => {
      if (settled) return;
      settled = true;
      resolveHtml(html);
    });
    output.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    const stream = renderToPipeableStream(node, {
      onAllReady() {
        stream.pipe(output);
      },
      onShellError(error) {
        if (settled) return;
        settled = true;
        reject(error);
      },
    });
  });
}

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("final unified evidence-first landing contract", () => {
  it("keeps the required scene order and conversion outside workspace suspense", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    expect(collectElements(page, LandingHeader)).toHaveLength(1);
    expect(collectElements(page, DetectionScene)).toHaveLength(1);
    expect(collectElements(page, WorkspaceScene)).toHaveLength(1);
    expect(collectElements(page, EvidenceScene)).toHaveLength(1);
    expect(collectElements(page, DeliveryScene)).toHaveLength(1);
    expect(collectElements(page, ConversionPanel)).toHaveLength(1);
    expect(collectElements(page, SiteFooter)).toHaveLength(1);

    const landing = source("app/landing/landing-page.tsx");
    const expectedOrder = [
      "<DetectionScene",
      "<WorkspaceScene",
      "<EvidenceScene",
      "<DeliveryScene",
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

  it("keeps the static product story fully synchronous", () => {
    const workspace = source("app/landing/workspace-scene.tsx");
    expect(workspace).toContain("export default function WorkspaceScene");
    expect(workspace).toContain("function WorkspaceIntro");
    expect(workspace).toContain("getStaticDemoDigestItems()");
    expect(workspace).not.toContain("<Suspense");
    expect(workspace).not.toContain("getPublicSampleDigestState(");
    expect(workspace).not.toContain("PreviewConfigurator");
    expect(workspace).not.toContain("data-preview-form");
  });

  it("renders the static product story with stable anchors and no form", () => {
    const input = readPublicPreviewInput({ specialization: "инженерный подбор" });
    const preview = PreviewSection({
      previewInput: input,
      hasPreview: hasPublicPreviewInput(input),
      checkoutHref: buildCheckoutHref(input),
    });
    expect(preview.type).toBe(WorkspaceScene);

    const workspace = source("app/landing/workspace-scene.tsx");
    expect(workspace).toContain('id="preview-configurator"');
    expect(workspace).toContain('id="preview-results"');
    expect(workspace).toContain("data-preview-results-ready");
    expect(workspace).toContain('data-story-path="signals-dossier-cabinet"');
    expect(workspace).not.toContain('action="/#preview-results"');
    expect(workspace).not.toContain("data-preview-form");

    const skeleton = renderToStaticMarkup(<PreviewSkeleton />);
    expect(skeleton).toContain('id="preview-results"');
    expect(skeleton).toContain("data-preview-results-skeleton");
    expect(skeleton).toContain('aria-busy="true"');
  });

  it("keeps checkout analytics on the static story product footer", () => {
    const checkoutHref = buildCheckoutHref(readPublicPreviewInput({}));
    const markup = renderToStaticMarkup(<WorkspaceScene checkoutHref={checkoutHref} />);

    expect(markup).toContain('id="preview-results"');
    expect(markup).toContain("data-preview-results-ready");
    expect(markup).toContain(`href="${checkoutHref.replaceAll("&", "&amp;")}"`);
    expect(markup).toContain(`data-analytics-event="${LANDING_ANALYTICS_EVENT.checkoutStarted}"`);
    expect(markup).toContain(`data-analytics-context="${LANDING_ANALYTICS_CONTEXT.preview}"`);
    expect(markup).toContain("Запустить радар на 7 дней");
    expect(markup).toContain("7 дней · без автопродления");
    expect(source("app/landing/workspace-scene.module.css")).toMatch(/\.checkout\s*\{[\s\S]*?min-height:\s*52px/);
  });

  it("streams the complete landing composition with the static story", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({ specialization: "инженерный подбор", targetCity: "Москва" }),
    });
    expect(collectElements(page, SiteFooter)).toHaveLength(1);

    const html = await renderServerHtml(page);
    const footerSource = source("app/ui/site-footer.tsx");
    const offerAliasSource = source("app/offer/page.tsx");

    expect(html).toContain('id="scene-workspace"');
    expect(html).toContain("Пример выдачи · демо-сценарий");
    expect(html).toContain("Обезличенный пример.");
    expect(html).toContain('id="preview-configurator"');
    expect(html).toContain('id="preview-results"');
    expect(html).toContain('data-story-path="signals-dossier-cabinet"');
    expect(html).not.toContain("data-preview-form");
    expect(html).toContain('id="scene-evidence"');
    expect(html).toContain('id="scene-delivery"');
    expect(html).not.toContain('id="scene-outreach"');
    expect(html).not.toContain('id="scene-timeline"');
    expect(html).toContain('id="pricing"');
    expect(html).toContain('id="faq"');
    expect(html).toContain("Так радар ведёт компанию от сигнала до вашего решения");
    expect(footerSource).toContain('href="/legal"');
    expect(footerSource).toContain('href="/terms"');
    expect(footerSource).toContain('href="/payment-and-refund"');
    expect(footerSource).toContain('href="/privacy"');
    expect(offerAliasSource.trim()).toBe('export { default, metadata } from "../terms/page";');
    expect(footerSource).toContain("Реквизиты");
    expect(footerSource).toContain("Оферта");
    expect(footerSource).toContain("Конфиденциальность");
    expect(footerSource).toContain("Recruiter Radar");
  });

  it("renders an evidence-backed lead list with one expanded recommendation", () => {
    const panel = renderToStaticMarkup(<WorkspaceScene checkoutHref="/checkout?plan=weekly" />);
    const markup = panel;
    expect(markup.match(/data-lead-row="true"/g)).toHaveLength(4);
    expect(markup.match(/data-primary-lead="true"/g)).toHaveLength(1);
    expect(markup.match(/data-selected-lead-detail/g)).toHaveLength(1);
    expect(markup).toContain("Почему сейчас");
    expect(markup).toContain("Подтверждения и источники");
    expect(markup).toContain("Сообщения не отправляются автоматически");
  });

  it("keeps the hero example CTA and trust copy static-story aware", () => {
    const hero = renderToStaticMarkup(<DetectionScene previewHref="#preview-configurator" paymentConfigured={false} />);
    const evidence = renderToStaticMarkup(<EvidenceScene />);
    const delivery = renderToStaticMarkup(<DeliveryScene />);

    expect(hero).toContain("Компании, которым стоит написать сегодня");
    expect(hero).toContain("Посмотреть пример продукта");
    expect(hero).toContain("Демо-сценарий от 12 мая · без регистрации");
    expect(hero).toContain(">Войти</a>");
    expect(hero).toContain("заявка без списания");
    expect(hero).toContain(`data-analytics-event="${LANDING_ANALYTICS_EVENT.previewStarted}"`);
    expect(hero).toContain(`data-analytics-context="${LANDING_ANALYTICS_CONTEXT.heroPrimary}"`);
    expect(evidence).toContain("Оценка возможности");
    expect(evidence).toContain("Последовательность подтверждающих фактов");
    expect(evidence).toContain("Почему эта компания сейчас");
    expect(evidence).not.toContain("открыть факт");
    expect(delivery).not.toContain("DELIVERY_STEPS");
    expect(delivery).toContain("Полная карточка остаётся в кабинете");
    expect(delivery).toContain("Сообщения компаниям не отправляются автоматически.");
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

    expect(text).toContain("Оставьте заявку на 7-дневный пилот");
    expect(text).toContain("Оставить заявку на пилот");
    expect(text).toContain("Коротко о главном");
    expect(links.some((link) => link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.checkoutStarted)).toBe(true);
    expect(links.some((link) => link.props["data-analytics-event"] === LANDING_ANALYTICS_EVENT.continuationCtaClicked)).toBe(true);
  });

  it("prevents regression to corrective layers, compass labels and sweep", () => {
    const hero = source("app/landing/detection-scene.tsx");
    const reducedMotionCss = [
      source("app/landing/landing.module.css"),
      source("app/landing/landing-header.module.css"),
      source("app/landing/detection-scene.module.css"),
    ].join("\n");
    const correctivePath = resolve(WEB_ROOT, "app/landing/landing-corrections.module.css");

    expect(existsSync(correctivePath)).toBe(false);
    expect(hero).not.toMatch(/NORTH|EAST|SOUTH|WEST/);
    expect(hero).not.toMatch(/radarSweep|sweep/i);
    expect(reducedMotionCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps active navigation, tone switching and a trapped mobile dialog", () => {
    const header = source("app/landing/landing-header.tsx");
    const headerCss = source("app/landing/landing-header.module.css");
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
    expect(header).toContain("Посмотреть пример");
    expect(header).not.toContain("Посмотреть возможности");
    expect(headerCss).toMatch(/\.navLink\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
  });

  it("uses one bounded observer instead of fixed delayed hash scrolling", () => {
    const hashNavigation = source("app/landing/landing-hash-navigation.tsx");
    expect(hashNavigation).toContain("MutationObserver");
    expect(hashNavigation).toContain("OBSERVER_TIMEOUT_MS");
    expect(hashNavigation).toContain("aligned = true");
    expect(hashNavigation).not.toMatch(/setTimeout\([^,]+,\s*(0|80|240|640)\)/);
  });
});
