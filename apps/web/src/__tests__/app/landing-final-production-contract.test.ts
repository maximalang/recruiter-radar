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
    expect(hero).toContain('data-hero-layout="balanced-grid"');
    expect(hero).toContain("Компании, которым стоит написать сегодня.");
    expect(hero).toContain("Посмотреть пример радара");
    expect(hero).toContain("Как формируется приоритет");
    expect(hero).toContain("data-hero-trust-line");
    expect(hero).toContain("заявка без списания");
    expect(hero).toContain("разовая оплата");
    expect(hero).toContain("LANDING_ANALYTICS_EVENT.previewStarted");
    expect(hero).not.toContain("Компании подают сигнал.");
  });

  test("renders pricing and FAQ as continuous editorial scenes with explicit structure", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(conversion).toContain('data-conversion-scenes="continuous"');
    expect(conversion).toContain('data-pricing-layout="unified-grid"');
    expect(conversion).toContain('data-faq-layout="editorial"');
    expect(conversion).toContain("Проверьте радар на своих нишах за 7 дней.");
    expect(conversion).toContain("Запустить пилот на 7 дней");
    expect(conversion).toContain("После пилота — месяц или квартал");
    expect(conversion).toContain("Без автопродления.");
    expect(conversion).toContain("Продолжить на месяц");
    expect(conversion).toContain("Подключить квартал");
    expect(conversion).not.toContain("<span>{pilotPlan.cadence}</span>");
    expect(conversion).toContain("Перед запуском — короткие ответы.");
    expect(conversion).not.toContain("Ответы раскрываются без перехода");

    expect(visual).toContain("--page-gutter:");
    expect(visual).toContain("--content-max:");
    expect(visual).toContain("--section-pad-y:");
    expect(visual).toContain(':global([class*="conversionPanel"])');
    expect(visual).toContain(".visualSystem :global(#pricing),");
    expect(visual).toContain(".visualSystem :global(#faq) {");
    expect(visual).toContain("max-width: none;");
    expect(visual).toContain(":global(#faq details)");
    expect(visual).toContain("background: transparent;");
  });

  test("keeps ambient radar and FAQ motion restrained and removable", () => {
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(visual).toContain("@keyframes clusterDrift");
    expect(visual).toContain("@keyframes faqReveal");
    expect(visual).not.toContain("@keyframes signalBreath");
    expect(visual).toContain("@media (prefers-reduced-motion: reduce)");
    expect(visual).toMatch(/data-signal-cluster[\s\S]*animation: none;/);
    expect(visual).toMatch(/#faq details\[open\] p[\s\S]*animation: none;/);
  });

  test("preserves manual outreach boundary and customer-readable source roles", () => {
    const outreach = source("app/landing/outreach-scene.tsx");
    const evidence = source("app/landing/evidence-scene.tsx");

    expect(outreach).toContain('data-manual-outreach-boundary="true"');
    expect(outreach).toContain("Отправка сообщения компании всегда требует действия пользователя.");
    expect(evidence).toContain("Как источники участвуют в выдаче");
    expect(evidence).toContain("Влияет на основную выдачу");
    expect(evidence).toContain("Подключено, проходит проверки");
    expect(evidence).not.toContain("Source registry / фактические роли");
  });

  test("keeps FAQ copy professional and free of internal delivery terminology", () => {
    const faq = source("app/landing/landing-faq.ts");

    expect(faq).toContain("Recruiter Radar отправляет сообщения компаниям?");
    expect(faq).toContain("Где я получаю результаты?");
    expect(faq).toContain("защищённый HTTPS-webhook");
    expect(faq).not.toContain("Радар сам пишет компаниям?");
    expect(faq).not.toContain("Куда приходит выдача?");
    expect(faq).not.toContain("email digest");
    expect(faq).not.toContain("browser push");
    expect(faq).not.toContain("signed HTTPS webhook");
  });

  test("audits heading bounds and consent collisions across the mobile conversion surfaces", () => {
    const audit = source("scripts/verify-landing-production.mjs");

    expect(audit).toContain('{ name: "final-cta-320x700", width: 320, height: 700, target: "#conversion-final" }');
    expect(audit).toContain('{ name: "final-cta-390x844", width: 390, height: 844, target: "#conversion-final" }');
    expect(audit).toContain("assertKeyHeadingBounds");
    expect(audit).toContain('"#conversion-final h2"');
    expect(audit).toContain("assertConsentControlCollisions");
    expect(audit).toContain('[aria-label="Изменить настройки cookies"]');
    expect(audit).toContain('[data-pricing-primary="true"] > a');
    expect(audit).toContain("#faq details[open]");
    expect(audit).toContain('[data-pricing-primary="true"] [data-consent-safe-copy]');
    expect(audit).toContain("textOnly: true");
  });
});
