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

    for (const label of ["Веб-кабинет", "Telegram", "VK", "Email digest", "Browser push", "Signed webhook"]) {
      expect(delivery).toContain(label);
    }

    for (const label of ["Telegram", "VK", "email-дайджесте", "браузерных уведомлениях", "защищённый HTTPS-webhook"]) {
      expect(faq).toContain(label);
    }
    expect(faq).not.toContain("остальные способы доставки не входят");
    expect(pricing).toContain("Telegram / VK / email / browser push / signed webhook");
  });

  test("source copy preserves runtime roles while presenting them in customer language", () => {
    const evidence = webSource("app/landing/evidence-scene.tsx");
    const faq = webSource("app/landing/landing-faq.ts");
    const registry = repoSource("packages/db/scripts/source-registry.mjs");

    expect(registry).toContain("hh: sourcePolicy");
    expect(registry).toContain("'rabota-rossii': sourcePolicy");
    expect(registry).toContain("'career-pages': sourcePolicy");
    expect(registry).toContain("promotionStatus: 'digest-allowed'");
    expect(registry).toContain("blocked-from-digest-pending-confidence-tests");
    expect(registry).toContain("supporting-evidence-only");
    expect(registry).toContain("never-lead-originating");

    expect(evidence).toContain("Дают основной сигнал найма");
    expect(evidence).toContain("Подтверждают компанию");
    expect(evidence).toContain("Расширяют покрытие после проверки");
    expect(evidence).toContain("Добавляют бизнес-контекст");
    expect(evidence).toContain('state: "live"');
    expect(evidence).toContain('state: "support"');
    expect(evidence).toContain('state: "gated"');
    expect(evidence).toContain('state: "context"');
    expect(evidence).toContain("Хабр Карьера");
    expect(evidence).toContain("SuperJob");
    expect(evidence).toContain("ATS");
    expect(evidence).toContain("GDELT");

    expect(faq).toContain("влияют на выдачу только после проверки качества и стабильности данных");
    expect(evidence).not.toContain("adapter ready / digest gated");
    expect(evidence).not.toContain("promotion gate");
    expect(faq).not.toContain("lead-originate");
  });

  test("public homepage uses the runtime-grounded FAQ instead of the legacy two-channel copy", () => {
    const homepage = webSource("app/home-page-content.tsx");

    expect(homepage).toContain('import { buildLandingFaqItems } from "./landing/landing-faq";');
    expect(homepage).toContain("buildLandingFaqItems(paymentSetup.configured)");
  });
});
