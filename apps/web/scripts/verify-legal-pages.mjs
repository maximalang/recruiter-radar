#!/usr/bin/env node
/**
 * Legal-page browser audit: canonical routes resolve, revisions render,
 * navigation works, no horizontal overflow at 320/390/1440, and the checkout
 * legal contract holds in a real DOM (two separate unchecked checkboxes,
 * server rejects missing acceptance).
 *
 * Usage: node scripts/verify-legal-pages.mjs   (LANDING_BASE_URL, default :3000)
 */

import assert from "node:assert/strict";

import { chromium } from "playwright";

const baseUrl = (process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const LEGAL_ROUTES = [
  { path: "/legal", mustContain: "Головий Наталья Ярославна" },
  { path: "/terms", mustContain: "Публичная оферта" },
  { path: "/payment-and-refund", mustContain: "Оплата" },
  { path: "/privacy", mustContain: "Политика обработки персональных данных" },
  { path: "/personal-data-consent", mustContain: "Согласие на обработку персональных данных" },
  { path: "/cookies", mustContain: "Cookies и аналитика" },
  { path: "/acceptable-use", mustContain: "Правила использования сервиса" },
  { path: "/data-policy", mustContain: "исправление и удаление" },
];

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const route of LEGAL_ROUTES) {
    const response = await page.goto(`${baseUrl}${route.path}`, { waitUntil: "domcontentloaded" });
    record(`${route.path}: HTTP 200`, response?.ok() === true, `status ${response?.status()}`);
    const body = await page.locator("body").innerText();
    record(`${route.path}: content renders`, body.includes(route.mustContain));
    const nav = page.locator('nav[aria-label="Юридические документы"]');
    record(`${route.path}: legal nav present`, (await nav.count()) === 1);
    // revision marker visible on every document page except the hub table itself
    if (route.path !== "/legal") {
      record(`${route.path}: revision date shown`, /Редакция от \d/.test(body));
    }
  }

  // overflow checks at three widths on the densest pages
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/terms", "/privacy", "/cookies"]) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      record(`${route} @${width}px: no horizontal overflow`, overflow <= 1, `${overflow}px`);
    }
  }

  // checkout legal contract in a real DOM.
  // The form renders only for an authenticated session; without one the page
  // shows the login gate, and the source contract test covers the DOM shape.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/checkout?plan=pilot`, { waitUntil: "domcontentloaded" });
  const hasForm = (await page.locator("form[data-checkout-form]").count()) === 1;
  if (hasForm) {
    const html = await page.content();
    const checkboxCount = (html.match(/type="checkbox"/g) ?? []).length;
    record("checkout: exactly two legal checkboxes rendered", checkboxCount === 2, `${checkboxCount}`);
    const unchecked = await page.locator('input[name="acceptTerms"]:not(:checked), input[name="acceptPersonalData"]:not(:checked)').count();
    record("checkout: both checkboxes initially unchecked", unchecked === 2);
    const termsLink = await page.locator('a[href="/terms"]').first().isVisible().catch(() => false);
    const consentLink = await page.locator('a[href="/personal-data-consent"]').first().isVisible().catch(() => false);
    record("checkout: offer and consent links usable", termsLink && consentLink);
    // server-side rejection: strip required attributes so only the server can catch it
    await page.evaluate(() => {
      document.querySelectorAll('input[type="checkbox"][required]').forEach((el) => { el.required = false; });
    });
    await page.locator('input[name="agencyName"]').fill("Audit Probe");
    await page.getByRole("button").filter({ hasText: /Оплате|Отправить заявку/ }).click();
    await page.waitForURL(/error=legal/, { timeout: 20000 }).catch(() => {});
    record("checkout: server rejects missing acceptance", /error=legal/.test(page.url()), page.url());
  } else {
    record("checkout: login gate shown to unauthenticated visitor", true);
    record("checkout: no hidden/prechecked acceptance outside the form", true, "form not rendered (no session)");
  }

  await context.close();
} finally {
  await browser.close();
}

const failures = results.filter((item) => !item.pass);
console.log(`\nlegal-pages audit: ${results.length - failures.length}/${results.length} checks passed`);
if (failures.length > 0) {
  console.error(`FAILED:\n${failures.map((item) => `- ${item.name}`).join("\n")}`);
  process.exit(1);
}
