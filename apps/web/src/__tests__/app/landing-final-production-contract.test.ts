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
    const heroCss = source("app/landing/detection-scene.module.css");

    expect(page).toContain("paymentConfigured={props.paymentConfigured}");
    expect(hero).toContain("Находите компании, которым стоит написать сейчас.");
    expect(hero).toContain('data-art-direction="evidence-first"');
    expect(hero).toContain('data-payment-offer={paymentConfigured ? "7 дней · 990 ₽" : "7 дней · заявка без списания"}');
    expect(hero).toContain("Посмотреть пример");
    expect(hero).toContain(">Войти</Link>");
    expect(hero).toContain("Почему сейчас");
    expect(hero).toContain("Подтверждения");
    expect(hero).toContain("Следующий ход");
    expect(hero).toContain("data-hero-trust-line");
    expect(hero).toContain("Проверяемые факты · официальный контакт · без авторассылки");
    expect(hero).toContain("LANDING_ANALYTICS_EVENT.previewStarted");
    expect(hero).not.toContain("HeroRadar");
    expect(heroCss).toMatch(/\.title\s*\{[\s\S]*?font-size:\s*clamp\(3\.5rem,\s*4\.6vw,\s*4\.25rem\)/);
  });

  test("uses one Pilot decision, centered FAQ, and compact closing CTA", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const browserAudit = source("scripts/verify-landing-production.mjs");
    const conversionCss = source("app/landing/conversion-panel.module.css");
    const landing = source("app/landing/landing.module.css");
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(conversion).toContain('data-conversion-scenes="continuous"');
    expect(conversion).toContain('data-pricing-layout="pilot-decision"');
    expect(conversion).toContain('data-faq-layout="centered"');
    expect(conversion).toContain("Попробовать 7 дней —");
    expect(conversion).toContain("Проверьте радар на своей нише за 7 дней");
    expect(browserAudit).toContain("Проверьте радар на своей нише за 7 дней");
    expect(conversion).toContain("Запустить на 7 дней");
    expect(conversion).toContain("Разовая оплата · без автопродления");
    expect(conversion).toContain("После пилота");
    expect(conversion).toContain("Коротко о главном");

    expect(conversionCss).toContain(".pricingDecision");
    expect(conversionCss).toContain(".faqHeading");
    expect(conversionCss).toContain("width: min(58rem, 100%)");
    expect(conversionCss).toContain("min-height: 26rem");
    expect(landing).not.toContain("--title:");
    expect(landing).not.toMatch(/\.sceneHeading\s*\{[^}]*font-size/);
    expect(visual).toContain("--page-gutter:");
    expect(visual).toContain("--content-max:");
    expect(visual).not.toContain(":global(#pricing [data-pricing-intro] h2)");
    expect(visual).not.toContain(":global(#faq [data-faq-heading] h2)");
    expect(visual).not.toContain("[class*=");
  });

  test("keeps FAQ motion restrained and removable", () => {
    const conversionCss = source("app/landing/conversion-panel.module.css");

    expect(conversionCss).toContain("@keyframes faqReveal");
    expect(conversionCss).not.toContain("@keyframes signalBreath");
    expect(conversionCss).toMatch(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/);
    expect(conversionCss).toMatch(/\.faqList details\[open\] p[\s\S]*?animation:\s*none/);
  });

  test("preserves the manual outreach boundary in one consolidated proof journey", () => {
    const page = source("app/landing/landing-page.tsx");
    const delivery = source("app/landing/delivery-scene.tsx");
    const evidence = source("app/landing/evidence-scene.tsx");

    expect(page).not.toContain("<OutreachScene");
    expect(page).not.toContain("<SignalTimelineScene");
    expect(page).not.toContain("<RadarScene");
    expect(page.indexOf("<EvidenceScene")).toBeLessThan(page.indexOf("<DeliveryScene"));
    expect(delivery).toContain("Сообщения компаниям не отправляются автоматически.");
    expect(delivery).toContain('data-delivery-routes="connected"');
    expect(delivery).toContain("PRIMARY_ROUTES.map");
    expect(delivery).toContain("EXTRA_ROUTES.map");
    expect(delivery).toContain('data-manual-outreach-boundary="true"');
    expect(evidence).toContain('data-proof-story="why-now"');
    expect(evidence).toContain("data-proof-event");
    expect(evidence).toContain("data-proof-brief");
    expect(evidence).toContain("Уровень подтверждения");
    expect(evidence).toContain("Свежесть");
    expect(evidence).toContain("Следующий ход");
  });

  test("keeps FAQ copy professional and free of internal delivery terminology", () => {
    const faq = source("app/landing/landing-faq.ts");

    expect(faq).toContain("Recruiter Radar сам пишет компаниям?");
    expect(faq).toContain("Где я получаю результаты?");
    expect(faq).not.toContain("HTTPS-webhook");
    expect(faq).not.toContain("n8n");
    expect(faq).not.toContain("email digest");
    expect(faq).not.toContain("browser push");
    expect(faq).not.toContain("signed HTTPS webhook");
  });
});
