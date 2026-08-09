import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const expectedEmail = "support@recruiter-radar.ru";
const expectedCity = "Рязань";
const forbiddenEmails = ["6uunn9@gmail.com", "2.dkv@recruiter-radar.ru"];
const failures = [];

const sourceKeys = [
  "footer",
  "legal",
  "terms",
  "privacy",
  "consent",
  "paymentAndRefund",
  "checkout",
  "operator",
  "pricing",
  "metrika",
  "analyticsConsent",
  "legalDocuments",
];
const sources = Object.fromEntries(sourceKeys.map((key) => [key, read(relativePathFor(key))]));

requireText("operator", expectedEmail, "confirmed public support mailbox");
requireText("operator", 'phone: "+7 900 966-60-92"', "confirmed public phone");
requireText("operator", `city: "${expectedCity}"`, "confirmed public seller city");

for (const runtimeFile of collectRuntimeFiles()) {
  const source = fs.readFileSync(runtimeFile, "utf8");
  const relative = path.relative(workspaceRoot, runtimeFile);
  for (const forbidden of forbiddenEmails) {
    if (source.includes(forbidden)) fail(`${relative}: forbidden public/technical email is present: ${forbidden}`);
  }
}

for (const token of [
  "OPERATOR_REQUISITES.fullName",
  "OPERATOR_REQUISITES.inn",
  "OPERATOR_REQUISITES.email",
]) requireText("footer", token, `footer token ${token}`);

for (const route of [
  "/legal",
  "/terms",
  "/payment-and-refund",
  "/privacy",
  "/personal-data-consent",
]) requireFooterRoute(route);

for (const forbidden of ["OPERATOR_REQUISITES.city", "OPERATOR_REQUISITES.phone", "tel:"]) {
  if (sources.footer.includes(forbidden)) fail(`footer: forbidden public contact token ${forbidden}`);
}

for (const token of [
  "LegalDocumentNav",
  "Самозанятый",
  "ИНН",
  "E-mail поддержки",
  "Телефон",
  "Город",
  "Робочеки СМЗ",
  "ИНН покупателя",
]) requireText("legal", token, `legal disclosure ${token}`);

for (const token of [
  "LegalDocumentNav",
  "PUBLIC_PLANS",
  "Robokassa",
  "Разовая оплата без автоматического продления",
  "payment-and-refund",
  "чек через «Мой налог»",
  "ИНН покупателя",
  "10 календарных дней",
  "OPERATOR_REQUISITES.email",
]) requireText("terms", token, `offer requirement ${token}`);

for (const token of [
  "LegalDocumentNav",
  "Что продаётся",
  "Как проходит оплата",
  "Когда предоставляется доступ",
  "Чек самозанятого",
  "Как запросить возврат",
  "Размер возврата",
  "Ошибочный платёж",
  "ИНН покупателя",
  "10 календарных дней",
  "OPERATOR_REQUISITES.email",
]) requireText("paymentAndRefund", token, `payment/refund disclosure ${token}`);

for (const token of [
  "LegalDocumentNav",
  "Категории субъектов",
  "Аккаунт, вход и безопасность",
  "Заказы, платежи, возвраты и чеки НПД",
  "ИНН покупателя-ООО/ИП",
  "ООО «РОБОКАССА» (ИНН 5047063929)",
  "Локализация и трансграничная передача",
  "10 рабочих дней",
  "24 часов",
  "72 часов",
  "5 лет",
  "14 месяцев",
  "до 30 дней",
  "цикла резервного копирования",
  "OPERATOR_REQUISITES.email",
]) requireText("privacy", token, `privacy policy requirement ${token}`);

for (const token of [
  "LegalDocumentNav",
  "отдельный checkbox",
  "Доказательством согласия",
  "Что не входит в это согласие",
  "Яндекс Метрика",
  "Telegram",
  "ИНН покупателя",
  "OPERATOR_REQUISITES.email",
]) requireText("consent", token, `consent requirement ${token}`);

for (const token of [
  'name="acceptTerms"',
  'name="acceptPersonalData"',
  'name="payerType"',
  'name="buyerInn"',
  'href="/terms"',
  'href="/payment-and-refund"',
  'href="/personal-data-consent"',
  'href="/privacy"',
  "Автопродления и скрытых списаний нет",
  "Robokassa",
  "ИНН покупателя",
]) requireText("checkout", token, `checkout requirement ${token}`);

requireText("legalDocuments", "paymentAndRefundRevision", "payment/refund acceptance revision");

if ((sources.pricing.match(/isRecurring: false,/g) ?? []).length !== 3) {
  fail("pricing: every public plan must be a one-off purchase without recurring charges");
}
for (const token of ["299000", "999000", "2499000", "durationDays: 7", "durationDays: 30", "durationDays: 90"]) {
  requireText("pricing", token, `pricing contract ${token}`);
}

