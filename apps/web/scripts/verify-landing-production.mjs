import assert from "node:assert/strict";
import { mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const screenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-final-unified-landing");

const viewportMatrix = [
  { width: 1920, height: 1080, name: "desktop-1920x1080" },
  { width: 1440, height: 900, name: "desktop-1440x900" },
  { width: 1366, height: 768, name: "desktop-1366x768" },
  { width: 1280, height: 800, name: "desktop-1280x800" },
  { width: 1180, height: 820, name: "tablet-1180x820" },
  { width: 1024, height: 768, name: "tablet-1024x768" },
  { width: 900, height: 900, name: "tablet-900x900" },
  { width: 768, height: 1024, name: "tablet-768x1024" },
  { width: 390, height: 844, name: "mobile-390x844" },
  { width: 360, height: 800, name: "mobile-360x800" },
  { width: 320, height: 700, name: "mobile-320x700" },
];

const requiredSelectors = [
  "#scene-detection",
  "#scene-timeline",
  "#scene-workspace",
  "#preview-configurator",
  "#preview-results",
  "#scene-evidence",
  "#scene-delivery",
  "#scene-outreach",
  "#pricing",
  "#faq",
  "footer",
];

const hashSpecs = [
  { name: "hash-workspace-1440x900", hash: "scene-workspace", target: "#scene-workspace" },
  { name: "hash-preview-configurator-1440x900", hash: "preview-configurator", target: "#preview-configurator" },
  { name: "hash-preview-results-1440x900", hash: "preview-results", target: "#preview-results" },
  { name: "hash-evidence-1440x900", hash: "scene-evidence", target: "#scene-evidence" },
  { name: "hash-delivery-1440x900", hash: "scene-delivery", target: "#scene-delivery" },
  { name: "hash-pricing-1440x900", hash: "pricing", target: "#pricing" },
  { name: "hash-faq-1440x900", hash: "faq", target: "#faq" },
];

const surfaceSpecs = [
  { name: "hero-1920x1080", width: 1920, height: 1080, mode: "top" },
  { name: "hero-1440x900", width: 1440, height: 900, mode: "top" },
  { name: "hero-1180x820", width: 1180, height: 820, mode: "top" },
  { name: "hero-1024x768", width: 1024, height: 768, mode: "top" },
  { name: "hero-390x844", width: 390, height: 844, mode: "top" },
  { name: "mobile-menu-390x844", width: 390, height: 844, mode: "menu" },
  { name: "preview-1440x900", width: 1440, height: 900, target: "#scene-workspace" },
  { name: "preview-768x1024", width: 768, height: 1024, target: "#scene-workspace" },
  { name: "preview-390x844", width: 390, height: 844, target: "#scene-workspace" },
  { name: "evidence-1440x900", width: 1440, height: 900, target: "#scene-evidence" },
  { name: "delivery-1440x900", width: 1440, height: 900, target: "#scene-delivery" },
  { name: "outreach-1440x900", width: 1440, height: 900, target: "#scene-outreach" },
  { name: "pricing-1440x900", width: 1440, height: 900, target: "#pricing" },
  { name: "pricing-390x844", width: 390, height: 844, target: "#pricing" },
  { name: "faq-390x844", width: 390, height: 844, target: "#faq" },
];

const documentedConsoleAllowlist = [];

function isAllowlistedConsoleMessage(message) {
  return documentedConsoleAllowlist.some((allowed) => (
    allowed.type === message.type && allowed.text === message.text
  ));
}

function attachConsoleGate(page, label) {
  const messages = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      messages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => messages.push({ type: "pageerror", text: error.message }));
  return () => {
    const failures = messages.filter((message) => !isAllowlistedConsoleMessage(message));
    assert.deepEqual(failures, [], `${label}: console warnings/errors: ${JSON.stringify(failures)}`);
  };
}

async function waitForLanding(page) {
  await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });
  await page.locator("#preview-configurator").waitFor({ state: "attached" });
  await page.locator("#preview-results[data-preview-results-ready], #preview-results[data-preview-results-skeleton]")
    .first()
    .waitFor({ state: "attached" });
}

