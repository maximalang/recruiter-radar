import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import pg from "pg";

const { Client } = pg;

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

async function prepareAuthenticatedCheckoutFixture() {
  if (process.env.LANDING_E2E_ALLOW_DB_FIXTURES !== "true") return null;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  assert.ok(databaseUrl, "DATABASE_URL is required for checkout E2E fixtures");
  assert.ok(
    sessionSecret && sessionSecret.length >= 32,
    "SESSION_SECRET is required for checkout E2E fixtures",
  );
  const hostname = new URL(baseUrl).hostname;
  assert.ok(
    hostname === "127.0.0.1" || hostname === "localhost",
    "checkout E2E fixtures are restricted to localhost",
  );

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const email = `landing-e2e-${Date.now()}@example.invalid`;
  const user = await client.query(
    "INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id::text AS id",
    [email, "Landing E2E"],
  );
  const ownerId = user.rows[0].id;
  const mac = createHmac("sha256", sessionSecret)
    .update(`session:${ownerId}`)
    .digest("hex");
  return {
    cookieValue: `${ownerId}.${mac}`,
    async cleanup() {
      await client.query("DELETE FROM users WHERE id = $1", [ownerId]).catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}

await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checkoutFixture = await prepareAuthenticatedCheckoutFixture();

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

async function assertMobileFiurGeometry(page, viewport) {
  const lead = page.locator("details[data-lead-card]").first();
  await lead.waitFor();
  if (!(await lead.evaluate((element) => element.hasAttribute("open")))) {
    await lead.locator("summary").click();
  }

  const meters = lead.locator('[aria-label="Оценка рекомендации"]');
  const triggers = meters.getByRole("button", { name: /Что означает/ });
  const triggerCount = await triggers.count();
  assert.ok(triggerCount > 0, `${viewport.width}px: FIUR triggers are missing`);

  for (let index = 0; index < triggerCount; index += 1) {
    const trigger = triggers.nth(index);
    const header = trigger.locator("..");
    const label = header.locator('[class*="fiurPopoverLabel"]');
    const visual = trigger.locator('[class*="fiurPopoverTriggerVisual"]');
    const [labelBox, triggerBox, visualBox] = await Promise.all([
      label.boundingBox(),
      trigger.boundingBox(),
      visual.boundingBox(),
    ]);
    assert.ok(labelBox && triggerBox && visualBox);
    assert.ok(
      labelBox.x + labelBox.width + 4 <= triggerBox.x,
      `${viewport.width}px: FIUR label overlaps its trigger`,
    );
    assert.ok(
      labelBox.height <= 34,
      `${viewport.width}px: FIUR label exceeds the expected two-line height`,
    );
    assert.ok(
      triggerBox.width >= 44 && triggerBox.height >= 44,
      `${viewport.width}px: FIUR touch target is smaller than 44px`,
    );
    assert.ok(
      visualBox.width >= 22 && visualBox.width <= 26,
      `${viewport.width}px: FIUR visible trigger must be 22-26px`,
    );
  }

  await triggers.first().click();
  const tooltip = lead.getByRole("tooltip");
  await tooltip.waitFor();
  const tooltipBox = await tooltip.boundingBox();
  assert.ok(tooltipBox, `${viewport.width}px: FIUR tooltip has no layout box`);
  assert.ok(
    tooltipBox.x >= 0 &&
      tooltipBox.x + tooltipBox.width <= viewport.width,
    `${viewport.width}px: FIUR tooltip escapes the viewport (${JSON.stringify(tooltipBox)})`,
  );
  await page.keyboard.press("Escape");
}

function eventsMatching(events, name, context) {
  return events.filter((event) =>
    event.name === name && (context === undefined || event.context === context)
  );
}

function assertSingleEvent(events, name, context) {
  const matching = eventsMatching(events, name, context);
  assert.equal(
    matching.length,
    1,
    `expected one ${name}${context ? ` (${context})` : ""}, received ${matching.length}`,
  );
  return matching[0];
}

const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "ru-RU",
});
await desktopContext.route("https://mc.yandex.ru/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
);
if (checkoutFixture) {
  await desktopContext.addCookies([{
    name: "rr_sid",
    value: checkoutFixture.cookieValue,
    url: baseUrl,
    httpOnly: true,
    sameSite: "Lax",
  }]);
}
const page = await desktopContext.newPage();
const pageErrors = [];
const analyticsEvents = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
await page.route("**/api/landing-events", async (route) => {
  const request = route.request();
  const payload = request.postDataJSON();
  assert.deepEqual(
    Object.keys(payload).sort(),
    Object.keys(payload).filter((key) => ["context", "name", "timestamp"].includes(key)).sort(),
    "analytics payload contains a non-contract field",
  );
  analyticsEvents.push(payload);
  await route.fulfill({ status: 204, body: "" });
});

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.getByRole("heading", {
  level: 1,
  name: /Компании, которым нужен подбор/,
}).waitFor();
const landingScrollContract = await page.evaluate(() => {
  const rootStyle = getComputedStyle(document.documentElement);
  const workflow = document.querySelector("#workflow");
  const preview = document.querySelector("#preview");
  return {
    rootSnapType: rootStyle.scrollSnapType,
    rootScrollBehavior: rootStyle.scrollBehavior,
    workflowSnapAlign: workflow ? getComputedStyle(workflow).scrollSnapAlign : null,
    workflowSnapStop: workflow ? getComputedStyle(workflow).scrollSnapStop : null,
    previewSnapStop: preview ? getComputedStyle(preview).scrollSnapStop : null,
  };
});
assert.deepEqual(landingScrollContract, {
  rootSnapType: "y mandatory",
  rootScrollBehavior: "auto",
  workflowSnapAlign: "start",
  workflowSnapStop: "always",
  previewSnapStop: "normal",
});
await page.evaluate(() => window.scrollTo(0, 0));
await page.mouse.move(720, 450);
await page.mouse.wheel(0, 1050);
await page.waitForTimeout(900);
const snappedWorkflowTop = await page.locator("#workflow").evaluate((element) =>
  Math.round(element.getBoundingClientRect().top)
);
assert.ok(
  Math.abs(snappedWorkflowTop - 84) <= 2,
  `wheel navigation must settle on the next section; workflow top=${snappedWorkflowTop}`,
);
await page.evaluate(() => window.scrollTo(0, 0));
await assertNoHorizontalOverflow(page, "desktop");
assert.equal(await page.locator("#yandex-metrika-loader").count(), 1);
assert.equal(await page.locator("canvas").count(), 0);
assert.equal(await page.locator('[data-scroll-progress]').count(), 0);
assert.equal(await page.locator('header a[href="/login"]:visible').count(), 1);
await page.waitForFunction(() =>
  Array.isArray(window.ym?.a) &&
  window.ym.a.some((args) => args[1] === "hit" && args[2] === "/")
);
assertSingleEvent(analyticsEvents, "landing_viewed");

