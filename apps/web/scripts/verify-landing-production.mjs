import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const screenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-signal-lock");

const screenshotSpecs = [
  { name: "desktop-1920x1080-hero", width: 1920, height: 1080, mode: "viewport" },
  { name: "desktop-1440x900-full", width: 1440, height: 900, mode: "full" },
  { name: "desktop-1440x900-preview", width: 1440, height: 900, target: "#preview-results" },
  { name: "desktop-1366x768-hero", width: 1366, height: 768, mode: "viewport" },
  { name: "desktop-1280x800-hero", width: 1280, height: 800, mode: "viewport" },
  { name: "desktop-1024x768-hero", width: 1024, height: 768, mode: "viewport" },
  { name: "desktop-1024x768-full", width: 1024, height: 768, mode: "full" },
  { name: "tablet-900x900-hero", width: 900, height: 900, mode: "viewport" },
  { name: "tablet-768x1024-full", width: 768, height: 1024, mode: "full" },
  { name: "tablet-768x1024-menu", width: 768, height: 1024, mode: "menu" },
  { name: "tablet-768x1024-preview", width: 768, height: 1024, target: "#preview-results" },
  { name: "mobile-390x844-full", width: 390, height: 844, mode: "full" },
  { name: "mobile-390x844-hero", width: 390, height: 844, mode: "viewport" },
  { name: "mobile-390x844-menu", width: 390, height: 844, mode: "menu" },
  { name: "mobile-390x844-preview", width: 390, height: 844, target: "#preview-results" },
  { name: "mobile-390x844-pricing", width: 390, height: 844, target: "#pricing" },
  { name: "mobile-320x700-hero", width: 320, height: 700, mode: "viewport" },
  { name: "mobile-320x700-full", width: 320, height: 700, mode: "full" },
];

const hashSpecs = [
  { name: "hash-preview-1440x900", hash: "preview-configurator", target: "#preview-configurator" },
  { name: "hash-evidence-1440x900", hash: "scene-evidence", target: "#scene-evidence" },
  { name: "hash-pricing-1440x900", hash: "pricing", target: "#pricing" },
  { name: "hash-faq-1440x900", hash: "faq", target: "#faq" },
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

async function assertAccessibleInteractiveNames(page, label) {
  const unnamed = await page.locator("a, button, summary, input").evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return [];
    const labelledBy = element.getAttribute("aria-labelledby");
    const label = element.getAttribute("aria-label")
      || (labelledBy ? document.getElementById(labelledBy)?.textContent : "")
      || (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : "")
      || element.textContent;
    return label?.trim() ? [] : [element.outerHTML.slice(0, 180)];
  }));
  assert.deepEqual(unnamed, [], `${label}: unnamed interactive elements: ${unnamed.join(" | ")}`);
}

async function assertTouchTargets(page, label) {
  const tooSmall = await page.locator("a, button, summary").evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.top >= window.innerHeight || rect.bottom <= 0) return [];
    return rect.width >= 44 && rect.height >= 44
      ? []
      : [{ text: element.textContent?.trim().slice(0, 48), width: rect.width, height: rect.height }];
  }));
  assert.deepEqual(tooSmall, [], `${label}: touch targets below 44px: ${JSON.stringify(tooSmall)}`);
}

function waitForLandingEvent(page, name, context) {
  return page.waitForRequest((request) => {
    if (!request.url().endsWith("/api/landing-events")) return false;
    try {
      const payload = request.postDataJSON();
      return payload.name === name && payload.context === context;
    } catch {
      return false;
    }
  });
}

async function preparePage(context, label, url = baseUrl) {
  const page = await context.newPage();
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (message.type() === "warning") consoleWarnings.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator('[data-landing-experience="signal-lock"]').waitFor();

  assert.equal(await page.locator("h1").count(), 1, `${label}: expected exactly one h1`);
  await page.getByRole("heading", { name: /Кому написать сегодня/ }).waitFor();
  for (const id of ["scene-detection", "scene-timeline", "scene-evidence", "scene-outreach", "scene-workspace"]) {
    assert.equal(await page.locator(`#${id}`).count(), 1, `${label}: missing ${id}`);
  }
  assert.equal(await page.locator("canvas").count(), 0, `${label}: legacy canvas still mounted`);
  assert.equal(await page.locator("[data-hero-tilt]").count(), 0, `${label}: legacy hero tilt still mounted`);
  assert.equal(await page.locator("[data-scroll-progress]").count(), 0, `${label}: legacy scroll progress still mounted`);

  const heroCta = page.getByRole("link", { name: /Получить пример/ }).first();
  assert.equal(await heroCta.getAttribute("href"), "#preview-configurator");
  const checkoutLink = page.locator('a[data-analytics-event="checkout_started"]').first();
  assert.match(await checkoutLink.getAttribute("href"), /^\/checkout(?:\?|$)/);
  await page.getByRole("link", { name: /Оферта/ }).last().waitFor();
  await page.getByRole("link", { name: /Конфиденциальность/ }).last().waitFor();

  const paymentCopy = await page.locator("#pricing").innerText();
  assert.match(paymentCopy, /заявк\S* без списания|разовая оплата/i);
  await assertNoHorizontalOverflow(page, label);
  await assertAccessibleInteractiveNames(page, label);

  return {
    page,
    assertCleanConsole() {
      assert.deepEqual(pageErrors, [], `${label}: page errors: ${pageErrors.join(" | ")}`);
      assert.deepEqual(consoleErrors, [], `${label}: console errors: ${consoleErrors.join(" | ")}`);
      assert.deepEqual(consoleWarnings, [], `${label}: console warnings: ${consoleWarnings.join(" | ")}`);
    },
  };
}