for (const token of [
  "Отклонить",
  "Разрешить",
  "CONSENT_TTL_MS = 426",
]) requireText("metrika", token, `analytics consent requirement ${token}`);

for (const token of [
  'ANALYTICS_CONSENT_STORAGE_KEY = "rr_analytics_consent"',
  "ANALYTICS_CONSENT_POLICY_VERSION = 2",
]) requireText("analyticsConsent", token, `versioned analytics consent requirement ${token}`);

if (process.argv.includes("--network")) await verifyDeployedOrigin();

if (failures.length > 0) {
  console.error("Robokassa site criteria failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("Robokassa public-site criteria passed.");

async function verifyDeployedOrigin() {
  const baseValue = process.env.RR_APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!baseValue) {
    fail("network: RR_APP_BASE_URL or NEXT_PUBLIC_APP_URL is required with --network");
    return;
  }

  let base;
  try {
    base = new URL(baseValue);
  } catch {
    fail("network: configured public origin is not a valid absolute URL");
    return;
  }

  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
    fail("network: deployed public origin must use HTTPS");
  }

  const pages = [
    "/",
    "/legal",
    "/terms",
    "/privacy",
    "/personal-data-consent",
    "/payment-and-refund",
    "/checkout?plan=pilot",
    "/checkout?plan=monthly",
    "/checkout?plan=quarterly",
  ];

  for (const page of pages) {
    const requested = new URL(page, base);
    let response;
    try {
      response = await fetch(requested, {
        redirect: "follow",
        headers: { "user-agent": "Recruiter-Radar-Robokassa-Preflight/1.0" },
      });
    } catch (error) {
      fail(`network: ${page} is unreachable (${error instanceof Error ? error.message : "request failed"})`);
      continue;
    }

    if (!response.ok) {
      fail(`network: ${page} returned HTTP ${response.status}`);
      continue;
    }
    if (response.url && new URL(response.url).origin !== base.origin) {
      fail(`network: ${page} redirects outside the configured origin`);
    }

    const html = await response.text();
    for (const forbidden of forbiddenEmails) {
      if (html.includes(forbidden)) fail(`network: ${page} exposes forbidden email ${forbidden}`);
    }
    if (/[<＜](?:фактический|укажите|placeholder)/i.test(html)) {
      fail(`network: ${page} exposes an unfinished placeholder`);
    }
  }

  const home = await fetch(new URL("/", base)).then((response) => response.text()).catch(() => "");
  for (const token of [expectedEmail, "622809740837", "Самозанятый"]) {
    if (!home.includes(token)) fail(`network: footer does not expose ${token}`);
  }
  for (const token of [expectedCity, "+7 900 966-60-92", "tel:+79009666092"]) {
    if (home.includes(token)) fail(`network: footer exposes forbidden phone/location token ${token}`);
  }

  const checkout = await fetch(new URL("/checkout?plan=monthly", base)).then((response) => response.text()).catch(() => "");
  for (const token of ["9 990", "ИНН покупателя", "Robokassa", "Автопродления"]) {
    if (!checkout.includes(token)) fail(`network: checkout does not expose ${token}`);
  }
}

function collectRuntimeFiles() {
  const result = [];
  for (const root of [path.resolve(workspaceRoot, "app"), path.resolve(workspaceRoot, "lib")]) walk(root, result);
  return result;
}

function walk(directory, result) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, result);
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) result.push(absolute);
  }
}

function relativePathFor(key) {
  return {
    footer: "app/ui/site-footer.tsx",
    legal: "app/legal/page.tsx",
    terms: "app/terms/page.tsx",
    privacy: "app/privacy/page.tsx",
    consent: "app/personal-data-consent/page.tsx",
    paymentAndRefund: "app/payment-and-refund/page.tsx",
    checkout: "app/checkout/page.tsx",
    operator: "lib/operatorRequisites.ts",
    pricing: "lib/pricingCatalog.ts",
    metrika: "app/yandex-metrika.tsx",
    analyticsConsent: "lib/analytics-consent.ts",
    legalDocuments: "lib/legalDocuments.ts",
  }[key];
}

function read(relativePath) {
  const absolutePath = path.resolve(workspaceRoot, relativePath);
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch (error) {
    fail(`${relativePath}: file is missing (${error instanceof Error ? error.message : "read failed"})`);
    return "";
  }
}

function requireText(sourceName, token, label) {
  if (!sources[sourceName].includes(token)) fail(`${sourceName}: missing ${label}`);
}

function requireFooterRoute(route) {
  const pattern = new RegExp(`href\\s*[:=]\\s*["']${escapeRegExp(route)}["']`);
  if (!pattern.test(sources.footer)) fail(`footer: missing public route ${route}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  failures.push(message);
}