async function resolveAnalyticsConsent(page) {
  const dialog = page.locator("[data-analytics-consent]");
  if (!await dialog.isVisible()) return;

  await dialog.getByRole("button", { name: "Только необходимые" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Изменить настройки cookies" }).waitFor({ state: "visible" });
}

async function preparePage(context, label, url = baseUrl) {
  const page = await context.newPage();
  const assertCleanConsole = attachConsoleGate(page, label);
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.goto(url, { waitUntil: "networkidle" });
  await waitForLanding(page);
  await resolveAnalyticsConsent(page);
  return { page, assertCleanConsole };
}

async function assertRequiredSurface(page, label) {
  for (const selector of requiredSelectors) {
    const locator = page.locator(selector).first();
    assert.equal(await locator.count() > 0, true, `${label}: missing ${selector}`);
    assert.equal(await locator.isVisible(), true, `${label}: hidden ${selector}`);
  }
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    overflow.scrollWidth <= overflow.clientWidth + 1,
    `${label}: horizontal overflow ${overflow.scrollWidth}px > ${overflow.clientWidth}px`,
  );
}

async function assertReachable(page, selector, label) {
  const locator = page.locator(selector).first();
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  const box = await locator.boundingBox();
  assert.ok(box, `${label}: ${selector} has no bounding box`);
  assert.ok(box.width > 0 && box.height > 0, `${label}: ${selector} has no rendered size`);
}

async function capturePage(page, name, fullPage = true) {
  const file = path.join(screenshotDirectory, `${name}.png`);
  await page.screenshot({ path: file, fullPage, animations: "disabled" });
  const info = await stat(file);
  assert.ok(info.size > 0, `${name}: screenshot is empty`);
}

async function auditViewport(browser, spec) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height } });
  const { page, assertCleanConsole } = await preparePage(context, spec.name);
  await assertRequiredSurface(page, spec.name);
  await assertNoHorizontalOverflow(page, spec.name);
  for (const selector of requiredSelectors) {
    await assertReachable(page, selector, spec.name);
  }
  await capturePage(page, spec.name);
  assertCleanConsole();
  await context.close();
}

async function auditHash(browser, spec) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, spec.name, `${baseUrl}/#${spec.hash}`);
  await page.waitForURL(new RegExp(`#${spec.hash}$`));
  await assertReachable(page, spec.target, spec.name);
  await assertNoHorizontalOverflow(page, spec.name);
  assertCleanConsole();
  await context.close();
}

async function auditSurface(browser, spec) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height } });
  const { page, assertCleanConsole } = await preparePage(context, spec.name);
  if (spec.target) {
    await page.locator(spec.target).scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
  }
  if (spec.mode === "menu") {
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await page.getByRole("dialog", { name: "Навигация" }).waitFor({ state: "visible" });
  }
  await assertNoHorizontalOverflow(page, spec.name);
  await capturePage(page, spec.name, false);
  assertCleanConsole();
  await context.close();
}

async function assertPreviewState(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, "preview-state");
  const configurator = page.locator("#preview-configurator");
  await configurator.scrollIntoViewIfNeeded();
  const query = `Acme ${Date.now()}`;
  await configurator.getByLabel("Компания или домен").fill(query);
  await configurator.getByRole("button", { name: "Показать пример" }).click();
  await page.waitForURL(/company=/);
  assert.equal(new URL(page.url()).searchParams.get("company"), query);
  assertCleanConsole();
  await context.close();
}