analyticsEvents.length = 0;
await Promise.all([
  page.waitForResponse((response) => {
    const request = response.request();
    return request.url().endsWith("/api/landing-events") &&
      request.postDataJSON().name === "preview_started" &&
      request.postDataJSON().context === "hero_primary";
  }),
  page.locator('[data-analytics-context="hero_primary"]').click(),
]);
await page.waitForFunction(() => window.location.hash === "#preview-configurator");
assertSingleEvent(analyticsEvents, "preview_started", "hero_primary");

analyticsEvents.length = 0;
await Promise.all([
  page.waitForResponse((response) => {
    const request = response.request();
    return request.url().endsWith("/api/landing-events") &&
      request.postDataJSON().name === "preview_results_clicked" &&
      request.postDataJSON().context === "hero_secondary";
  }),
  page.locator('[data-analytics-context="hero_secondary"]').click(),
]);
await page.waitForFunction(() => window.location.hash === "#opportunity-example");
assertSingleEvent(analyticsEvents, "preview_results_clicked", "hero_secondary");

analyticsEvents.length = 0;
await Promise.all([
  page.waitForResponse((response) => {
    const request = response.request();
    return request.url().endsWith("/api/landing-events") &&
      request.postDataJSON().name === "preview_started" &&
      request.postDataJSON().context === "header";
  }),
  page.locator('header [data-analytics-context="header"]:visible').click(),
]);
await page.waitForFunction(() => window.location.hash === "#preview-configurator");
assertSingleEvent(analyticsEvents, "preview_started", "header");

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
await screenshot(page.locator("#opportunity-example"), "opportunity-example-1440x900");
await screenshot(page.locator("#preview"), "preview-desktop-1440x900");

assert.equal(await page.locator('header a[href="#quality"]:visible').count(), 1);
assert.equal(await page.locator('header a[href="#workflow"]:visible').count(), 1);

const firstPreset = page.getByRole("radio").first();
await firstPreset.waitFor();
assert.equal(await page.getByRole("radio", { checked: true }).count(), 0);
await firstPreset.focus();
analyticsEvents.length = 0;
await Promise.all([
  page.waitForURL(/specialization=/),
  firstPreset.press("ArrowRight"),
]);
assert.equal(await page.getByRole("radio", { checked: true }).count(), 1);
assertSingleEvent(analyticsEvents, "preview_started", "preset");

