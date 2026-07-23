import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const screenshotDirectory =
  process.env.LANDING_SCREENSHOT_DIR ??
  path.join(os.tmpdir(), "recruiter-radar-landing-production");

const viewportMatrix = [
  { width: 320, height: 700 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${label}: horizontal overflow ${dimensions.scrollWidth}px > ${dimensions.clientWidth}px`,
  );
}

async function screenshot(locator, name) {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: path.join(screenshotDirectory, `${name}.png`) });
}

const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "ru-RU",
});
const page = await desktopContext.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.getByRole("heading", {
  level: 1,
  name: /Компании, которым стоит написать сегодня/,
}).waitFor();
await assertNoHorizontalOverflow(page, "desktop");

const jsTransfer = await page.evaluate(() => {
  const resources = performance
    .getEntriesByType("resource")
    .filter((entry) => entry.name.includes("/_next/static/") && entry.name.includes(".js"));
  return {
    requests: resources.length,
    transferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
    encodedBytes: resources.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
  };
});

await screenshot(page.locator("#main-content"), "hero-desktop-1440x900");
await screenshot(page.locator("#preview"), "preview-desktop-1440x900");

await page.locator("#quality").evaluate((section) => {
  window.scrollTo({
    top: section.getBoundingClientRect().top + window.scrollY - 96,
  });
});
await page.waitForFunction(
  () => document.querySelector('header a[href="#quality"]')?.getAttribute("aria-current") === "location",
);

const firstPreset = page.getByRole("radio").first();
await firstPreset.waitFor();
assert.equal(await page.getByRole("radio", { checked: true }).count(), 0);
await firstPreset.focus();
await Promise.all([
  page.waitForURL(/specialization=/),
  firstPreset.press("ArrowRight"),
]);
assert.equal(await page.getByRole("radio", { checked: true }).count(), 1);

await page.locator("#specialization").fill("промышленный подбор");
await page.locator("#targetCity").fill("Москва");
const previewNavigation = page.waitForURL(/specialization=/);
const submitState = await page.evaluate(() => new Promise((resolve) => {
  const form = document.querySelector("form[data-preview-form]");
  const button = form?.querySelector("[data-preview-submit]");
  if (!(form instanceof HTMLFormElement) || !(button instanceof HTMLButtonElement)) {
    resolve(null);
    return;
  }
  document.addEventListener("submit", () => {
    resolve({
      busy: form.getAttribute("aria-busy"),
      submitting: form.hasAttribute("data-submitting"),
      disabled: button.disabled,
    });
  }, { capture: true, once: true });
  button.click();
}));
assert.deepEqual(submitState, { busy: "true", submitting: true, disabled: true });
await previewNavigation;
await page.waitForLoadState("networkidle");

const lead = page.locator("details[data-lead-card]").first();
await lead.waitFor();
if (!(await lead.evaluate((element) => element.hasAttribute("open")))) {
  await lead.locator("summary").click();
}
await screenshot(lead, "lead-expanded-1440x900");

const fiurTrigger = lead.getByRole("button", { name: /Что означает/ }).first();
await fiurTrigger.click();
await lead.getByRole("tooltip").waitFor();
await page.keyboard.press("Escape");
assert.equal(await lead.getByRole("tooltip").count(), 0);

const methodology = page.getByTestId("landing-methodology");
await methodology.getByRole("button", { name: /Доступность/ }).click();
assert.equal(
  await methodology.getByRole("button", { name: /Доступность/ }).getAttribute("aria-pressed"),
  "true",
);
await screenshot(methodology, "methodology-1440x900");

const howItWorks = page.getByTestId("how-it-works-flow");
const howItWorksFirstStep = howItWorks.getByRole("button").first();
await howItWorksFirstStep.focus();
await howItWorksFirstStep.press("End");
assert.equal(await howItWorks.getAttribute("data-active-step"), "3");

const sourceFlow = page.getByTestId("source-flow");
const sourceFirstLayer = sourceFlow.getByRole("button").first();
await sourceFirstLayer.focus();
await sourceFirstLayer.press("ArrowRight");
assert.equal(await sourceFlow.getAttribute("data-active-layer"), "2");

const delivery = page
  .getByRole("tablist", { name: "Канал доставки примера" })
  .locator("..");
await delivery.getByRole("tab", { name: "Email" }).click();
assert.equal(
  await delivery.getByRole("tab", { name: "Email" }).getAttribute("aria-selected"),
  "true",
);
await delivery.getByRole("button", { name: "Беру в работу" }).click();
assert.equal(
  await delivery.getByRole("button", { name: "Беру в работу" }).getAttribute("aria-pressed"),
  "true",
);
await delivery.getByRole("button", { name: "Сбросить пример" }).click();
assert.equal(
  await delivery.getByRole("button", { name: "Беру в работу" }).getAttribute("aria-pressed"),
  "false",
);
await screenshot(delivery, "delivery-tabs-1440x900");

await screenshot(page.locator("#pricing"), "pricing-1440x900");
const faq = page.locator("#faq");
await faq.locator("details").first().locator("summary").click();
await screenshot(faq, "faq-1440x900");
await screenshot(page.locator('[class*="closingBand"]'), "closing-cta-1440x900");

await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
const backToTop = page.getByRole("button", { name: "Вернуться наверх" });
await backToTop.waitFor();
assert.equal(await backToTop.getAttribute("data-visible"), "true");
const scrollProgress = await page.locator("[data-scroll-progress]").evaluate((element) =>
  Number.parseFloat(getComputedStyle(element).getPropertyValue("--scroll-progress")),
);
assert.ok(scrollProgress > 0.95, `scroll progress should be near completion, received ${scrollProgress}`);
await backToTop.click();
await page.waitForFunction(() => window.scrollY < 4);

const motionControl = page.locator("header button[aria-pressed]");
await motionControl.click();
assert.equal(await motionControl.getAttribute("aria-pressed"), "true");
assert.equal(
  await page.evaluate(() => document.documentElement.dataset.landingMotion),
  "paused",
);

const mobileContext = await browser.newContext({
  viewport: { width: 360, height: 800 },
  locale: "ru-RU",
});
const mobilePage = await mobileContext.newPage();
await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
await assertNoHorizontalOverflow(mobilePage, "mobile");
await screenshot(mobilePage.locator("#main-content"), "hero-mobile-360x800");
await screenshot(mobilePage.locator("#preview"), "preview-mobile-360x800");

const mobileMenuTrigger = mobilePage.locator('button[aria-controls="landing-mobile-menu"]');
await mobileMenuTrigger.click();
assert.equal(await mobileMenuTrigger.getAttribute("aria-expanded"), "true");
await mobilePage.keyboard.press("Escape");
assert.equal(await mobileMenuTrigger.getAttribute("aria-expanded"), "false");
assert.equal(await mobileMenuTrigger.evaluate((element) => element === document.activeElement), true);
await mobileMenuTrigger.click();
await mobilePage.locator("main").click({ position: { x: 1, y: 1 } });
assert.equal(await mobileMenuTrigger.getAttribute("aria-expanded"), "false");

const reducedContext = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  reducedMotion: "reduce",
  locale: "ru-RU",
});
const reducedPage = await reducedContext.newPage();
await reducedPage.goto(baseUrl, { waitUntil: "networkidle" });
const reducedControl = reducedPage.getByRole("button", {
  name: "Движение сокращено настройками системы",
});
await reducedControl.waitFor();
assert.equal(await reducedControl.isDisabled(), true);
assert.equal(
  await reducedPage.evaluate(() => document.documentElement.dataset.landingMotion),
  "reduced",
);

const slowContext = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: "ru-RU",
});
const slowPage = await slowContext.newPage();
const cdp = await slowContext.newCDPSession(slowPage);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 500,
  downloadThroughput: 180 * 1024,
  uploadThroughput: 90 * 1024,
  connectionType: "cellular3g",
});
await slowPage.goto(baseUrl, { waitUntil: "commit" });
const heroPreviewCta = slowPage.getByRole("link", { name: "Настроить мой радар" });
await heroPreviewCta.waitFor();
await heroPreviewCta.click();
await slowPage.waitForFunction(() => window.location.hash === "#preview-configurator");
assert.equal(await slowPage.locator("#preview-configurator").count(), 1);
const skeletonObserved =
  (await slowPage.locator('[aria-label="Загрузка примера радара"]').count()) > 0;
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});

for (const viewport of viewportMatrix) {
  const context = await browser.newContext({ viewport, locale: "ru-RU" });
  const matrixPage = await context.newPage();
  await matrixPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await matrixPage.getByRole("heading", { level: 1 }).waitFor();
  await assertNoHorizontalOverflow(matrixPage, `${viewport.width}x${viewport.height}`);
  await matrixPage.screenshot({
    path: path.join(
      screenshotDirectory,
      `landing-full-${viewport.width}x${viewport.height}.png`,
    ),
    fullPage: true,
  });
  await context.close();
}

assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join(" | ")}`);

await Promise.all([
  desktopContext.close(),
  mobileContext.close(),
  reducedContext.close(),
  slowContext.close(),
]);
await browser.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      screenshotDirectory,
      screenshots: 18,
      viewportMatrix: viewportMatrix.map(({ width, height }) => `${width}x${height}`),
      slowPreviewSkeletonObserved: skeletonObserved,
      jsTransfer,
    },
    null,
    2,
  ),
);
