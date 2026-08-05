import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const screenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-signal-lock");

const viewportMatrix = [
  { width: 320, height: 700, name: "mobile-320x700" },
  { width: 390, height: 844, name: "mobile-390x844" },
  { width: 768, height: 1024, name: "tablet-768x1024" },
  { width: 1024, height: 768, name: "desktop-1024x768" },
  { width: 1280, height: 800, name: "desktop-1280x800" },
  { width: 1440, height: 900, name: "desktop-1440x900" },
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

async function assertHashTargets(page, label) {
  const missingTargets = await page.locator('a[href^="#"]').evaluateAll((links) => links.flatMap((link) => {
    const href = link.getAttribute("href");
    if (!href || href === "#") return [];
    const id = decodeURIComponent(href.slice(1));
    return document.getElementById(id) ? [] : [href];
  }));
  assert.deepEqual(missingTargets, [], `${label}: missing hash targets ${missingTargets.join(", ")}`);
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

async function openLanding(context, label) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('[data-landing-experience="signal-lock"]').waitFor();

  assert.equal(await page.locator("h1").count(), 1, `${label}: expected exactly one h1`);
  await page.getByRole("heading", { name: /Кому написать сегодня/ }).waitFor();
  for (const id of [
    "scene-detection",
    "scene-timeline",
    "scene-workspace",
    "scene-evidence",
    "scene-delivery",
    "scene-outreach",
    "pricing",
    "faq",
  ]) {
    assert.equal(await page.locator(`#${id}`).count(), 1, `${label}: missing ${id}`);
  }

  assert.equal(await page.locator("canvas").count(), 0, `${label}: legacy canvas still mounted`);
  assert.equal(await page.locator("[data-hero-tilt]").count(), 0, `${label}: legacy hero tilt still mounted`);
  assert.equal(await page.locator("[data-scroll-progress]").count(), 0, `${label}: legacy scroll progress still mounted`);
  assert.equal(await page.getByText(/NORTH|EAST|SOUTH|WEST/).count(), 0, `${label}: compass labels remain`);

  const heroCta = page.getByRole("link", { name: /Собрать мой радар/ });
  assert.equal(await heroCta.getAttribute("href"), "#preview-configurator");
  const checkoutLink = page.locator('a[data-analytics-event="checkout_started"]').first();
  assert.match(await checkoutLink.getAttribute("href"), /^\/checkout(?:\?|$)/);
  await page.getByRole("link", { name: /Оферта/ }).last().waitFor();
  await page.getByRole("link", { name: /Конфиденциальность/ }).last().waitFor();

  const paymentCopy = await page.locator("#pricing").innerText();
  assert.match(paymentCopy, /заявк\S* без списания|разовая оплата/i);
  const details = page.locator("#faq details").first();
  await details.locator("summary").click();
  assert.ok(await details.evaluate((element) => element.open), `${label}: FAQ did not open`);

  await assertHashTargets(page, label);
  await assertNoHorizontalOverflow(page, label);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: path.join(screenshotDirectory, `${label}-full.png`),
    fullPage: true,
    animations: "disabled",
  });

  assert.deepEqual(pageErrors, [], `${label}: page errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(consoleErrors, [], `${label}: console errors: ${consoleErrors.join(" | ")}`);
  return page;
}

try {
  for (const viewport of viewportMatrix) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "dark",
    });
    const page = await openLanding(context, viewport.name);

    if (viewport.width <= 390) {
      const touchTargets = await page.locator("a, button, summary").evaluateAll((elements) =>
        elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight;
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { text: element.textContent?.trim().slice(0, 40), width: rect.width, height: rect.height };
          }),
      );
      const tooSmall = touchTargets.filter((target) => target.height < 44 || target.width < 44);
      assert.deepEqual(tooSmall, [], `${viewport.name}: mobile touch targets below 44px: ${JSON.stringify(tooSmall)}`);
    }

    if (viewport.name === "desktop-1440x900") {
      await page.locator("#scene-detection").screenshot({
        path: path.join(screenshotDirectory, "hero-desktop-1440x900.png"),
        animations: "disabled",
      });
      await page.locator("#scene-workspace").screenshot({
        path: path.join(screenshotDirectory, "preview-desktop-1440x900.png"),
        animations: "disabled",
      });

      const header = page.locator('header[data-brand-header="signal-lock"]');
      assert.equal(await header.evaluate((element) => getComputedStyle(element).position), "fixed", "desktop: header is not fixed");
      await page.locator("#scene-evidence").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('header[data-brand-header="signal-lock"]')?.hasAttribute("data-scrolled"));
      await page.locator('nav[aria-label="Разделы лендинга"] a[href="#scene-evidence"][aria-current="location"]').waitFor();
    }

    if (viewport.name === "mobile-390x844") {
      const mobileMenu = page.locator("details").filter({ has: page.locator('summary[aria-label*="меню"]') }).first();
      const menuSummary = mobileMenu.locator("summary");
      await menuSummary.click();
      assert.ok(await mobileMenu.evaluate((element) => element.open), "mobile: menu did not open");
      await page.screenshot({
        path: path.join(screenshotDirectory, "mobile-menu-390x844.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      assert.equal(await mobileMenu.evaluate((element) => element.open), false, "mobile: Escape did not close menu");
      await page.waitForFunction((element) => document.activeElement === element, await menuSummary.elementHandle());

      await page.locator("#pricing").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(screenshotDirectory, "pricing-mobile-390x844.png"),
        animations: "disabled",
      });
    }

    await context.close();
  }

  const keyboardContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const keyboardPage = await keyboardContext.newPage();
  await keyboardPage.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await keyboardPage.goto(baseUrl, { waitUntil: "networkidle" });
  await keyboardPage.keyboard.press("Tab");
  const skipLink = keyboardPage.getByRole("link", { name: "Перейти к содержанию" });
  await skipLink.waitFor();
  assert.ok(await skipLink.evaluate((element) => element === document.activeElement), "keyboard: skip link is not the first focus target");
  const skipLinkBox = await skipLink.boundingBox();
  assert.ok(skipLinkBox && skipLinkBox.y >= 0, "keyboard: focused skip link remains off-screen");
  await keyboardPage.keyboard.press("Enter");
  assert.equal(new URL(keyboardPage.url()).hash, "#main-content", "keyboard: skip link did not move to main content");
  await keyboardContext.close();

  const interactionContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const interactionPage = await interactionContext.newPage();
  const analyticsEvents = [];
  await interactionPage.route("**/api/landing-events", (route) => {
    try {
      analyticsEvents.push(route.request().postDataJSON());
    } catch {
      // API route tests cover malformed analytics; this audit records valid client events.
    }
    return route.fulfill({ status: 204 });
  });
  await interactionPage.goto(baseUrl, { waitUntil: "networkidle" });

  const heroPreviewEvent = waitForLandingEvent(interactionPage, "preview_started", "hero_primary");
  await Promise.all([
    heroPreviewEvent,
    interactionPage.getByRole("link", { name: /Собрать мой радар/ }).first().click(),
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
  const reducedPage = await openLanding(reducedContext, "reduced-motion-1440x900");
  const reducedMotionViolations = await reducedPage.locator('[data-landing-experience="signal-lock"] *').evaluateAll((elements) => {
    const exceedsOneMicrosecond = (duration) => duration.split(",").some((value) => Number.parseFloat(value) > 0.000001);

    return elements.slice(0, 100).flatMap((element) => {
      const style = getComputedStyle(element);
      if (!exceedsOneMicrosecond(style.animationDuration) && !exceedsOneMicrosecond(style.transitionDuration)) return [];
      return [{
        element: `${element.tagName.toLowerCase()}.${element.className}`,
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
      }];
    });
  });
  assert.deepEqual(reducedMotionViolations, [], "reduced motion: a visible landing motion effect is still active");
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
    viewports: viewportMatrix.map(({ name }) => name),
    namedScreenshots: [
      "desktop-1440x900-full.png",
      "hero-desktop-1440x900.png",
      "preview-desktop-1440x900.png",
      "mobile-390x844-full.png",
      "mobile-menu-390x844.png",
      "pricing-mobile-390x844.png",
      "no-js-mobile-390x844.png",
    ],
    stickyHeader: true,
    activeNavigation: true,
    mobileMenu: true,
    reducedMotion: true,
    noJavaScript: true,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