await page.locator("#specialization").fill("промышленный подбор");
await page.locator("#targetCity").fill("Москва");
analyticsEvents.length = 0;
const previewNavigation = page.waitForURL(/specialization=/);
const previewStartedResponse = page.waitForResponse((response) => {
  const request = response.request();
  if (!request.url().endsWith("/api/landing-events")) return false;
  const payload = request.postDataJSON();
  return payload.name === "preview_started" && payload.context === "form";
});
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
await Promise.all([previewNavigation, previewStartedResponse]);
await page.waitForLoadState("networkidle");
assertSingleEvent(analyticsEvents, "preview_started", "form");
assert.equal(eventsMatching(analyticsEvents, "preview_started", "form").length, 1);
const serializedFormEvents = JSON.stringify(analyticsEvents);
assert.equal(serializedFormEvents.includes("промышленный подбор"), false);
assert.equal(serializedFormEvents.includes("Москва"), false);
assert.ok(
  eventsMatching(analyticsEvents, "preview_generated").length <= 1,
  "preview_generated must never be duplicated",
);

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
assert.equal(await methodology.getByRole("listitem").count(), 4);
await methodology.getByText("Reachability").waitFor();
assert.equal(await methodology.getByRole("button").count(), 0);
await screenshot(methodology, "methodology-1440x900");

const workflow = page.locator("#workflow");
assert.equal(await workflow.getByRole("article").count(), 3);
assert.equal(await workflow.getByRole("button").count(), 0);
await screenshot(workflow, "workflow-1440x900");

const delivery = page.locator("#delivery");
await delivery.getByRole("heading", { name: "От сигнала до первого разговора — за одно утро" }).waitFor();
assert.equal(await delivery.locator("ol > li").count(), 3);
assert.equal(await delivery.getByRole("button").count(), 0);
await screenshot(delivery, "delivery-1440x900");

const faq = page.locator("#faq");
analyticsEvents.length = 0;
const faqOpenedResponse = page.waitForResponse((response) => {
  const request = response.request();
  if (!request.url().endsWith("/api/landing-events")) return false;
  return request.postDataJSON().name === "faq_opened";
});
await Promise.all([
  faqOpenedResponse,
  faq.locator("details").first().locator("summary").click(),
]);
assertSingleEvent(analyticsEvents, "faq_opened", "faq");
await faq.locator("details").first().locator("summary").click();
await page.waitForTimeout(350);
assert.equal(eventsMatching(analyticsEvents, "faq_opened", "faq").length, 1);
await screenshot(faq, "faq-1440x900");
await screenshot(page.locator('[class*="closingBand"]'), "closing-cta-1440x900");

analyticsEvents.length = 0;
await Promise.all([
  page.waitForURL(/\/checkout/),
  page.locator('[data-final-cta] [data-analytics-context="closing"]').click(),
]);
assert.equal(
  await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType),
  "none",
  "landing scroll snap must not leak into checkout",
);
const checkoutMetrikaCalls = await page.evaluate(() => window.ym?.a ?? []);
assert.equal(
  checkoutMetrikaCalls.some(
    (args) => args[1] === "hit" && args[2] === "/checkout",
  ),
  false,
);
assertSingleEvent(analyticsEvents, "checkout_started", "closing");
assert.equal(eventsMatching(analyticsEvents, "payment_started").length, 0);
await screenshot(page.locator("main"), "checkout-desktop-1440x900");
const directCheckoutContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "ru-RU",
});
await directCheckoutContext.route("https://mc.yandex.ru/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
);
const directCheckoutPage = await directCheckoutContext.newPage();
await directCheckoutPage.goto(page.url(), { waitUntil: "domcontentloaded" });
assert.equal(
  await directCheckoutPage.locator("#yandex-metrika-loader").count(),
  0,
);
await directCheckoutContext.close();
if (checkoutFixture) {
  analyticsEvents.length = 0;
  const paymentEventRequest = page.waitForRequest((request) => {
    if (!request.url().endsWith("/api/landing-events")) return false;
    return request.postDataJSON().name === "payment_started";
  });
  await page.locator('[data-checkout-form] input[name="agencyName"]').fill("Private Agency");
  await Promise.all([
    paymentEventRequest,
    page.locator("[data-checkout-form]").getByRole("button", { name: /Перейти к оплате/ }).click(),
  ]);
  assertSingleEvent(analyticsEvents, "payment_started", "checkout");
  assert.equal(JSON.stringify(analyticsEvents).includes("Private Agency"), false);
}
await page.goto(baseUrl, { waitUntil: "networkidle" });

