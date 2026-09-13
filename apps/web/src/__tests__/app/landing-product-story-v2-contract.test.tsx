import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import ConversionPanel from "@/app/landing/conversion-panel";
import DeliveryScene from "@/app/landing/delivery-scene";
import DetectionScene from "@/app/landing/detection-scene";
import EvidenceScene from "@/app/landing/evidence-scene";
import HeroProductPreview from "@/app/landing/hero-product-preview";
import SignalTimeline from "@/app/landing/signal-timeline";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function feedbackActionsFromSource(contents: string): Array<[string, string]> {
  return [...contents.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g)]
    .map((match) => [match[1], match[2]]);
}

describe("landing product story v2", () => {
  it("opens with a clear buyer outcome and a believable product workspace", () => {
    const hero = renderToStaticMarkup(
      <DetectionScene previewHref="#preview-configurator" paymentConfigured={false} />,
    );
    const preview = renderToStaticMarkup(<HeroProductPreview />);
    const heroText = visibleText(hero);
    const previewText = visibleText(preview);
    const heroCss = source("app/landing/detection-scene.module.css");

    expect(heroText).toContain("От сигнала до сообщения");
    expect(heroText).toContain("Посмотреть workflow");
    expect(heroText).toContain("проверит подключённые открытые источники");
    expect(preview).toContain('data-hero-product-preview="workflow"');
    expect(previewText).toContain("Сегодня");
    expect(previewText).toContain("Компании");
    expect(previewText).toContain("Как работает");
    expect(previewText).toContain("Инженерный подбор");
    expect(previewText).toContain("Финансовый софт");
    expect(previewText).toContain("Настройте рынок");
    expect(previewText).toContain("Радар проверяет");
    expect(previewText).toContain("Получите повод");
    expect(previewText).toContain("Подготовьте сообщение");
    expect(previewText).not.toMatch(/Промет|Северные системы|Техноформ|Демо · 12 мая/);
    expect(heroCss).toMatch(/\.title\s*\{[^}]*animation:\s*none/);

    expect(heroCss).toMatch(/\.section\s*\{[\s\S]*?overflow:\s*hidden/);
    expect(heroCss).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.productShot,\.fieldFigure:hover \.productShot[^}]*transform:\s*none/);
  });

  it("uses the approved dark split-screen composition at desktop widths", () => {
    const visualCss = source("app/landing/landing-visual-system.module.css");
    const heroCss = source("app/landing/detection-scene.module.css");
    const landing = source("app/landing/landing-page.tsx");

    expect(visualCss).toMatch(/--content-max:\s*76\.25rem/);
    expect(visualCss).toMatch(/--page-gutter:\s*clamp\(1rem,\s*2\.35vw,\s*2rem\)/);
    expect(landing).toContain('data-theme="inverse"');
    expect(visualCss).toMatch(/--landing-canvas:\s*var\(--color-canvas\)/);
    expect(visualCss).toMatch(/--landing-paper:\s*var\(--color-text-primary\)/);
    expect(visualCss).toMatch(/--landing-ink:\s*var\(--color-text-inverse\)/);
    expect(visualCss).toMatch(/--landing-accent:\s*color-mix\(/);
    expect(heroCss).toMatch(
      /\.section\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*\.82fr\)\s+minmax\(0,\s*1\.18fr\)/,
    );
    expect(heroCss).toMatch(/gap:\s*2rem/);
    expect(heroCss).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.section\s*\{[^}]*display:\s*block/);
  });

  it("applies the premium C1 tone, product hierarchy and narrow-screen contract", () => {
    const hero = renderToStaticMarkup(
      <DetectionScene previewHref="#preview-configurator" paymentConfigured={false} />,
    );
    const preview = renderToStaticMarkup(<HeroProductPreview />);
    const previewText = visibleText(preview);
    const headerCss = source("app/landing/landing-header.module.css");
    const heroCss = source("app/landing/detection-scene.module.css");

    expect(hero).toContain('data-header-tone="light"');
    expect(headerCss).toMatch(
      /\.header\[data-tone="light"\]:not\(\[data-scrolled\]\):not\(\[data-menu-open\]\)\s*\{[^}]*color:\s*var\(--color-text-primary\)/,
    );
    expect(headerCss).toMatch(
      /\.header\[data-tone="dark"\]:not\(\[data-scrolled\]\):not\(\[data-menu-open\]\)\s*\{[^}]*color:\s*var\(--color-text-inverse\)/,
    );
    expect(headerCss).toMatch(
      /\.header\[data-scrolled\],[\s\S]*?\.header\[data-menu-open\]\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--color-canvas\) 92%, transparent\)[^}]*color:\s*var\(--color-text-primary\)/,
    );

    expect(heroCss).not.toMatch(/background(?:-image)?:\s*[^;{}]*gradient/);
    expect(heroCss).not.toContain(".section::before");
    expect(heroCss).not.toContain(".section::after");
    expect(heroCss).toMatch(
      /\.title\s*\{[^}]*font-size:\s*clamp\(2\.8rem, 4\.5vw, 4rem\)[^}]*font-weight:\s*610[^}]*line-height:\s*1\.02/,
    );
    expect(heroCss).toMatch(
      /\.primaryButton\s*\{[^}]*min-height:\s*48px[^}]*background:\s*var\(--color-signal\)[^}]*color:\s*var\(--color-text-inverse\)/,
    );
    expect(heroCss).toMatch(
      /\.productShot\s*\{[^}]*width:\s*100%[^}]*background:\s*#101318[^}]*transform:\s*translateX\(/,
    );

    const hierarchy = [
      "Настройте рынок",
      "Радар проверяет",
      "Получите повод",
      "Подготовьте сообщение",
    ];
    let cursor = -1;
    for (const marker of hierarchy) {
      const next = previewText.indexOf(marker, cursor + 1);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(previewText).not.toMatch(/Демо|Промет|Северные системы|Техноформ/);
    expect(heroCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.section\s*\{[^}]*display:\s*block[\s\S]*?\.fieldFigure\s*\{[^}]*width:\s*100%/,
    );
    expect(heroCss).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.workflowTabs\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/,
    );
    expect(preview).not.toContain("data-shot-dot");
  });

  it("explains the full profile-to-contact workflow before the interactive example", () => {
    const landing = source("app/landing/landing-page.tsx");
    const workflow = renderToStaticMarkup(<SignalTimeline />);
    const workflowText = visibleText(workflow);
    const order = [
      "<DetectionScene",
      "<SignalTimeline",
      "<WorkspaceScene",
      "<EvidenceScene",
      "<DeliveryScene",
      "<ConversionPanel",
    ];

    let cursor = -1;
    for (const token of order) {
      const next = landing.indexOf(token);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }

    expect(workflow).toContain('data-product-workflow="profile-to-contact"');
    expect(workflow.match(/data-workflow-step=/g)).toHaveLength(4);
    expect(workflowText).toContain("Настраиваете профиль");
    expect(workflowText).toContain("Радар проверяет публичные сигналы");
    expect(workflowText).toContain("Получаете приоритетный список");
    expect(workflowText).toContain("Решение остаётся за вами");
  });

  it("presents the workflow as one flat signal path with a final manual-control lock", () => {
    const workflow = renderToStaticMarkup(<SignalTimeline />);
    const workflowCss = source("app/landing/signal-timeline.module.css");
    const workflowText = visibleText(workflow);

    expect(workflow.match(/class="[^"]*trajectory[^"]*"/g)).toHaveLength(1);
    expect(workflow.match(/data-workflow-step=/g)).toHaveLength(4);
    expect(workflow).toContain('data-manual-decision="true"');
    expect(workflowText).toContain("10 компаний · почему сейчас · источник · уверенность");
    expect(workflowText).toContain("никакой автоматической массовой рассылки");

    expect(workflowCss).toMatch(/\.section\s*\{[^}]*background-color:\s*var\(--color-canvas\)/);
    expect(workflowCss).not.toMatch(/gradient\(/);
    expect(workflowCss).not.toContain(".section::before");
    expect(workflowCss).not.toContain(".section::after");
    expect(workflowCss).toMatch(
      /\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(18rem,\s*\.72fr\)\s+minmax\(34rem,\s*1\.28fr\)/,
    );
    expect(workflowCss).toMatch(
      /@media \(max-width: 1040px\)[\s\S]*?\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(workflowCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.event,[\s\S]*?opacity:\s*1\s*!important[^}]*transform:\s*none\s*!important/,
    );
  });

  it("frames the static story as one paper product with an evidence-first selected lead", () => {
    const workspaceCss = source("app/landing/workspace-scene.module.css");

    expect(workspaceCss).toMatch(/--workspace-paper:\s*var\(--landing-paper\)/);
    expect(workspaceCss).toMatch(/--workspace-ink:\s*var\(--landing-ink\)/);
    expect(workspaceCss).toMatch(/--workspace-accent:\s*var\(--landing-accent\)/);
    expect(workspaceCss).not.toMatch(/gradient\(/);
    expect(workspaceCss).toMatch(
      /\.leadPrimary\s*\{[^}]*border-left:\s*3px solid var\(--workspace-accent\)/,
    );
    expect(workspaceCss).toMatch(
      /\.evidenceBlock li\s*\{[^}]*border-bottom:\s*1px solid var\(--workspace-line\)[^}]*background:\s*transparent/,
    );
    expect(workspaceCss).toMatch(
      /\.nextMove\s*\{[^}]*border-top:\s*2px solid var\(--workspace-accent\)/,
    );
    expect(workspaceCss).not.toContain(".storyPath");
    expect(workspaceCss).not.toContain(".storyStep");
    expect(workspaceCss).not.toContain(".sourceBadges");
    expect(workspaceCss).toMatch(/@media \(max-width: 400px\)/);
    expect(workspaceCss).toMatch(
      /\.leadRow:focus-visible,[\s\S]*?outline:\s*3px solid var\(--workspace-accent\)/,
    );
    expect(workspaceCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition:\s*none\s*!important/,
    );
  });

  it("presents one light evidence ledger with proof before the manual resolution", () => {
    const evidence = renderToStaticMarkup(<EvidenceScene />);
    const evidenceText = visibleText(evidence);
    const evidenceCss = source("app/landing/evidence-scene.module.css");

    expect(evidence).toContain('data-header-tone="dark"');
    expect(evidence.match(/data-proof-chain=/g)).toHaveLength(1);
    expect(evidence.indexOf('data-proof-event="true"')).toBeLessThan(
      evidence.indexOf('data-proof-brief="true"'),
    );
    expect(evidenceText).toContain("Одна рекомендация — цепочка проверяемых фактов.");
    expect(evidenceText).toContain("Оценка возможности");
    expect(evidenceText).toContain("Уверенность");
    expect(evidenceText).toContain("Следующий ход");

    expect(evidenceCss).toMatch(/--evidence-paper:\s*var\(--landing-paper\)/);
    expect(evidenceCss).toMatch(/--evidence-ink:\s*var\(--landing-ink\)/);
    expect(evidenceCss).toMatch(/--evidence-accent:\s*var\(--landing-accent\)/);
    expect(evidenceCss).not.toMatch(/gradient\(|box-shadow:/);
    expect(evidenceCss).toMatch(
      /\.timeline li\s*\{[^}]*grid-template-columns:\s*minmax\(8rem, \.6fr\)\s+minmax\(7rem, \.45fr\)\s+minmax\(0, 1\.55fr\)/,
    );
    expect(evidenceCss).toMatch(
      /\.resolution\s*\{[^}]*grid-template-columns:\s*minmax\(8rem, \.55fr\)\s+minmax\(12rem, \.7fr\)\s+minmax\(0, 1\.75fr\)/,
    );
    expect(evidenceCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?grid-template-areas:\s*"source date"\s*"fact fact"/,
    );
    expect(evidenceCss).toMatch(
      /@media \(max-width: 520px\)[\s\S]*?\.resolution\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(evidenceCss).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("shows a concrete Telegram digest and keeps outreach under manual control", () => {
    const delivery = renderToStaticMarkup(<DeliveryScene />);
    const deliveryText = visibleText(delivery);
    const deliveryCss = source("app/landing/delivery-scene.module.css");
    const landingFeedbackActions = feedbackActionsFromSource(
      source("app/landing/delivery-scene.tsx"),
    );

    expect(delivery).toContain('data-telegram-preview="static-demo"');
    expect(deliveryText).toContain("Новый приоритетный сигнал");
    expect(deliveryText).toContain("Демо · 12 мая");
    expect(deliveryText).toContain("Почему сейчас");
    expect(deliveryText).toContain("Источник и дата");
    expect(delivery).toContain('data-telegram-feedback-actions="production"');
    expect(delivery.match(/data-feedback-action=/g)).toHaveLength(4);
    expect(landingFeedbackActions).toHaveLength(4);
    expect(landingFeedbackActions.map(([key]) => key)).toEqual(["accepted", "badfit", "snooze", "dismissed"]);
    for (const label of ["Беру", "Мимо", "Позже", "Скрыть"]) {
      expect(deliveryText).toContain(label);
    }
    expect(deliveryText).toContain("Веб-кабинет");
    expect(deliveryText).toContain("Telegram");
    expect(deliveryText).toContain("Сообщения компаниям не отправляются автоматически.");
    expect(deliveryCss).toMatch(
      /\.telegramAvatar\s*\{[^}]*color:\s*var\(--delivery-paper\)/,
    );
  });

  it("keeps the mobile interactive example concise without hiding the primary proof", () => {
    const workspace = source("app/landing/workspace-scene.tsx");
    const leadList = source("app/landing/workspace-lead-list.tsx");
    const workspaceCss = source("app/landing/workspace-scene.module.css");
    const detectionCss = source("app/landing/detection-scene.module.css");
    const deliveryCss = source("app/landing/delivery-scene.module.css");

    expect(workspace).toContain("Пример выдачи · демо-сценарий");
    expect(leadList).toContain("mobileEnhanced ? 2 : 4");
    expect(workspaceCss).toMatch(/\.outcomeMeta:nth-child\(2\)\s*\{\s*display:\s*none;/);
    expect(workspaceCss).toContain(".evidenceBlock li");
    expect(workspaceCss).toContain(".nextMove");
    expect(detectionCss).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.workflowTabs\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)/);
    expect(detectionCss).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.workflowTabs > button\s*\{[^}]*min-height:\s*64px/);
    expect(detectionCss).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.productShot[^}]*transform:\s*none/);
    expect(deliveryCss).toMatch(/@media \(max-width: 520px\)[\s\S]*?\.deliveryRoutes\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(deliveryCss).toMatch(/\.deliveryRoutes \.channelRoute p\s*\{\s*display:\s*none/);
  });

  it("finishes with a static Telegram proof, one pilot path and exact public terms", () => {
    const previewInput = {
      specialization: "",
      targetCity: "",
      includeKeywords: "",
      excludeKeywords: "",
      dailyDigestLimit: 10,
    };
    const delivery = renderToStaticMarkup(<DeliveryScene />);
    const conversion = renderToStaticMarkup(
      <ConversionPanel
        previewInput={previewInput}
        paymentConfigured={false}
        faqItems={[{ question: "Это автоматическая рассылка?", answer: "Нет, решение и контакт остаются за вами." }]}
      />,
    );
    const deliveryText = visibleText(delivery);
    const conversionText = visibleText(conversion);
    const deliveryCss = source("app/landing/delivery-scene.module.css");
    const conversionCss = source("app/landing/conversion-panel.module.css");
    const landing = source("app/landing/landing-page.tsx");

    expect(delivery).toContain('data-telegram-preview="static-demo"');
    expect(deliveryText).toContain("Статический демо-экран");
    expect(deliveryText).toContain("Сообщение компании не отправлено");
    expect(deliveryCss).not.toMatch(/gradient\(|box-shadow:/);

    expect(conversion).toContain('data-pricing-path="pilot-first"');
    expect(conversion).toContain('data-pilot-entry="primary"');
    expect(conversionText).toContain("990 ₽");
    expect(conversionText).toContain("2 990 ₽");
    expect(conversionText).toContain("6 990 ₽");
    expect(conversionText).toContain("Без автопродления");
    expect(conversionText).toContain("Сообщения отправляете вы");
    expect(conversion.indexOf('id="pricing"')).toBeLessThan(conversion.indexOf('id="faq"'));
    expect(conversion.indexOf('id="faq"')).toBeLessThan(conversion.indexOf('id="conversion-final"'));
    expect(conversionCss).not.toMatch(/gradient\(|box-shadow:/);
    expect(landing).toContain('data-landing-footer="compact"');
  });
});
