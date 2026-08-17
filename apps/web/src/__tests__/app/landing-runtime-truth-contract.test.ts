import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");
const REPO_ROOT = resolve(WEB_ROOT, "../..");

function webSource(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

function repoSource(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

describe("landing runtime truth contract", () => {
  test("delivery copy exposes every customer-facing delivery surface implemented by runtime", () => {
    const delivery = webSource("app/landing/delivery-scene.tsx");
    const faq = webSource("app/landing/landing-faq.ts");
    const pricing = webSource("lib/pricingCatalog.ts");
    const notificationPlatform = repoSource("packages/db/migrations/20260716010000_add_notification_delivery_platform.sql");
    const aggregateChannels = repoSource("packages/db/migrations/20260627120000_add_delivery_channels_web_push_email.sql");

    expect(notificationPlatform).toContain("provider IN ('telegram', 'vk', 'webhook')");
    expect(aggregateChannels).toContain("web_push_enabled");
    expect(aggregateChannels).toContain("email_digest_enabled");

    for (const label of [
      'title: "Веб-кабинет"',
      'title: "Telegram"',
      'title: "Email"',
      'title: "VK"',
      'title: "Push в браузере"',
      'title: "Webhook"',
    ]) {
      expect(delivery).toContain(label);
    }
    expect(delivery).toContain('status: "Всегда доступен"');
    expect(delivery).toContain('status: "Можно подключить"');
    expect(delivery).not.toContain("VAPID");
    expect(delivery).not.toContain("signed endpoint");
    expect(delivery).not.toContain("n8n");
    expect(delivery).toContain("Сообщения компаниям не отправляются автоматически");

    for (const label of ["Telegram", "email", "другие каналы уведомлений"]) {
      expect(faq).toContain(label);
    }
    expect(faq).not.toContain("остальные способы доставки не входят");
    expect(pricing).not.toContain("Telegram / VK / email / browser push / signed webhook");
    expect(pricing).toContain("рабочие каналы агентства");
  });

  test("compact source copy stays truthful while the FAQ explains runtime roles", () => {
    const evidence = webSource("app/landing/evidence-scene.tsx");
    const landingCopy = webSource("app/landing/landing-copy.ts");
    const faq = webSource("app/landing/landing-faq.ts");
    const policy = JSON.parse(repoSource("packages/db/source-policy.json"));
    const readiness = JSON.parse(repoSource("packages/db/source-readiness.json"));

    for (const sourceId of ["hh", "rabota-rossii", "career-pages", "superjob"]) {
      expect(policy[sourceId].promotionStatus).toBe("digest-allowed");
      expect(readiness.sources[sourceId].eligibility).toBe("digest-eligible");
    }
    expect(readiness.sources.hh.live.state).toBe("blocked");
    expect(readiness.sources["career-pages"].live.state).toBe("verified");
    expect(readiness.sources["rabota-rossii"].live.state).toBe("verified");
    expect(readiness.sources.superjob.live.state).toBe("verified");
    expect(Object.values(policy).map((source: any) => source.promotionStatus)).toEqual(
      expect.arrayContaining([
        "blocked-from-digest-pending-confidence-tests",
        "supporting-evidence-only",
        "never-lead-originating",
      ]),
    );

    expect(evidence).toContain("почему сейчас");
    expect(evidence).toContain("DEMO_EVIDENCE_SOURCES.map");
    expect(evidence).toContain('from "./landing-copy"');
    expect(landingCopy).toContain("Карьерная страница");
    expect(landingCopy).toContain("Публичные вакансии");
    expect(landingCopy).toContain("Прямой источник");
    expect(evidence).not.toContain("SOURCE_ROLES");

    expect(faq).toContain("включая hh.ru, «Работу России» и карьерные страницы");
    expect(faq).toContain("Сайты компаний и данные ФНС используются для проверки организации");
    expect(faq).toContain("официального пути контакта");
    expect(evidence).not.toContain("adapter ready / digest gated");
    expect(evidence).not.toContain("promotion gate");
    expect(faq).not.toContain("lead-originate");
  });

  test("public homepage uses the runtime-grounded FAQ instead of the legacy two-channel copy", () => {
    const homepage = webSource("app/home-page-content.tsx");

    expect(homepage).toContain('import { buildLandingFaqItems } from "./landing/landing-faq";');
    expect(homepage).toContain("buildLandingFaqItems(paymentSetup.configured)");
  });

  test("public preview names shared product signals without claiming production ranking equivalence", () => {
    const workspace = webSource("app/landing/workspace-scene.tsx");
    const previewRelevance = webSource("lib/preview-relevance.ts");

    expect(previewRelevance).toContain("not an output of the production FIUR engine");
    expect(workspace).toContain("те же продуктовые признаки");
    expect(workspace).toContain("Это демонстрационная выдача, а не расчёт вашего рабочего радара");
    expect(workspace).not.toContain("логика приоритета и структура карточек соответствуют рабочей выдаче");
    expect(workspace).not.toContain("тот же алгоритм");
  });
});
