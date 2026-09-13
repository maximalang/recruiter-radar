import { readFileSync } from "node:fs";
import path from "node:path";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PUBLIC_PLANS } from "@/lib/pricingCatalog";

const read = (relative: string): string => readFileSync(path.resolve(process.cwd(), relative), "utf8");

const LEGAL_PAGES: Record<string, string> = {
  legal: "app/legal/page.tsx",
  terms: "app/terms/page.tsx",
  paymentAndRefund: "app/payment-and-refund/page.tsx",
  privacy: "app/privacy/page.tsx",
  personalDataConsent: "app/personal-data-consent/page.tsx",
  cookies: "app/cookies/page.tsx",
  acceptableUse: "app/acceptable-use/page.tsx",
  dataPolicy: "app/data-policy/page.tsx",
};

describe("legal content contracts", () => {
  it("renders every current document revision on its page", () => {
    for (const [key, file] of Object.entries(LEGAL_PAGES)) {
      const source = read(file);
      expect(source).toContain("LEGAL_DOCUMENTS");
      if (key === "legal") {
        // The hub renders the whole document-set revision table.
        expect(source).toMatch(/LEGAL_DOCUMENTS\[\s*document\.revisionKey\s*\]/);
      } else {
        expect(source).toContain(`LEGAL_DOCUMENTS.${key}.displayDate`);
      }
    }
  });

  it("keeps plan prices and durations sourced from PUBLIC_PLANS in terms and payment pages", () => {
    for (const file of ["app/terms/page.tsx", "app/payment-and-refund/page.tsx"]) {
      const source = read(file);
      expect(source).toContain("PUBLIC_PLANS.map");
    }
    expect(PUBLIC_PLANS.map((plan) => plan.durationDays).sort((a, b) => a - b)).toEqual([7, 30, 90]);
    expect(PUBLIC_PLANS.every((plan) => plan.isRecurring === false)).toBe(true);
  });

  it("never hard-codes seller requisites outside the source module", () => {
    for (const file of Object.values(LEGAL_PAGES)) {
      const source = read(file);
      expect(source).not.toContain(OPERATOR_REQUISITES.inn);
      expect(source).not.toContain(OPERATOR_REQUISITES.fullName);
      expect(source).toContain("OPERATOR_REQUISITES");
    }
    // The only allowed literal lives in the source-of-truth module.
    const operator = read("lib/operatorRequisites.ts");
    expect(operator).toContain(OPERATOR_REQUISITES.inn);
  });

  it("does not describe auto-renewal as enabled anywhere in the legal surface", () => {
    for (const [key, file] of Object.entries(LEGAL_PAGES)) {
      const source = read(file);
      expect(/автопродлени[ея]\s+(включ|есть|актив)/i.test(source)).toBe(false);
      if (["terms", "paymentAndRefund"].includes(key)) {
        expect(source).toMatch(/без автопродлени|без автоматического продления|автопродления и скрытых списаний нет|только новым заказом/i);
      }
    }
  });

  it("does not promise automatic outreach or guaranteed commercial results", () => {
    const banned = [/гарантируем\s+клиентов/i, /гарантированные\s+клиенты/i, /автоматически\s+(пишет|отправляет|рассылает)/i, /100%\s+результат/i];
    for (const file of Object.values(LEGAL_PAGES)) {
      const source = read(file);
      for (const pattern of banned) expect(pattern.test(source)).toBe(false);
    }
    expect(read("app/acceptable-use/page.tsx")).toMatch(/не отправляет/);
  });

  it("keeps checkout with two separate unchecked legal checkboxes", () => {
    const checkout = read("app/checkout/page.tsx");
    expect(checkout).toContain('name="acceptTerms"');
    expect(checkout).toContain('name="acceptPersonalData"');
    expect((checkout.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(checkout).not.toMatch(/type="checkbox"[^>]*defaultChecked/);
    expect(checkout).not.toMatch(/type="checkbox"[^>]*checked/);
  });

  it("links the cookie policy and settings from the legal surface", () => {
    expect(read("app/cookies/page.tsx")).toContain("Настройки cookies");
    const privacy = read("app/privacy/page.tsx");
    expect(privacy).toContain('href="/cookies"');
    const footer = read("app/ui/site-footer.tsx");
    expect(footer).toContain('href="/cookies"');
  });

  it("keeps optional analytics consent-gated in the loader", () => {
    const metrika = read("app/yandex-metrika.tsx");
    expect(metrika).toContain('consent === "granted"');
    expect(metrika).toContain("Отклонить необязательные");
    expect(metrika).toContain("Принять аналитику");
    expect(metrika).toContain('href="/cookies"');
  });

  it("records no full card or CVC fields in checkout and states the boundary", () => {
    const checkout = read("app/checkout/page.tsx");
    expect(checkout).not.toMatch(/name="(card|cardNumber|cvc|cvv|expiry)"/i);
    expect(checkout).toMatch(/CVC вводятся только на защищённой платёжной странице/);
    expect(read("app/personal-data-consent/page.tsx")).toContain("не получает и не хранит полный номер карты");
  });

  it("does not waive mandatory consumer rights in refund wording", () => {
    const payment = read("app/payment-and-refund/page.tsx");
    const terms = read("app/terms/page.tsx");
    for (const source of [payment, terms]) {
      expect(source).not.toMatch(/возврат\w*\s+невозможен|возвраты\s+не\s+производятся/i);
      expect(source).toMatch(/не ограничивает более широкие обязательные права/);
    }
  });

  it("keeps the legal navigation covering every canonical document", () => {
    const nav = read("app/ui/legal-document-nav.tsx");
    for (const href of ["/legal", "/terms", "/payment-and-refund", "/privacy", "/personal-data-consent", "/cookies", "/acceptable-use", "/data-policy"]) {
      expect(nav).toContain(`href: "${href}"`);
    }
    const footer = read("app/ui/site-footer.tsx");
    for (const href of ["/legal", "/terms", "/payment-and-refund", "/privacy", "/cookies"]) {
      expect(footer).toContain(`href="${href}"`);
    }
  });

  it("states that no advertising mailings are performed", () => {
    expect(read("app/privacy/page.tsx")).toMatch(/Рекламные \(промо\) рассылки сервисом не выполняются/);
    expect(read("app/personal-data-consent/page.tsx")).toMatch(/не выполняются и в это согласие не входят/);
  });
});