async function assertHistoryNavigation(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, "history-navigation");
  await page.getByRole("link", { name: "Как работает" }).click();
  await page.waitForURL(/#scene-workspace$/);
  await page.getByRole("link", { name: "Доказательства" }).first().click();
  await page.waitForURL(/#scene-evidence$/);
  await Promise.all([
    page.waitForURL(/#scene-workspace$/),
    page.goBack(),
  ]);
  assert.match(page.url(), /#scene-workspace$/);
  await Promise.all([
    page.waitForURL(/#scene-evidence$/),
    page.goForward(),
  ]);
  assert.match(page.url(), /#scene-evidence$/);
  assertCleanConsole();
  await context.close();
}

async function assertMobileMenu(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, assertCleanConsole } = await preparePage(context, "mobile-menu");
  const trigger = page.getByRole("button", { name: "Открыть меню" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Навигация" });
  await dialog.waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
  await page.keyboard.press("Tab");
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, "focus escaped mobile dialog");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, "focus escaped mobile dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true, "focus did not return to menu trigger");

  await trigger.click();
  await dialog.getByRole("link", { name: "Доказательства" }).click();
  await page.waitForURL(/#scene-evidence$/);
  await dialog.waitFor({ state: "hidden" });
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
  assertCleanConsole();
  await context.close();
}

async function assertKeyboardSkipLink(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, "keyboard-skip-link");

  // preparePage may resolve the first-visit consent UI with a pointer click. Reload
  // after that persisted choice so the keyboard contract starts from the same
  // neutral document focus state as a normal returning visit, not from the
  // element that happened to be involved in consent resolution.
  await page.reload({ waitUntil: "networkidle" });
  await waitForLanding(page);

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Перейти к содержанию" });
  assert.equal(await skipLink.evaluate((element) => element === document.activeElement), true, "skip link is not first focus target");
  const box = await skipLink.boundingBox();
  assert.ok(box && box.y >= 0, "focused skip link remains off-screen");
  await page.keyboard.press("Enter");
  assert.equal(new URL(page.url()).hash, "#main-content");
  assertCleanConsole();
  await context.close();
}

async function assertActiveNavigationAndTone(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, "active-navigation-tone");
  await page.locator("#scene-evidence").scrollIntoViewIfNeeded();
  await page.waitForTimeout(140);
  const evidenceLink = page.getByRole("link", { name: "Доказательства" }).first();
  assert.equal(await evidenceLink.getAttribute("aria-current"), "location");
  const header = page.locator("header").first();
  assert.equal(await header.getAttribute("data-tone"), "dark");
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await page.waitForTimeout(140);
  assert.equal(await header.getAttribute("data-tone"), "light");
  await page.locator("#conversion-final").scrollIntoViewIfNeeded();
  await page.waitForTimeout(140);
  assert.equal(await header.getAttribute("data-tone"), "dark");
  assertCleanConsole();
  await context.close();
}

async function assertConsentContract(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const assertCleanConsole = attachConsoleGate(page, "analytics-consent");
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await waitForLanding(page);

  const dialog = page.locator("[data-analytics-consent]");
  if (await dialog.count()) {
    assert.equal(await dialog.isVisible(), true, "analytics consent dialog is not visible");
    assert.equal(await page.locator('script[src*="mc.yandex.ru/metrika"]').count(), 0, "analytics loaded before consent");
    await dialog.getByRole("button", { name: "Только необходимые" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.locator('script[src*="mc.yandex.ru/metrika"]').count(), 0, "analytics loaded after denial");
    await page.getByRole("button", { name: "Изменить настройки cookies" }).click();
    await dialog.waitFor({ state: "visible" });
    await dialog.getByRole("button", { name: "Разрешить аналитику" }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  assertCleanConsole();
  await context.close();
}

async function assertPreviewBackend(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, "preview-backend");
  const response = await page.request.get(`${baseUrl}/api/public-preview?company=VK`);
  assert.equal(response.ok(), true, `public preview request failed with ${response.status()}`);
  const payload = await response.json();
  assert.ok(payload && typeof payload === "object", "public preview payload missing");
  assertCleanConsole();
  await context.close();
}

async function assertLandingEvents(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const assertCleanConsole = attachConsoleGate(page, "landing-events");
  const seenEvents = [];
  await page.route("**/api/landing-events", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      try {
        seenEvents.push(JSON.parse(request.postData() ?? "{}"));
      } catch {
        seenEvents.push({ parseError: true });
      }
    }
    await route.fulfill({ status: 204 });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await waitForLanding(page);
  await resolveAnalyticsConsent(page);
  await page.getByRole("link", { name: "Как работает" }).click();
  await page.waitForURL(/#scene-workspace$/);
  await page.getByRole("button", { name: "Показать пример" }).first().click();
  await page.waitForTimeout(250);
  assert.ok(seenEvents.length > 0, "landing analytics did not emit events");
  assertCleanConsole();
  await context.close();
}

async function assertScreenshotsExist() {
  const files = await readdir(screenshotDirectory);
  const pngs = files.filter((file) => file.endsWith(".png"));
  assert.ok(pngs.length >= viewportMatrix.length + surfaceSpecs.length, "screenshot matrix is incomplete");
  for (const file of pngs) {
    const info = await stat(path.join(screenshotDirectory, file));
    assert.ok(info.size > 0, `${file}: screenshot is empty`);
  }
}

await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const spec of viewportMatrix) {
    await auditViewport(browser, spec);
  }
  for (const spec of hashSpecs) {
    await auditHash(browser, spec);
  }
  for (const spec of surfaceSpecs) {
    await auditSurface(browser, spec);
  }
  await assertPreviewState(browser);
  await assertHistoryNavigation(browser);
  await assertMobileMenu(browser);
  await assertKeyboardSkipLink(browser);
  await assertActiveNavigationAndTone(browser);
  await assertConsentContract(browser);
  await assertPreviewBackend(browser);
  await assertLandingEvents(browser);
  await assertScreenshotsExist();
} finally {
  await browser.close();
}

console.log("Landing production audit passed.");
