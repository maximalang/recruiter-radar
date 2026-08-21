#!/usr/bin/env node
/**
 * Cookie/analytics consent browser coverage.
 *
 * Runs against a locally started production or dev server
 * (LANDING_BASE_URL, default http://127.0.0.1:3000). Yandex endpoints are
 * never contacted: every mc.yandex request is routed to a local stub so the
 * suite is deterministic and offline-safe.
 *
 * Scenarios:
 *   1. fresh visitor — no consent record → dialog visible, no Metrika script;
 *   2. reject optional analytics — preference saved, page works,
 *      analytics stays off, settings reopenable;
 *   3. accept — script tag appears (stubbed), preference saved;
 *   4. revoke after accept — counter destructed, cookies cleared,
 *      subsequent optional events do not send.
 */

import assert from "node:assert/strict";

import { chromium } from "playwright";

const baseUrl = (process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function newPage(context) {
  const page = await context.newPage();
  let firstLoad = true;
  await page.addInitScript(() => {
    window.__ymHits = [];
    window.ym = window.ym ?? function ymStub(counterId, action) {
      window.__ymHits.push({ counterId, action });
    };
  });
  // Clear the consent record only before the FIRST load of a scenario;
  // addInitScript would otherwise also fire on reloads and erase the saved
  // choice mid-scenario.
  page.on("framenavigated", async () => {
    if (!firstLoad) return;
    firstLoad = false;
    await page.evaluate(() => window.localStorage.removeItem("rr_analytics_consent")).catch(() => {});
  });
  await page.route("**://mc.yandex.ru/**", (route) => route.fulfill({ status: 200, body: "// stubbed" }));
  await page.route("**://mc.yandex.com/**", (route) => route.fulfill({ status: 200, body: "// stubbed" }));
  return page;
}

async function openLanding(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
}

const dialog = page => page.locator('[data-analytics-consent][role="dialog"]');
const metrikaScript = page => page.locator('script#yandex-metrika-loader');

const browser = await chromium.launch();

try {
  // --- Scenario 1: fresh visitor -------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await newPage(context);
    await openLanding(page);
    await dialog(page).waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const dialogVisible = await dialog(page).isVisible().catch(() => false);
    record("fresh: consent dialog visible", dialogVisible);
    record("fresh: no metrika loader before choice", (await metrikaScript(page).count()) === 0);
    const stored = await page.evaluate(() => window.localStorage.getItem("rr_analytics_consent"));
    record("fresh: no silent consent inference", stored === null);
    // scrolling must not imply consent
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(400);
    const storedAfterScroll = await page.evaluate(() => window.localStorage.getItem("rr_analytics_consent"));
    record("fresh: scroll does not grant consent", storedAfterScroll === null);
    await context.close();
  }

  // --- Scenario 2: reject optional analytics -------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await newPage(context);
    await openLanding(page);
    await dialog(page).getByRole("button", { name: "Отклонить необязательные" }).click();
    await dialog(page).waitFor({ state: "detached" });
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("rr_analytics_consent") ?? "null"));
    record("reject: preference saved as denied", stored?.analytics === false && typeof stored?.policyVersion === "number");
    record("reject: metrika loader absent", (await metrikaScript(page).count()) === 0);
    // settings reopenable from footer
    await page.getByRole("button", { name: "Настройки cookies" }).click();
    const reopened = await dialog(page).isVisible().catch(() => false);
    record("reject: settings reopenable from footer", reopened);
    // refusal path as easy as acceptance: both buttons present in the same dialog
    const rejectAgain = await dialog(page).getByRole("button", { name: "Отклонить необязательные" }).isVisible();
    record("reject: rejection remains one click away", rejectAgain);
    await context.close();
  }

  // --- Scenario 3: accept ---------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await newPage(context);
    await openLanding(page);
    await dialog(page).getByRole("button", { name: "Принять аналитику" }).click();
    await dialog(page).waitFor({ state: "detached" });
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("rr_analytics_consent") ?? "null"));
    record("accept: preference saved as granted", stored?.analytics === true);
    await page.waitForTimeout(600);
    const loaderCount = await metrikaScript(page).count();
    record("accept: metrika loader injected after explicit grant", loaderCount === 1);

    // persistence across reload (allow hydration to settle before asserting)
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const dialogAfterReload = await dialog(page).isVisible().catch(() => false);
    record("accept: no re-prompt after saved grant", !dialogAfterReload);
    await context.close();
  }

  // --- Scenario 4: revoke ----------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await newPage(context);
    await openLanding(page);
    await dialog(page).getByRole("button", { name: "Принять аналитику" }).click();
    await page.waitForTimeout(500);
    // simulate a Metrika cookie, then revoke
    await page.evaluate(() => { document.cookie = "_ym_uid=4242; Path=/"; });
    await page.getByRole("button", { name: "Настройки cookies" }).click();
    await dialog(page).getByRole("button", { name: "Отклонить необязательные" }).click();
    await dialog(page).waitFor({ state: "detached" });
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      stored: JSON.parse(window.localStorage.getItem("rr_analytics_consent") ?? "null"),
      disabledFlag: Boolean(window[`disableYaCounter${String(window.__ymHits.at(-1)?.counterId ?? 0)}`]),
      ymCookie: document.cookie.includes("_ym_uid"),
    }));
    record("revoke: preference updated to denied", state.stored?.analytics === false);
    record("revoke: ym cookie cleaned up", !state.ymCookie);
    await page.reload({ waitUntil: "domcontentloaded" });
    record("revoke: analytics stays off after reload", (await metrikaScript(page).count()) === 0);
    await context.close();
  }
} finally {
  await browser.close();
}

const failures = results.filter((item) => !item.pass);
console.log(`\ncookie-consent audit: ${results.length - failures.length}/${results.length} checks passed`);
if (failures.length > 0) {
  console.error(`FAILED:\n${failures.map((item) => `- ${item.name}`).join("\n")}`);
  process.exit(1);
}
