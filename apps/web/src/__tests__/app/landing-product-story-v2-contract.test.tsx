import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import DeliveryScene from "@/app/landing/delivery-scene";
import DetectionScene from "@/app/landing/detection-scene";
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

    expect(delivery).toContain('data-telegram-preview="demo"');
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
      /\.telegramAvatar\s*\{[^}]*color:\s*var\(--color-text-inverse\)/,
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
});
