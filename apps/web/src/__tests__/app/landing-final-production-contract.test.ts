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
    expect(hero).toContain("Посмотреть возможности");
    expect(hero).toContain("Уже есть доступ? Войти");
    expect(hero).not.toContain("HeroInstrument");
    expect(hero).toContain("data-hero-trust-line");
    expect(hero).toContain("заявка без списания");
    expect(hero).toContain("разовая оплата");
    expect(hero).toContain("LANDING_ANALYTICS_EVENT.previewStarted");
    expect(hero).not.toContain("Компании подают сигнал.");
  });

  test("renders pricing and FAQ as continuous editorial scenes with explicit structure", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const landing = source("app/landing/landing.module.css");
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
    expect(conversion).toContain("data-conversion-panel");
    expect(conversion).toContain("data-pricing-intro");
    expect(conversion).toContain("data-faq-heading");
    expect(conversion).toContain("data-faq-list");
    expect(visual).toContain(":global([data-conversion-panel])");
    expect(visual).not.toContain("[class*=");
    expect(visual).toContain(".visualSystem :global(#pricing),");
    expect(visual).toContain(".visualSystem :global(#faq) {");
    expect(visual).toContain("max-width: none;");
    expect(landing).toContain("font-size: clamp(2.35rem, 12vw, 3.25rem);");
    expect(visual).toContain(":global(#faq details)");
    expect(visual).toContain("background: transparent;");
  });

  test("keeps FAQ motion restrained and removable", () => {
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(visual).toContain("@keyframes faqReveal");
    expect(visual).not.toContain("@keyframes signalBreath");
    expect(visual).toContain("@media (prefers-reduced-motion: reduce)");
    expect(visual).toMatch(/#faq details\[open\] p[\s\S]*animation: none;/);
  });

  test("preserves the manual outreach boundary inside the reduced composition", () => {
    const page = source("app/landing/landing-page.tsx");
    const delivery = source("app/landing/delivery-scene.tsx");
    const evidence = source("app/landing/evidence-scene.tsx");

    expect(page).not.toContain("<OutreachScene");
    expect(page).not.toContain("<SignalTimelineScene");
    expect(delivery).toContain("Рекомендация приходит автоматически. Обращение отправляете вы.");
    expect(delivery).toContain("Черновик, финальная проверка и отправка остаются в руках пользователя.");
    expect(evidence).toContain("Сигнал найма → доказательство");
    expect(evidence).not.toContain("SOURCE_ROLES");
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
});
