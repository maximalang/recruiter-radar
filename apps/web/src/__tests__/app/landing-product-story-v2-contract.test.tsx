import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import ConversionPanel from "@/app/landing/conversion-panel";
import DeliveryScene from "@/app/landing/delivery-scene";
import DetectionScene from "@/app/landing/detection-scene";
import EvidenceScene from "@/app/landing/evidence-scene";
import HeroProductPreview from "@/app/landing/hero-product-preview";

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
      <DetectionScene paymentConfigured={false} />,
    );
    const preview = renderToStaticMarkup(<HeroProductPreview />);
    const heroText = visibleText(hero);
    const previewText = visibleText(preview);
    const heroCss = source("app/landing/detection-scene.module.css");

    expect(heroText).toContain("От сигнала до сообщения");
    expect(heroText).toContain("Посмотреть, как это работает");
    expect(heroText).toContain("Радар следит за публичными источниками");
    expect(preview).toContain('data-hero-product-preview="workflow"');
    expect(previewText).toContain("Сегодня");
    expect(previewText).toContain("Компании");
    expect(previewText).toContain("Результат");
    expect(previewText).toContain("Инженерный подбор");
    expect(previewText).toContain("Финансовый софт");
    expect(previewText).toContain("Ваш рынок");
    expect(previewText).toContain("42 источника");
    expect(previewText).toContain("10 компаний");
    expect(previewText).toContain("Готовый черновик");
    expect(previewText).not.toMatch(/Промет|Северные системы|Техноформ|Демо · 12 мая/);
    expect(heroCss).toMatch(/\.title\s*\{[^}]*animation:\s*none/);

    expect(heroCss).toMatch(/\.section\s*\{[\s\S]*?overflow:\s*hidden/);
    // Fitted shot (owner verdict 23.09): no clipped-edge expansion at any width.
    expect(heroCss).not.toMatch(/translateX/);
    expect(heroCss).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.fieldFigure\s*\{[^}]*width:\s*100%/);
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
      <DetectionScene paymentConfigured={false} />,
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
      /\.title\s*\{[^}]*font-size:\s*clamp\(3\.2rem, 5\.2vw, 4\.7rem\)[^}]*font-weight:\s*620[^}]*line-height:\s*1;/,
    );
    expect(heroCss).toMatch(
      /\.primaryButton\s*\{[^}]*min-height:\s*48px[^}]*background:\s*var\(--color-signal\)[^}]*color:\s*var\(--color-text-inverse\)/,
    );
    expect(heroCss).toMatch(
      /\.productShot\s*\{[^}]*width:\s*100%[^}]*background:\s*var\(--color-canvas\)/,
    );

    const hierarchy = [
      "Ваш рынок",
      "42 источника",
      "10 компаний",
      "Готовый черновик",
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
      /@media \(max-width: 900px\)[\s\S]*?\.workflowTabs\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/,
    );
    expect(preview).not.toContain("data-shot-dot");
  });

  it("keeps the scene order: hero demo, proof, delivery, conversion", () => {
    const landing = source("app/landing/landing-page.tsx");
    const order = [
      "<DetectionScene",
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
    expect(landing).not.toContain("<SignalTimeline");
  });

  it("retires the static workspace story in favor of the hero demo", () => {
    expect(existsSync(resolve(WEB_ROOT, "app/landing/workspace-scene.tsx"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "app/landing/workspace-scene.module.css"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "app/landing/workspace-lead.tsx"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "app/landing/workspace-lead-list.tsx"))).toBe(false);
    expect(source("app/landing/landing-page.tsx")).not.toContain("WorkspaceScene");
    expect(source("app/landing/landing-copy.ts")).not.toContain("scene-workspace");
    expect(source("app/ui/site-footer.tsx")).not.toContain("scene-workspace");
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

    expect(evidenceCss).toMatch(/--evidence-paper:\s*var\(--color-canvas\)/);
    expect(evidenceCss).toMatch(/--evidence-ink:\s*var\(--color-text-primary\)/);
    expect(evidenceCss).toMatch(/--evidence-accent:\s*var\(--color-signal\)/);
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
    const detectionCss = source("app/landing/detection-scene.module.css");
    const deliveryCss = source("app/landing/delivery-scene.module.css");

    expect(source("app/landing/hero-product-preview.tsx")).toContain('id="hero-workflow"');
    expect(detectionCss).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.workflowTabs\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)/);
    expect(detectionCss).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.workflowTabs > button\s*\{[^}]*min-height:\s*64px/);
    expect(detectionCss).not.toMatch(/translateX/);
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