async function captureSpec(spec) {
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    colorScheme: "dark",
  });
  const { page, assertCleanConsole } = await preparePage(context, spec.name);

  if (spec.width <= 390) await assertTouchTargets(page, spec.name);
  await page.evaluate(() => window.scrollTo(0, 0));

  if (spec.mode === "menu") {
    const trigger = page.getByRole("button", { name: "Открыть меню" });
    await trigger.click();
    await page.getByRole("navigation", { name: "Мобильная навигация" }).waitFor();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden", `${spec.name}: body scroll was not locked`);
    await page.screenshot({
      path: path.join(screenshotDirectory, `${spec.name}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false", `${spec.name}: Escape did not close menu`);
    assert.ok(await trigger.evaluate((element) => element === document.activeElement), `${spec.name}: focus did not return to trigger`);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "", `${spec.name}: body scroll remained locked`);
  } else if (spec.target) {
    await page.locator(spec.target).evaluate((target) => target.scrollIntoView({ block: "start", behavior: "auto" }));
    await page.waitForTimeout(100);
    await page.screenshot({
      path: path.join(screenshotDirectory, `${spec.name}.png`),
      animations: "disabled",
    });
  } else {
    await page.screenshot({
      path: path.join(screenshotDirectory, `${spec.name}.png`),
      fullPage: spec.mode === "full",
      animations: "disabled",
    });
  }

  assertCleanConsole();
  await context.close();
}

async function captureHashSpec(spec) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, spec.name, `${baseUrl}/#${spec.hash}`);
  await page.waitForTimeout(320);
  const placement = await page.locator(spec.target).evaluate((target) => {
    const header = document.querySelector('[data-brand-header="signal-lock"]');
    const targetRect = target.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();
    return { targetTop: targetRect.top, headerBottom: headerRect?.bottom ?? 0 };
  });
  assert.ok(
    placement.targetTop >= placement.headerBottom - 1,
    `${spec.name}: target is hidden by header (${placement.targetTop}px < ${placement.headerBottom}px)`,
  );
  assert.ok(
    placement.targetTop <= placement.headerBottom + 48,
    `${spec.name}: anchor leaves excessive top gap (${placement.targetTop}px vs ${placement.headerBottom}px)`,
  );
  await page.screenshot({
    path: path.join(screenshotDirectory, `${spec.name}.png`),
    animations: "disabled",
  });
  assertCleanConsole();
  await context.close();
}

try {
  for (const spec of screenshotSpecs) await captureSpec(spec);
  for (const spec of hashSpecs) await captureHashSpec(spec);

  const keyboardContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const { page: keyboardPage, assertCleanConsole: assertKeyboardConsole } = await preparePage(keyboardContext, "keyboard");
  await keyboardPage.keyboard.press("Tab");
  const skipLink = keyboardPage.getByRole("link", { name: "Перейти к содержанию" });
  assert.ok(await skipLink.evaluate((element) => element === document.activeElement), "keyboard: skip link is not the first focus target");
  const skipLinkBox = await skipLink.boundingBox();
  assert.ok(skipLinkBox && skipLinkBox.y >= 0, "keyboard: focused skip link remains off-screen");
  await keyboardPage.keyboard.press("Enter");
  assert.equal(new URL(keyboardPage.url()).hash, "#main-content", "keyboard: skip link did not move to main content");
  assertKeyboardConsole();
  await keyboardContext.close();

  const interactionContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const interactionPage = await interactionContext.newPage();
  const analyticsEvents = [];
  await interactionPage.route("**/api/landing-events", (route) => {
    try {
      analyticsEvents.push(route.request().postDataJSON());
    } catch {
      // API route tests validate malformed telemetry separately.
    }
    return route.fulfill({ status: 204 });
  });
  await interactionPage.goto(baseUrl, { waitUntil: "networkidle" });

  const heroPreviewEvent = waitForLandingEvent(interactionPage, "preview_started", "hero_primary");
  await Promise.all([
    heroPreviewEvent,
    interactionPage.getByRole("link", { name: /Получить пример/ }).last().click(),
  ]);
  assert.equal(new URL(interactionPage.url()).hash, "#preview-configurator");

  const presetEvent = waitForLandingEvent(interactionPage, "preview_started", "preset");
  await Promise.all([
    presetEvent,
    interactionPage.waitForURL((url) => url.searchParams.has("specialization")),
    interactionPage.locator("[data-preview-preset]").nth(1).click(),
  ]);
  await interactionPage.locator("[data-preview-preset][data-selected]").waitFor();

  await interactionPage.getByLabel("Специализация").fill("Инженерный подбор");
  await interactionPage.getByLabel("География").fill("Москва");
  const formEvent = waitForLandingEvent(interactionPage, "preview_started", "form");
  await Promise.all([
    formEvent,
    interactionPage.waitForURL((url) => url.searchParams.get("targetCity") === "Москва"),
    interactionPage.locator("[data-preview-submit]").click(),
  ]);
  assert.equal(await interactionPage.getByLabel("Специализация").inputValue(), "Инженерный подбор");
  assert.equal(await interactionPage.getByLabel("География").inputValue(), "Москва");

  const secondLead = interactionPage.locator("details[data-lead-card]").nth(1);
  if (await secondLead.count()) {
    await secondLead.locator("summary").click();
    assert.ok(await secondLead.evaluate((element) => element.open), "workspace: second evidence row did not open");
  }

  const checkoutEvent = waitForLandingEvent(interactionPage, "checkout_started", "preview");
  await Promise.all([
    checkoutEvent,
    interactionPage.waitForURL((url) => url.pathname === "/checkout"),
    interactionPage.locator('#preview-results [data-analytics-event="checkout_started"]').click(),
  ]);
  await interactionPage.getByRole("heading", { name: /Оформление|Подключение/ }).waitFor();
  const checkoutEntryPoints = await interactionPage.locator('[data-checkout-form], a[href^="/login?returnTo="]').count();
  assert.equal(checkoutEntryPoints, 1, "checkout: expected an authorized form or the fail-closed login gate");
  assert.equal(JSON.stringify(analyticsEvents).includes("Инженерный подбор"), false, "analytics included preview form values");
  assert.equal(JSON.stringify(analyticsEvents).includes("Москва"), false, "analytics included preview geography");
  await interactionContext.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const { page: reducedPage, assertCleanConsole: assertReducedConsole } = await preparePage(reducedContext, "reduced-motion-1440x900");
  const reducedMotionViolations = await reducedPage.locator('[data-landing-experience="signal-lock"] *').evaluateAll((elements) => {
    const exceedsOneMicrosecond = (duration) => duration.split(",").some((value) => Number.parseFloat(value) > 0.000001);
    return elements.flatMap((element) => {
      const style = getComputedStyle(element);
      if (!exceedsOneMicrosecond(style.animationDuration) && !exceedsOneMicrosecond(style.transitionDuration)) return [];
      return [{ element: `${element.tagName.toLowerCase()}.${element.className}`, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration }];
    });
  });
  assert.deepEqual(reducedMotionViolations, [], "reduced motion: a visible landing motion effect is still active");
  await reducedPage.screenshot({ path: path.join(screenshotDirectory, "reduced-motion-1440x900.png"), fullPage: true });
  assertReducedConsole();
  await reducedContext.close();

  const noJsContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: false,
  });
  const noJsPage = await noJsContext.newPage();
  await noJsPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await noJsPage.getByRole("heading", { name: /Кому написать сегодня/ }).waitFor();
  assert.equal(await noJsPage.locator("h1").count(), 1);
  await assertNoHorizontalOverflow(noJsPage, "no-js-mobile-390x844");
  await noJsPage.screenshot({ path: path.join(screenshotDirectory, "no-js-mobile-390x844.png"), fullPage: true });
  await noJsContext.close();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    baseUrl,
    screenshotDirectory,
    screenshots: [
      ...screenshotSpecs.map(({ name }) => `${name}.png`),
      ...hashSpecs.map(({ name }) => `${name}.png`),
      "reduced-motion-1440x900.png",
      "no-js-mobile-390x844.png",
    ],
    checks: {
      consoleErrorsAndWarnings: true,
      accessibilityNames: true,
      keyboardNavigation: true,
      mobileMenu: true,
      hashNavigation: true,
      horizontalOverflow: true,
      reducedMotion: true,
      noJavaScript: true,
    },
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