const mobileContext = await browser.newContext({
  viewport: { width: 360, height: 800 },
  locale: "ru-RU",
});
await mobileContext.route("https://mc.yandex.ru/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
);
const mobilePage = await mobileContext.newPage();
await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
await assertNoHorizontalOverflow(mobilePage, "mobile");
await screenshot(mobilePage.locator("#main-content"), "hero-mobile-360x800");
await screenshot(mobilePage.locator("#preview"), "preview-mobile-360x800");
const mobileLead = mobilePage.locator("details[data-lead-card]").first();
await mobileLead.waitFor();
if (!(await mobileLead.evaluate((element) => element.hasAttribute("open")))) {
  await mobileLead.locator("summary").click();
}
const mobileMeters = mobileLead.locator('[aria-label="Оценка рекомендации"]');
await screenshot(mobileMeters, "fiur-meters-mobile-360x800");
await assertMobileFiurGeometry(mobilePage, { width: 360, height: 800 });
const mobileFiurTrigger = mobileLead.getByRole("button", { name: /Что означает/ }).first();
await mobileFiurTrigger.click();
const mobileTooltip = mobileLead.getByRole("tooltip");
await mobileTooltip.waitFor();
const tooltipBox = await mobileTooltip.boundingBox();
assert.ok(tooltipBox, "mobile FIUR tooltip must have a layout box");
assert.ok(tooltipBox.x >= 0 && tooltipBox.x + tooltipBox.width <= 360);
await mobilePage.keyboard.press("Escape");

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
await reducedContext.route("https://mc.yandex.ru/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
);
const reducedPage = await reducedContext.newPage();
await reducedPage.goto(baseUrl, { waitUntil: "networkidle" });
await reducedPage.getByRole("heading", { level: 1 }).waitFor();
await assertNoHorizontalOverflow(reducedPage, "reduced-motion");
assert.equal(await reducedPage.locator("canvas").count(), 0);
assert.equal(await reducedPage.locator('header button[aria-pressed]').count(), 0);

const slowContext = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: "ru-RU",
});
await slowContext.route("https://mc.yandex.ru/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
);
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

const endpointErrorContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "ru-RU",
});
await endpointErrorContext.route("https://mc.yandex.ru/**", (route) => route.abort("failed"));
const endpointErrorPage = await endpointErrorContext.newPage();
await endpointErrorPage.route("**/api/landing-events", (route) =>
  route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"test"}' })
);
await endpointErrorPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
await endpointErrorPage.locator('[data-analytics-context="hero_primary"]').click();
await endpointErrorPage.waitForFunction(
  () => window.location.hash === "#preview-configurator",
);

const internalContext = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: "ru-RU",
});
if (checkoutFixture) {
  await internalContext.addCookies([{
    name: "rr_sid",
    value: checkoutFixture.cookieValue,
    url: baseUrl,
    httpOnly: true,
    sameSite: "Lax",
  }]);
}
await internalContext.route("https://mc.yandex.ru/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
);
const internalPage = await internalContext.newPage();
await internalPage.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
assert.equal(await internalPage.locator('[id^="yandex-metrika-"]').count(), 0);
await slowPage.goto(baseUrl, { waitUntil: "commit" });
const heroPreviewCta = slowPage.locator('[data-analytics-context="hero_primary"]');
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
  await context.route("https://mc.yandex.ru/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
  );
  const matrixPage = await context.newPage();
  await matrixPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await matrixPage.getByRole("heading", { level: 1 }).waitFor();
  await assertNoHorizontalOverflow(matrixPage, `${viewport.width}x${viewport.height}`);
  if (viewport.width <= 390) {
    await assertMobileFiurGeometry(matrixPage, viewport);
    const matrixLead = matrixPage.locator("details[data-lead-card]").first();
    await screenshot(
      matrixLead.locator('[aria-label="Оценка рекомендации"]'),
      `fiur-meters-matrix-${viewport.width}x${viewport.height}`,
    );
  }
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
  endpointErrorContext.close(),
  internalContext.close(),
]);
await browser.close();
await checkoutFixture?.cleanup();

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      screenshotDirectory,
      screenshots: 24,
      viewportMatrix: viewportMatrix.map(({ width, height }) => `${width}x${height}`),
      slowPreviewSkeletonObserved: skeletonObserved,
      jsTransfer,
    },
    null,
    2,
  ),
);
