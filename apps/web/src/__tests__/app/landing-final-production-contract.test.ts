import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("landing final production contract", () => {
  test("keeps the hero compact, payment-aware and connected to analytics", () => {
    const hero = source("app/landing/detection-scene.tsx");
    const page = source("app/landing/landing-page.tsx");

    expect(page).toContain("paymentConfigured={props.paymentConfigured}");
    expect(hero).toContain('data-hero-layout="ambient-radar"');
    expect(hero).toContain("Компании, которым стоит написать сегодня.");
    expect(hero).toContain("Посмотреть пример");
    expect(hero).toContain("Уже есть доступ? Войти");
    expect(hero).not.toContain("HeroInstrument");
    expect(hero).toContain("data-hero-trust-line");
    expect(hero).toContain("заявка без списания");
    expect(hero).toContain("990 ₽");
    expect(hero).toContain("LANDING_ANALYTICS_EVENT.previewStarted");
    expect(hero).not.toContain("Компании подают сигнал.");
  });

  test("renders pricing and FAQ as continuous editorial scenes with explicit structure", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const browserAudit = source("scripts/verify-landing-production.mjs");
    const landing = source("app/landing/landing.module.css");
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(conversion).toContain('data-conversion-scenes="continuous"');
    expect(conversion).toContain('data-pricing-layout="unified-grid"');
    expect(conversion).toContain('data-faq-layout="editorial"');
    expect(conversion).toContain("Попробуйте на своей нише");
    expect(conversion).toContain("Проверьте радар на своей нише за 7 дней.");
    expect(browserAudit).toContain("Проверьте радар на своей нише за 7 дней");
    expect(browserAudit).not.toContain("7 дней за 990 ₽ — проверьте качество клиентских возможностей");
    expect(conversion).toContain("Запустить на 7 дней");
    expect(conversion).toContain("Разовая оплата · без автопродления");
    expect(conversion).toContain("Подключить месяц");
    expect(conversion).toContain("Подключить квартал");
    expect(conversion).not.toContain("<span>{pilotPlan.cadence}</span>");
    expect(conversion).toContain("Коротко о главном");
    expect(conversion).not.toContain("Ответы раскрываются без перехода");

    expect(visual).toContain("--page-gutter:");
    expect(visual).toContain("--content-max:");
    expect(visual).toContain("--section-pad-y:");
    expect(conversion).toContain("data-conversion-panel");
    expect(conversion).toContain("data-pricing-intro");
    expect(conversion).toContain("data-faq-heading");
    expect(conversion).toContain("data-faq-list");
    expect(visual).toContain(":global([data-conversion-panel])");
    expect(visual).not.toContain("[class*=");
    expect(visual).toMatch(/\.visualSystem\s*:global\(#pricing\),/);
    expect(visual).toMatch(/\.visualSystem\s*:global\(#faq\)\s*\{/);
    expect(visual).toMatch(/max-width\s*:\s*none\s*;/);
    expect(landing).toMatch(/font-size\s*:\s*clamp\(2\.35rem,\s*12vw,\s*3\.25rem\)\s*;/);
    expect(visual).toContain(":global(#faq details)");
    expect(visual).toMatch(/background\s*:\s*transparent\s*;/);
  });

  test("keeps FAQ motion restrained and removable", () => {
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(visual).toContain("@keyframes faqReveal");
    expect(visual).not.toContain("@keyframes signalBreath");
    expect(visual).toMatch(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/);
    expect(visual).toMatch(/#faq details\[open\] p[\s\S]*?animation\s*:\s*none\s*(?:;|})/);
  });

  test("preserves the manual outreach boundary with the signal timeline in composition", () => {
    const page = source("app/landing/landing-page.tsx");
    const timeline = source("app/landing/signal-timeline-scene.tsx");
    const delivery = source("app/landing/delivery-scene.tsx");
    const evidence = source("app/landing/evidence-scene.tsx");

    expect(page).not.toContain("<OutreachScene");
    expect(page).toContain("<SignalTimelineScene");
    expect(timeline).toContain('id="scene-signal-timeline"');
    expect(timeline).toContain("data-timeline-event");
    expect(timeline).toContain('data-opportunity-lock="true"');
    expect(delivery).toContain("Сообщения компаниям не отправляются автоматически.");
    expect(delivery).toContain('data-delivery-routes="connected"');
    expect(delivery).toContain("PRIMARY_ROUTES.map");
    expect(delivery).toContain("EXTRA_ROUTES.map");
    expect(delivery).toContain('data-manual-outreach-boundary="true"');
    expect(evidence).toContain("Почему сейчас");
    expect(evidence).toContain('data-evidence-conclusion="source-fact-conclusion"');
    expect(evidence).toContain("Источник</span><i aria-hidden=\"true\">→</i><span>Факт");
    expect(evidence).not.toContain("открыть факт");
    expect(evidence).not.toContain("SOURCE_ROLES");
  });

  test("keeps FAQ copy professional and free of internal delivery terminology", () => {
    const faq = source("app/landing/landing-faq.ts");

    expect(faq).toContain("Recruiter Radar сам пишет компаниям?");
    expect(faq).toContain("Где я получаю результаты?");
    expect(faq).not.toContain("HTTPS-webhook");
    expect(faq).not.toContain("n8n");
    expect(faq).not.toContain("Куда приходит выдача?");
    expect(faq).not.toContain("email digest");
    expect(faq).not.toContain("browser push");
    expect(faq).not.toContain("signed HTTPS webhook");
  });
});
