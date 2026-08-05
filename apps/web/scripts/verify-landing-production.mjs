import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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

const hashTargets = [
  "#scene-workspace",
  "#preview-configurator",
  "#preview-results",
  "#scene-evidence",
  "#scene-delivery",
  "#pricing",
  "#faq",
];

function assertNoConsoleFailures(messages, viewportName) {
  const failures = messages.filter((message) => message.type === "error" || message.type === "pageerror");
  assert.deepEqual(failures, [], `${viewportName}: console/page errors: ${JSON.stringify(failures)}`);
}

async function waitForLanding(page) {
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });
  await page.locator("#preview-configurator").waitFor({ state: "attached" });
  await page.locator("#preview-results").waitFor({ state: "attached" });
}

async function assertRequiredSurface(page, viewportName) {
  for (const selector of requiredSelectors) {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: "attached" });
    assert.equal(await locator.count(), 1, `${viewportName}: missing ${selector}`);
  }

  assert.match(await page.locator("h1").innerText(), /Кому написать сегодня/);
  assert.match(await page.locator("#scene-delivery").innerText(), /не отправляет сообщение компании/i);
  assert.match(await page.locator("#scene-outreach").innerText(), /не отправляет сообщения компаниям автоматически/i);
  assert.match(await page.locator("#pricing").innerText(), /Тарифы|Начните с недели/i);
  assert.match(await page.locator("#faq").innerText(), /Перед запуском|данных, доставки и контроля/i);
}

async function assertNoHorizontalOverflow(page, viewportName) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    Math.max(dimensions.document, dimensions.body) <= dimensions.viewport + 1,
    `${viewportName}: horizontal overflow ${JSON.stringify(dimensions)}`,
  );
}

async function assertControlsAndText(page, viewportName) {
  const violations = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll("a, button, input, summary"));
    const smallControls = controls
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return false;
        return rect.width < 44 || rect.height < 44;
      })
      .slice(0, 12)
      .map((element) => ({ tag: element.tagName, text: element.textContent?.trim().slice(0, 60), rect: element.getBoundingClientRect().toJSON() }));

    const tinyText = Array.from(document.querySelectorAll("main p, main span, main small, main a, main button"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return false;
        const content = element.textContent?.trim() ?? "";
        return content.length > 2 && Number.parseFloat(style.fontSize) < 9;
      })
      .slice(0, 12)
      .map((element) => ({ tag: element.tagName, text: element.textContent?.trim().slice(0, 60), fontSize: getComputedStyle(element).fontSize }));

    return { smallControls, tinyText };
  });

  assert.deepEqual(violations.smallControls, [], `${viewportName}: controls below 44px: ${JSON.stringify(violations.smallControls)}`);
  assert.deepEqual(violations.tinyText, [], `${viewportName}: unreadable text: ${JSON.stringify(violations.tinyText)}`);
}

async function assertNoOverlapOrClipping(page, viewportName) {
  const issues = await page.evaluate(() => {
    const selectors = [
      "#scene-detection h1",
      "#scene-detection article",
      "#preview-configurator",
      "#preview-results",
      "#scene-evidence",
      "#scene-delivery",
      "#scene-outreach",
      "#pricing",
      "#faq",
      "footer",
    ];
    return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const clipped = style.overflow === "hidden" && (element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2);
      const outside = rect.left < -2 || rect.right > document.documentElement.clientWidth + 2;
      return clipped || outside ? [{ selector, clipped, outside, rect: rect.toJSON() }] : [];
    }));
  });
  assert.deepEqual(issues, [], `${viewportName}: clipping/viewport issues ${JSON.stringify(issues)}`);
}

async function assertPageHeight(page, viewport) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const limit = viewport.width <= 390 ? 12000 : viewport.width >= 1366 ? 9500 : 11500;
  assert.ok(height <= limit, `${viewport.name}: full page ${height}px exceeds ${limit}px`);
  return height;
}

async function assertResponsiveSurface(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const messages = [];
  page.on("console", (message) => messages.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => messages.push({ type: "pageerror", text: error.message }));

  await waitForLanding(page);
  await assertRequiredSurface(page, viewport.name);
  await assertNoHorizontalOverflow(page, viewport.name);
  await assertControlsAndText(page, viewport.name);
  await assertNoOverlapOrClipping(page, viewport.name);
  const fullHeight = await assertPageHeight(page, viewport);

  const firstLead = page.locator("[data-primary-lead]").first();
  if (await firstLead.count()) {
    assert.equal(await firstLead.getAttribute("open"), "", `${viewport.name}: first recommendation must be expanded`);
    const scoreSize = await firstLead.locator("[data-lead-score] strong").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    assert.ok(scoreSize >= 22, `${viewport.name}: Radar Score is too small (${scoreSize}px)`);
  }

  const previewCta = page.locator("#preview-results a").last();
  if (await previewCta.count()) {
    const rect = await previewCta.boundingBox();
    assert.ok(rect && rect.height >= 44, `${viewport.name}: preview CTA is not prominent`);
  }

  if (viewport.width <= 1280) {
    await page.getByRole("button", { name: "Открыть меню" }).waitFor({ state: "visible" });
  }

  const fullScreenshot = viewport.name === "desktop-1440x900" || viewport.name === "mobile-390x844";
  await page.screenshot({
    path: path.join(screenshotDirectory, `${viewport.name}-${fullScreenshot ? `full-${fullHeight}px` : "viewport"}.png`),
    fullPage: fullScreenshot,
  });

  assertNoConsoleFailures(messages, viewport.name);
  await context.close();
}

