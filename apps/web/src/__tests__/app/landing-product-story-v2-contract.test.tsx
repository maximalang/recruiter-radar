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

    expect(heroText).toContain("Компании, которым стоит написать сегодня");
    expect(heroText).toContain("Посмотреть пример для своей ниши");
    expect(heroText).toContain("рабочий список");
    expect(preview).toContain('data-hero-workspace="today"');
    expect(previewText).toContain("Сегодня");
    expect(previewText).toContain("Компании");
    expect(previewText).toContain("Ситуации");
    expect(previewText).toContain("Радар");
    expect(previewText).toContain("Настройки");
    expect(previewText).toContain("10 в списке");
    expect(previewText).toContain("Почему сейчас");
    expect(previewText).toContain("Официальный контакт");
    expect(previewText).toContain("В работу");
    expect(previewText).toContain("Отложить");
    expect(previewText).toContain("Не подходит");
    expect(previewText).toContain("Демо · 12 мая");
    expect(heroCss).toMatch(/\.title\s*\{[^}]*animation:\s*none/);

    expect(heroCss).not.toMatch(
      /@media\s*\(max-width:\s*959px\)[\s\S]*?\.shotSide\s*\{\s*display:\s*none;/,
    );
    expect(heroCss).not.toMatch(
      /@media\s*\(max-width:\s*430px\)[\s\S]*?\.shotEvidence div:nth-child\(2\)\s*\{\s*display:\s*none;/,
    );
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
      /\.section\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*\.92fr\)\s+minmax\(0,\s*1\.08fr\)/,
    );
    expect(heroCss).toMatch(/gap:\s*3rem/);
    expect(heroCss).toMatch(/@media \(max-width: 900px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
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
      /\.title\s*\{[^}]*font-size:\s*clamp\(2\.75rem, 4\.3vw, 3\.375rem\)[^}]*font-weight:\s*600[^}]*line-height:\s*1\.05/,
    );
    expect(heroCss).toMatch(
      /\.primaryButton\s*\{[^}]*min-height:\s*48px[^}]*background:\s*var\(--color-signal\)[^}]*color:\s*var\(--color-text-inverse\)/,
    );
    expect(heroCss).toMatch(
      /\.productShot\s*\{[^}]*max-width:\s*100%[^}]*background:\s*var\(--color-surface-elevated\)/,
    );

    const hierarchy = [
      'data-hero-company-detail="selected"',
      'data-hero-why-now="true"',
      'data-hero-evidence="fixed-date"',
      'data-hero-confidence="A"',
      'data-hero-next-step="manual"',
    ];
    let cursor = -1;
    for (const marker of hierarchy) {
      const next = preview.indexOf(marker);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(previewText).toContain("Демо · 12 мая");
    expect(previewText).not.toContain("Профиль активен");
    expect(heroCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.section\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*?\.fieldFigure\s*\{[^}]*width:\s*100%/,
    );
    expect(heroCss).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.shotBody\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    // Stage 1/2 (owner scope guard): the three macOS traffic lights stay
    // visible and colored at every width, including 390px mobile.
    expect(heroCss).not.toMatch(/\.shotDot[^{]*\{[^}]*display:\s*none/);
    expect(heroCss).toMatch(
      /\.shotDot\[data-shot-dot="red"\]\s*\{[^}]*background:\s*var\(--shot-dot-close\)/,
    );
    expect(preview.match(/data-shot-dot="(red|yellow|green)"/g)).toEqual([
      'data-shot-dot="red"',
      'data-shot-dot="yellow"',
      'data-shot-dot="green"',
    ]);
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

  it("frames the configurator as one paper product with an evidence-first selected lead", () => {
    const workspaceCss = source("app/landing/workspace-scene.module.css");

    expect(workspaceCss).toMatch(/--workspace-paper:\s*var\(--landing-paper\)/);
    expect(workspaceCss).toMatch(/--workspace-ink:\s*var\(--landing-ink\)/);
    expect(workspaceCss).toMatch(/--workspace-accent:\s*var\(--landing-accent\)/);
    expect(workspaceCss).not.toMatch(/gradient\(/);
    expect(workspaceCss).toMatch(
      /\.workspaceForm\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) auto auto/,
    );
    expect(workspaceCss).toMatch(
      /\.workspaceForm button\s*\{[^}]*background:\s*var\(--workspace-accent\)/,
    );
    expect(workspaceCss).toMatch(
      /\.leadPrimary\s*\{[^}]*border-left:\s*3px solid var\(--workspace-accent\)/,
    );
    expect(workspaceCss).toMatch(
      /\.evidenceBlock li\s*\{[^}]*border-bottom:\s*1px solid var\(--workspace-line\)[^}]*background:\s*transparent/,
    );
    expect(workspaceCss).toMatch(
      /\.nextMove\s*\{[^}]*border-top:\s*2px solid var\(--workspace-accent\)/,
    );
    expect(workspaceCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.workspaceForm\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(workspaceCss).toMatch(
      /@media \(max-width: 520px\)[\s\S]*?\.workspaceForm\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(workspaceCss).toMatch(/@media \(max-width: 400px\)/);
    expect(workspaceCss).toMatch(
      /\.workspaceForm input\s*\{[^}]*min-height:\s*44px/,
    );
    expect(workspaceCss).toMatch(
      /\.presetStrip a:focus-visible,[\s\S]*?outline:\s*3px solid var\(--workspace-accent\)/,
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
    const productionFeedbackActions = feedbackActionsFromSource(
      source("lib/telegramDigestFeedback.ts"),
    );

    expect(delivery).toContain('data-telegram-preview="static-demo"');
    expect(deliveryText).toContain("Новый приоритетный сигнал");
    expect(deliveryText).toContain("Демо · 12 мая");
    expect(deliveryText).toContain("Почему сейчас");
    expect(deliveryText).toContain("Источник и дата");
    expect(delivery).toContain('data-telegram-feedback-actions="production"');
    expect(delivery.match(/data-feedback-action=/g)).toHaveLength(8);
    expect(landingFeedbackActions).toHaveLength(8);
    expect(landingFeedbackActions).toEqual(productionFeedbackActions);
    for (const label of ["Беру", "Мимо", "Позже", "Уже написал", "Ответили", "Созвон", "Клиент", "Скрыть"]) {
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

    expect(workspace).toContain("Проверьте, какие компании попадут в ваш рабочий список");
    expect(leadList).toContain("mobileEnhanced ? 2 : 4");
    expect(workspaceCss).toMatch(/\.outcomeMeta:nth-child\(2\)\s*\{\s*display:\s*none;/);
    expect(workspaceCss).toContain(".evidenceBlock li");
    expect(workspaceCss).toContain(".nextMove");
    expect(detectionCss).toMatch(/@media \(max-width: 600px\)[\s\S]*?\.shotNav b\s*\{[^}]*font-size:\s*\.68rem/);
    expect(detectionCss).toMatch(/@media \(max-width: 600px\)[\s\S]*?\.shotWhy p\s*\{[^}]*font-size:\s*\.68rem/);
    expect(detectionCss).not.toContain(".shotNav > span:nth-child(4),");
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