async function assertHashNavigation(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  for (const hash of hashTargets) {
    await page.goto(`${baseUrl}/${hash}`, { waitUntil: "domcontentloaded" });
    const target = page.locator(hash).first();
    await target.waitFor({ state: "attached" });
    if (hash === "#preview-results") {
      await page.locator("#preview-results[data-preview-results-ready], #preview-results[data-preview-results-skeleton]").waitFor({ state: "attached" });
    }
    await page.waitForTimeout(120);
    const firstPosition = await target.evaluate((element) => {
      const header = document.querySelector("header");
      const rect = element.getBoundingClientRect();
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
      return { gap: rect.top - headerBottom, top: rect.top };
    });
    assert.ok(firstPosition.gap >= 8 && firstPosition.gap <= 48, `${viewport.width}x${viewport.height} ${hash}: invalid header gap ${firstPosition.gap}`);
    await page.waitForTimeout(500);
    const secondTop = await target.evaluate((element) => element.getBoundingClientRect().top);
    assert.ok(Math.abs(secondTop - firstPosition.top) <= 3, `${viewport.width}x${viewport.height} ${hash}: position jumped ${firstPosition.top} -> ${secondTop}`);
  }

  await page.goto(`${baseUrl}/#scene-workspace`, { waitUntil: "domcontentloaded" });
  await page.locator("a[href='#scene-evidence']").first().click();
  await page.waitForURL(/#scene-evidence$/);
  await page.goBack();
  assert.match(page.url(), /#scene-workspace$/);
  await page.goForward();
  assert.match(page.url(), /#scene-evidence$/);

  await context.close();
}

async function assertMobileKeyboardNavigation(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await waitForLanding(page);

  const trigger = page.getByRole("button", { name: "Открыть меню" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Навигация по продукту" });
  await dialog.waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");

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

  await context.close();
}

async function assertActiveNavigationAndTone(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await waitForLanding(page);
  await page.locator("#scene-evidence").scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  const active = page.locator("header a[aria-current='location']");
  assert.match(await active.first().innerText(), /Доказательства/);
  assert.equal(await page.locator("header").getAttribute("data-tone"), "dark");
  await page.locator("#scene-delivery").scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  assert.equal(await page.locator("header").getAttribute("data-tone"), "light");
  await context.close();
}

async function assertNoJs(browser) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });

  for (const selector of requiredSelectors) {
    await page.locator(selector).first().waitFor({ state: "attached" });
  }
  assert.equal(await page.locator("#preview-configurator form").count(), 1, "no-JS configurator missing");
  assert.equal(await page.locator("#pricing").count(), 1, "no-JS pricing missing");
  assert.equal(await page.locator("#faq").count(), 1, "no-JS FAQ missing");
  assert.equal(await page.locator("footer").count(), 1, "no-JS footer missing");
  await assertNoHorizontalOverflow(page, "no-js-390x844");
  await context.close();
}

async function assertEmptyPreviewStillKeepsConversion(browser) {
  const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?specialization=zzzz-no-exact-match&targetCity=zzzz#preview-results`, { waitUntil: "domcontentloaded" });
  await page.locator("#pricing").waitFor({ state: "attached" });
  await page.locator("#faq").waitFor({ state: "attached" });
  assert.equal(await page.locator("#pricing").count(), 1);
  assert.equal(await page.locator("#faq").count(), 1);
  await context.close();
}

async function assertReducedMotion(browser) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await waitForLanding(page);
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll("#scene-detection *")).filter((element) => {
    const style = getComputedStyle(element);
    return style.animationName !== "none" && style.animationDuration !== "0s";
  }).map((element) => ({ tag: element.tagName, className: element.className, animation: getComputedStyle(element).animationName })));
  assert.deepEqual(animated, [], `reduced-motion animations remain: ${JSON.stringify(animated)}`);
  await context.close();
}

await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of viewportMatrix) await assertResponsiveSurface(browser, viewport);
  await assertHashNavigation(browser, { width: 390, height: 844 });
  await assertHashNavigation(browser, { width: 768, height: 1024 });
  await assertHashNavigation(browser, { width: 1440, height: 900 });
  await assertMobileKeyboardNavigation(browser);
  await assertActiveNavigationAndTone(browser);
  await assertNoJs(browser);
  await assertEmptyPreviewStillKeepsConversion(browser);
  await assertReducedMotion(browser);
  console.log(`Landing production audit passed. Screenshots: ${screenshotDirectory}`);
} finally {
  await browser.close();
}
