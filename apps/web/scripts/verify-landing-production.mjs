import assert from "node:assert/strict";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const screenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), `recruiter-radar-final-unified-landing-${process.pid}`);
const requireAnalyticsConsent = process.env.LANDING_REQUIRE_ANALYTICS_CONSENT === "true";

const viewportMatrix = [
  { width: 1920, height: 1080, name: "desktop-1920x1080" },
  { width: 1440, height: 900, name: "desktop-1440x900" },
  { width: 1366, height: 768, name: "desktop-1366x768" },
  { width: 1280, height: 800, name: "desktop-1280x800" },
  { width: 1180, height: 820, name: "tablet-1180x820" },
  { width: 1152, height: 800, name: "tablet-1152x800" },
  { width: 1024, height: 768, name: "tablet-1024x768" },
  { width: 900, height: 900, name: "tablet-900x900" },
  { width: 768, height: 1024, name: "tablet-768x1024" },
  { width: 390, height: 844, name: "mobile-390x844" },
  { width: 360, height: 800, name: "mobile-360x800" },
  { width: 320, height: 700, name: "mobile-320x700" },
];

const requiredSelectors = [
  "#scene-detection",
  "#scene-signal-timeline",
  "#scene-workspace",
  "#preview-configurator",
  "#preview-results",
  "#scene-evidence",
  "#scene-delivery",
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
      const location = message.location();
      messages.push({
        type: message.type(),
        text: message.text(),
        url: location.url || null,
      });
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
  if (!await dialog.isVisible()) {
    assert.equal(requireAnalyticsConsent, false, "analytics consent dialog is required for this audit");
    return;
  }

  await dialog.getByRole("button", { name: "Разрешить", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Настройки cookies" }).waitFor({ state: "visible" });
}

async function preparePage(context, label, url = baseUrl) {
  const page = await context.newPage();
  const assertCleanConsole = attachConsoleGate(page, label);
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.route("https://mc.yandex.ru/metrika/tag.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "/* deterministic analytics loader stub for local browser audit */",
  }));
  await page.goto(url, { waitUntil: "networkidle" });
  await waitForLanding(page);
  await resolveAnalyticsConsent(page);
  return { page, assertCleanConsole };
}

async function assertRequiredSurface(page, label) {
  for (const selector of requiredSelectors) {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: "attached" });
    assert.equal(await locator.count(), 1, `${label}: missing ${selector}`);
  }

  assert.equal(await page.locator("h1").count(), 1, `${label}: expected exactly one h1`);
  assert.match(await page.locator("h1").innerText(), /Компании, которым стоит написать сегодня\./);
  assert.match(await page.locator("#scene-workspace").innerText(), /пример сегодняшней выдачи|приоритет по вашему профилю/i);
  assert.match(await page.locator("#scene-evidence").innerText(), /доказатель|факт/i);
  assert.match(await page.locator("#scene-delivery").innerText(), /Сообщения компаниям не отправляются автоматически/i);
  const pricingText = await page.locator("#pricing").innerText();
  assert.match(pricingText, /Проверьте радар на своей нише за 7 дней/i);
  assert.match(pricingText, /990 ₽/);
  assert.match(pricingText, /2 990 ₽/);
  assert.match(pricingText, /6 990 ₽/);
  assert.match(await page.locator("#faq").innerText(), /Коротко о главном/i);
  await page.getByRole("heading", { name: /Посмотрите, кому стоит написать сейчас/ }).waitFor();
  await page.getByRole("link", { name: /Оферта/ }).last().waitFor();
  await page.getByRole("link", { name: /Конфиденциальность/ }).last().waitFor();
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    Math.max(dimensions.document, dimensions.body) <= dimensions.viewport + 1,
    `${label}: horizontal overflow ${JSON.stringify(dimensions)}`,
  );
}

async function assertAccessibleInteractiveNames(page, label) {
  const unnamed = await page.locator("a, button, summary, input").evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width === 0 || rect.height === 0 || style.display === "none" || style.visibility === "hidden") return [];
    const labelledBy = element.getAttribute("aria-labelledby");
    const label = element.getAttribute("aria-label")
      || (labelledBy ? document.getElementById(labelledBy)?.textContent : "")
      || (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : "")
      || element.textContent;
    return label?.trim() ? [] : [element.outerHTML.slice(0, 180)];
  }));
  assert.deepEqual(unnamed, [], `${label}: unnamed interactive elements: ${unnamed.join(" | ")}`);
}

async function assertControls(page, label) {
  const smallControls = await page.evaluate(() => Array.from(document.querySelectorAll("a, button, input, summary"))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return false;
      return rect.width < 44 || rect.height < 44;
    })
    .slice(0, 20)
    .map((element) => ({
      tag: element.tagName,
      text: element.textContent?.trim().slice(0, 60),
      rect: element.getBoundingClientRect().toJSON(),
    })));

  assert.deepEqual(smallControls, [], `${label}: controls below 44px: ${JSON.stringify(smallControls)}`);
}

async function assertNoOverlapOrClipping(page, label) {
  const issues = await page.evaluate(() => {
    const selectors = [
      "header",
      "#scene-detection h1",
      "#scene-detection figure",
      "#scene-detection article",
      "#preview-configurator",
      "#preview-results",
      "#scene-evidence",
      "#scene-delivery",
      "#pricing",
      "#faq",
      "footer",
    ];
    return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const clipped = ["hidden", "clip"].includes(style.overflow)
        && (element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2);
      const outside = rect.left < -2 || rect.right > document.documentElement.clientWidth + 2;
      return clipped || outside ? [{ selector, clipped, outside, rect: rect.toJSON() }] : [];
    }));
  });
  assert.deepEqual(issues, [], `${label}: clipping/viewport issues ${JSON.stringify(issues)}`);
}

async function assertKeyHeadingBounds(page, label) {
  const issues = await page.evaluate(() => {
    const selectors = [
      "#scene-detection h1",
      "#scene-workspace h2",
      "#scene-evidence h2",
      "#scene-delivery h2",
      "#pricing h2",
      "#faq h2",
      "#conversion-final h2",
    ];
    const viewportWidth = document.documentElement.clientWidth;

    return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).flatMap((heading) => {
      const rect = heading.getBoundingClientRect();
      const canvas = heading.closest("section, [id]")?.getBoundingClientRect();
      const textRects = [];
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        textRects.push(...range.getClientRects());
      }
      const maxGlyphOverhangPx = 12;
      const clipsOwnText = textRects.some((textRect) => (
        textRect.left < rect.left - maxGlyphOverhangPx
        || textRect.right > rect.right + maxGlyphOverhangPx
      ));
      const outsideViewport = rect.left < -1 || rect.right > viewportWidth + 1;
      const outsideCanvas = Boolean(canvas && (rect.left < canvas.left - 1 || rect.right > canvas.right + 1));
      return clipsOwnText || outsideViewport || outsideCanvas
        ? [{ selector, clipsOwnText, outsideViewport, outsideCanvas, rect: rect.toJSON(), canvas: canvas?.toJSON() }]
        : [];
    }));
  });

  assert.deepEqual(issues, [], `${label}: key heading bounds failed ${JSON.stringify(issues)}`);
}

async function assertConsentControlPlacement(page, label) {
  const consentControl = page.getByRole("button", { name: "Настройки cookies", exact: true });
  const consentControlCount = await consentControl.count();
  if (consentControlCount === 0) {
    assert.equal(requireAnalyticsConsent, false, `${label}: analytics consent control is required for this audit`);
    return;
  }
  assert.equal(consentControlCount, 1, `${label}: expected exactly one analytics consent control`);
  assert.equal(
    await consentControl.evaluate((element) => Boolean(element.closest("footer"))),
    true,
    `${label}: analytics consent control must remain in the footer flow`,
  );
}

async function assertHeaderLayout(page, viewport) {
  const desktopNav = page.getByRole("navigation", { name: "Разделы лендинга" });
  const menuButton = page.getByRole("button", { name: "Открыть меню" });
  if (viewport.width >= 960) {
    await desktopNav.waitFor({ state: "visible" });
    assert.equal(await menuButton.isVisible(), false, `${viewport.name}: menu button should be hidden`);
  } else {
    await menuButton.waitFor({ state: "visible" });
    assert.equal(await desktopNav.isVisible(), false, `${viewport.name}: desktop navigation should be hidden`);
  }
}

async function assertHeroGeometry(page, label) {
  const viewport = page.viewportSize();
  assert.ok(viewport, `${label}: missing viewport`);
  const visualSelector = viewport.width <= 600
    ? "[data-mobile-hero-signal]"
    : "[data-hero-visual]";
  for (const selector of ["[data-hero-title]", visualSelector, "[data-hero-actions]"]) {
    const box = await page.locator(selector).first().boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, `${label}: invalid hero surface ${selector}`);
  }

  const visual = await page.locator(visualSelector).boundingBox();
  assert.ok(visual, `${label}: missing ambient hero visual`);
  const minimumVisualWidth = viewport.width <= 600 ? 180 : 280;
  const minimumVisualHeight = viewport.width <= 600 ? 160 : 192;
  assert.ok(visual.width >= Math.min(minimumVisualWidth, viewport.width - 32), `${label}: radar width is not meaningful`);
  assert.ok(visual.height >= minimumVisualHeight, `${label}: radar height is not meaningful`);

  if (viewport.width >= 1024) {
    const primary = await page.locator('#scene-detection [data-analytics-context="hero_primary"]').boundingBox();
    const login = await page.getByRole("link", { name: "Уже есть доступ? Войти" }).boundingBox();
    const trust = await page.locator("#scene-detection [data-hero-trust-line]").boundingBox();
    assert.ok(primary && login && trust, `${label}: missing hero fold surfaces`);
    assert.ok(primary.y + primary.height <= viewport.height, `${label}: primary CTA is below fold`);
    assert.ok(login.y + login.height <= viewport.height, `${label}: login link is below fold`);
    assert.ok(trust.y + trust.height <= viewport.height, `${label}: trust line is below fold`);
    assert.ok(visual.y < viewport.height && visual.x + visual.width > viewport.width * .5, `${label}: radar is not visibly participating in hero`);
  } else if (viewport.width <= 480) {
    const actions = await page.locator("[data-hero-actions]").boundingBox();
    const trust = await page.locator("#scene-detection [data-hero-trust-line]").boundingBox();
    assert.ok(actions && trust, `${label}: missing compact hero controls`);
    assert.ok(actions.x >= -1 && actions.x + actions.width <= viewport.width + 1, `${label}: hero actions escape viewport`);
    assert.ok(trust.x >= -1 && trust.x + trust.width <= viewport.width + 1, `${label}: trust line escapes viewport`);
  }
}

async function assertLeadExpansion(page, label) {
  const leads = page.locator("details[data-lead-card]");
  const count = await leads.count();
  assert.ok(count >= 2, `${label}: expected at least two recommendations, received ${count}`);
  const active = leads.nth(0);
  const secondary = leads.nth(count - 1);
  assert.equal(await active.getAttribute("open"), "", `${label}: top-ranked recommendation must be expanded by default`);
  assert.equal(await active.getAttribute("data-primary-lead"), "true", `${label}: top-ranked recommendation must be the primary lead`);
  await active.getByText("Факты и источники", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await secondary.getAttribute("open"), null, `${label}: secondary recommendation must not be expanded by default`);
  await secondary.locator("summary").click();
  assert.equal(await secondary.getAttribute("open"), "", `${label}: secondary recommendation did not expand`);
  await secondary.getByText("Факты и источники", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await active.getAttribute("open"), null, `${label}: named details did not collapse the previous active recommendation`);
  await active.locator("summary").click();
  assert.equal(await active.getAttribute("open"), "", `${label}: top-ranked recommendation did not restore`);
}

async function measurePageHeight(page, viewport) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(height >= viewport.height, `${viewport.name}: invalid full-page height ${height}px`);
  assert.ok(height <= 24000, `${viewport.name}: runaway full-page height ${height}px`);
  return height;
}

async function saveScreenshot(page, fileName, options = {}) {
  await page.screenshot({
    path: path.join(screenshotDirectory, fileName),
    animations: "disabled",
    ...options,
  });
}

async function revealAllMotionSections(page, label) {
  const selector = '[data-motion-reveal="section"]';
  const sections = page.locator(selector);
  const count = await sections.count();
  assert.ok(count >= 1, `${label}: no motion sections found`);

  for (let index = 0; index < count; index += 1) {
    const section = sections.nth(index);
    await section.scrollIntoViewIfNeeded();
    await section.waitFor({ state: "visible" });
    await page.waitForFunction(
      ({ revealSelector, revealIndex }) => (
        document.querySelectorAll(revealSelector)[revealIndex]?.getAttribute("data-motion-state") === "visible"
      ),
      { revealSelector: selector, revealIndex: index },
    );
  }

  await page.waitForTimeout(1200);
  const pending = await sections.evaluateAll((elements) => elements.flatMap((element, index) => (
    element.getAttribute("data-motion-state") === "visible"
      ? []
      : [{ index, id: element.id || null, state: element.getAttribute("data-motion-state") }]
  )));
  assert.deepEqual(pending, [], `${label}: pending motion sections: ${JSON.stringify(pending)}`);

  const invisible = await sections.evaluateAll((elements) => elements.flatMap((element, index) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none"
      && style.visibility !== "hidden" && Number.parseFloat(style.opacity) > 0
      ? []
      : [{ index, id: element.id || null, rect: rect.toJSON(), opacity: style.opacity, visibility: style.visibility }];
  }));
  assert.deepEqual(invisible, [], `${label}: hidden motion sections: ${JSON.stringify(invisible)}`);

  const timeline = page.locator("#scene-signal-timeline");
  await timeline.waitFor({ state: "visible" });
  const timelineBox = await timeline.boundingBox();
  assert.ok(
    timelineBox && timelineBox.width >= 44 && timelineBox.height >= 44,
    `${label}: signal timeline is missing from the rendered page`,
  );
}

async function assertResponsiveSurface(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const { page, assertCleanConsole } = await preparePage(context, viewport.name);

  await assertRequiredSurface(page, viewport.name);
  await assertHeaderLayout(page, viewport);
  await assertHeroGeometry(page, viewport.name);
  await assertLeadExpansion(page, viewport.name);
  await revealAllMotionSections(page, viewport.name);

  await assertNoHorizontalOverflow(page, viewport.name);
  await assertAccessibleInteractiveNames(page, viewport.name);
  await assertControls(page, viewport.name);
  await assertNoOverlapOrClipping(page, viewport.name);
  await assertKeyHeadingBounds(page, viewport.name);
  await assertConsentControlPlacement(page, viewport.name);
  const fullHeight = await measurePageHeight(page, viewport);

  await page.evaluate(() => window.scrollTo(0, 0));
  if (viewport.name === "desktop-1440x900") {
    await saveScreenshot(page, `desktop-1440x900-full-${fullHeight}px.png`, { fullPage: true });
    await revealAllMotionSections(page, `${viewport.name}-after-screenshot`);
  }
  if (viewport.name === "mobile-390x844") {
    await saveScreenshot(page, `mobile-390x844-full-${fullHeight}px.png`, { fullPage: true });
    await revealAllMotionSections(page, `${viewport.name}-after-screenshot`);
  }

  assertCleanConsole();
  await context.close();
}

async function assertHashNavigation(browser, spec) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, spec.name, `${baseUrl}/#${spec.hash}`);
  const target = page.locator(spec.target).first();
  await target.waitFor({ state: "attached" });
  if (spec.target === "#preview-results") {
    await page.locator("#preview-results[data-preview-results-ready], #preview-results[data-preview-results-skeleton]")
      .first()
      .waitFor({ state: "attached" });
  }
  await page.waitForTimeout(160);
  const firstPosition = await target.evaluate((element) => {
    const header = document.querySelector("header");
    const rect = element.getBoundingClientRect();
    const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
    return { gap: rect.top - headerBottom, top: rect.top };
  });
  assert.ok(firstPosition.gap >= 8 && firstPosition.gap <= 48, `${spec.name}: invalid header gap ${firstPosition.gap}`);
  await page.waitForTimeout(500);
  const secondTop = await target.evaluate((element) => element.getBoundingClientRect().top);
  assert.ok(Math.abs(secondTop - firstPosition.top) <= 3, `${spec.name}: position jumped ${firstPosition.top} -> ${secondTop}`);
  assertCleanConsole();
  await context.close();
}

async function assertHistoryNavigation(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, "hash-history", `${baseUrl}/#scene-workspace`);
  await page.evaluate(() => {
    window.location.hash = "scene-evidence";
  });
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

async function assertMobileKeyboardNavigation(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, assertCleanConsole } = await preparePage(context, "mobile-keyboard");
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
  await dialog.getByRole("link", { name: "Как работает" }).click();
  await page.waitForURL(/#scene-evidence$/);
  await dialog.waitFor({ state: "hidden" });
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
  assertCleanConsole();
  await context.close();
}

async function assertKeyboardSkipLink(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, "keyboard-skip-link");

  // preparePage may resolve first-visit analytics consent with a pointer click.
  // Reload after the persisted choice so this contract starts from a neutral
  // document focus state and verifies the true first keyboard target.
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
  await page.waitForTimeout(180);
  assert.match(await page.locator("header a[aria-current='location']").first().innerText(), /Как работает/);
  assert.equal(await page.locator("header").getAttribute("data-tone"), "dark");
  await page.locator("#scene-delivery").scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  assert.equal(await page.locator("header").getAttribute("data-tone"), "light");
  assertCleanConsole();
  await context.close();
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

async function assertInteractionContracts(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const assertCleanConsole = attachConsoleGate(page, "interaction-contracts");
  const analyticsEvents = [];
  await page.route("https://mc.yandex.ru/metrika/tag.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "/* deterministic analytics loader stub for local browser audit */",
  }));
  await page.route("**/api/landing-events", (route) => {
    try {
      analyticsEvents.push(route.request().postDataJSON());
    } catch {
      // Malformed telemetry is covered by the API contract tests.
    }
    return route.fulfill({ status: 204 });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await waitForLanding(page);
  await resolveAnalyticsConsent(page);

  const heroEvent = waitForLandingEvent(page, "preview_started", "hero_primary");
  await Promise.all([
    heroEvent,
    page.locator('[data-analytics-event="preview_started"][data-analytics-context="hero_primary"]').click(),
  ]);
  assert.equal(new URL(page.url()).hash, "#preview-configurator");

  const presetEvent = waitForLandingEvent(page, "preview_started", "preset");
  await Promise.all([
    presetEvent,
    page.waitForURL((url) => url.searchParams.has("specialization") && url.searchParams.has("targetCity")),
    page.locator("[data-preview-preset]").nth(1).click(),
  ]);
  await page.locator("[data-preview-preset][data-selected]").waitFor({ state: "visible" });

  const privateInclude = "include-secret-8472";
  const privateExclude = "exclude-secret-8472";
  const specialization = "Конфиденциальный инженерный подбор 8472";
  const geography = "Москва секрет 8472";
  const privateUrl = new URL(baseUrl);
  privateUrl.searchParams.set("specialization", "инженерный подбор");
  privateUrl.searchParams.set("targetCity", "Москва");
  privateUrl.searchParams.set("includeKeywords", privateInclude);
  privateUrl.searchParams.set("excludeKeywords", privateExclude);
  privateUrl.hash = "preview-configurator";
  await page.goto(privateUrl.toString(), { waitUntil: "networkidle" });
  await waitForLanding(page);

  await page.getByLabel("Специализация").fill(specialization);
  await page.getByLabel("География").fill(geography);
  const formEvent = waitForLandingEvent(page, "preview_started", "form");
  await Promise.all([
    formEvent,
    page.waitForURL((url) => url.searchParams.get("targetCity") === geography),
    page.locator("[data-preview-submit]").click(),
  ]);
  await page.locator("#preview-results [data-preview-results-ready]").waitFor({ state: "attached" });
  assert.equal(await page.getByLabel("Специализация").inputValue(), specialization);
  assert.equal(await page.getByLabel("География").inputValue(), geography);
  assert.equal(new URL(page.url()).searchParams.get("includeKeywords"), privateInclude);
  assert.equal(new URL(page.url()).searchParams.get("excludeKeywords"), privateExclude);

  const leads = page.locator("details[data-lead-card]");
  const leadCount = await leads.count();
  assert.ok(leadCount >= 2, "interaction: expected at least two recommendations");
  const activeLead = leads.nth(0);
  const secondaryLead = leads.nth(leadCount - 1);
  assert.equal(await activeLead.getAttribute("open"), "", "interaction: top-ranked recommendation is not open by default");
  assert.equal(await activeLead.getAttribute("data-primary-lead"), "true", "interaction: top-ranked recommendation is not primary");
  await secondaryLead.locator("summary").click();
  assert.equal(await secondaryLead.getAttribute("open"), "", "interaction: secondary recommendation did not open");
  await secondaryLead.getByText("Факты и источники", { exact: true }).waitFor({ state: "visible" });

  const companyNames = (await page.locator("[data-lead-company] strong").allTextContents())
    .map((value) => value.trim())
    .filter(Boolean);
  const previewCta = page.locator('#preview-results [data-analytics-event="checkout_started"][data-analytics-context="preview"]');
  assert.equal(await previewCta.count(), 1, "interaction: missing preview checkout CTA");
  assert.match(await previewCta.getAttribute("href"), /^\/checkout(?:\?|$)/);
  const previewCtaBox = await previewCta.boundingBox();
  assert.ok(previewCtaBox && previewCtaBox.width >= 44 && previewCtaBox.height >= 44, "interaction: preview checkout CTA is below 44x44");
  assert.match((await previewCta.innerText()).trim(), /радар|неделю/i);

  const checkoutEvent = waitForLandingEvent(page, "checkout_started", "preview");
  await Promise.all([
    checkoutEvent,
    page.waitForURL((url) => url.pathname === "/checkout"),
    previewCta.click(),
  ]);
  const checkoutEntryPoints = await page.locator('[data-checkout-form], a[href^="/login?returnTo="]').count();
  assert.equal(checkoutEntryPoints, 1, "checkout: expected a checkout form or fail-closed login gate");

  await page.waitForTimeout(30);
  for (const payload of analyticsEvents) {
    const unexpectedKeys = Object.keys(payload).filter((key) => !["name", "context", "timestamp"].includes(key));
    assert.deepEqual(unexpectedKeys, [], `analytics payload has unexpected keys: ${JSON.stringify(payload)}`);
  }
  const serializedAnalytics = JSON.stringify(analyticsEvents);
  for (const privateValue of [specialization, geography, privateInclude, privateExclude, ...companyNames]) {
    assert.equal(serializedAnalytics.includes(privateValue), false, `analytics payload leaked private value: ${privateValue}`);
  }

  assertCleanConsole();
  await context.close();
}

async function assertNoJs(browser) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const assertCleanConsole = attachConsoleGate(page, "no-js-mobile-390x844");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  for (const selector of requiredSelectors) {
    await page.locator(selector).first().waitFor({ state: "attached" });
  }
  assert.match(await page.locator("h1").innerText(), /Компании, которым стоит написать сегодня\./);
  const noJsWorkspaceText = await page.locator("#scene-workspace").innerText();
  assert.match(noJsWorkspaceText, /интерактивный пример/i);
  assert.match(noJsWorkspaceText, /показать компании/i);
  assert.equal(await page.locator("#preview-configurator form").count(), 1, "no-JS configurator missing");
  await page.getByLabel("Специализация").waitFor({ state: "attached" });
  await page.getByLabel("География").waitFor({ state: "attached" });
  await page.locator("#preview-configurator button[type='submit']").waitFor({ state: "attached" });
  const skeleton = page.locator("#preview-results[data-preview-results-skeleton]").first();
  await skeleton.waitFor({ state: "attached" });
  assert.equal(await skeleton.evaluate((element) => element.closest("#preview-results") === element), true, "no-JS skeleton escaped results boundary");
  assert.match(await page.locator("#scene-evidence").innerText(), /доказатель|факт/i);
  assert.match(await page.locator("#scene-delivery").innerText(), /Сообщения компаниям не отправляются автоматически/i);
  const noJsPricingText = await page.locator("#pricing").innerText();
  assert.match(noJsPricingText, /Проверьте радар на своей нише за 7 дней/i);
  assert.match(noJsPricingText, /990 ₽/);
  assert.ok(await page.locator("#faq summary").count() >= 1, "no-JS FAQ question missing");
  await page.getByRole("heading", { name: /Посмотрите, кому стоит написать сейчас/ }).waitFor({ state: "attached" });
  await page.getByRole("link", { name: /Оферта/ }).last().waitFor({ state: "attached" });
  await page.getByRole("link", { name: /Конфиденциальность/ }).last().waitFor({ state: "attached" });
  const followsResults = await page.evaluate(() => {
    const results = document.querySelector("#preview-results");
    const footer = document.querySelector("footer");
    return Boolean(results && footer && (results.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  assert.equal(followsResults, true, "no-JS page ended at the preview skeleton");
  await assertNoHorizontalOverflow(page, "no-js-mobile-390x844");
  assertCleanConsole();
  await context.close();
}

async function assertReducedMotion(browser) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, "reduced-motion-1440x900");
  const violations = await page.locator('[data-landing-experience="signal-lock"] *').evaluateAll((elements) => {
    const activeDuration = (duration) => duration.split(",").some((value) => Number.parseFloat(value) > 0.000001);
    return elements.flatMap((element) => {
      const style = getComputedStyle(element);
      if (!activeDuration(style.animationDuration) && !activeDuration(style.transitionDuration)) return [];
      return [{
        element: `${element.tagName.toLowerCase()}.${element.className}`,
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
      }];
    });
  });
  assert.deepEqual(violations, [], `reduced-motion effects remain: ${JSON.stringify(violations)}`);
  assertCleanConsole();
  await context.close();
}

async function verifyScreenshotArtifact() {
  const files = await readdir(screenshotDirectory);
  assert.ok(files.some((fileName) => /^desktop-1440x900-full-\d+px\.png$/.test(fileName)), "missing desktop full-page screenshot with actual height");
  assert.ok(files.some((fileName) => /^mobile-390x844-full-\d+px\.png$/.test(fileName)), "missing mobile full-page screenshot with actual height");

  const screenshots = files.filter((fileName) => fileName.endsWith(".png")).sort();
  assert.equal(screenshots.length, 2, `expected exactly two landing screenshots, received ${screenshots.length}`);
  const sizes = {};
  for (const fileName of screenshots) {
    const fileStat = await stat(path.join(screenshotDirectory, fileName));
    assert.ok(fileStat.size > 1000, `screenshot is unexpectedly small: ${fileName} (${fileStat.size} bytes)`);
    sizes[fileName] = fileStat.size;
  }
  return { screenshots, sizes };
}

await mkdir(screenshotDirectory, { recursive: true });
for (const fileName of await readdir(screenshotDirectory)) {
  if (/^(desktop-1440x900|mobile-390x844)-full-\d+px\.png$/.test(fileName)) {
    await unlink(path.join(screenshotDirectory, fileName));
  }
}
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

try {
  for (const viewport of viewportMatrix) await assertResponsiveSurface(browser, viewport);
  for (const spec of hashSpecs) await assertHashNavigation(browser, spec);
  await assertHistoryNavigation(browser);
  await assertMobileKeyboardNavigation(browser);
  await assertKeyboardSkipLink(browser);
  await assertActiveNavigationAndTone(browser);
  await assertInteractionContracts(browser);
  await assertNoJs(browser);
  await assertReducedMotion(browser);

  const artifact = await verifyScreenshotArtifact();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    baseUrl,
    analyticsConsentRequired: requireAnalyticsConsent,
    screenshotDirectory,
    matrix: viewportMatrix.map(({ width, height }) => `${width}x${height}`),
    screenshots: artifact.screenshots,
    screenshotSizes: artifact.sizes,
    checks: {
      responsiveMatrix: true,
      interactionAnalytics: true,
      privacyAnalytics: true,
      consoleWarningsAndErrors: true,
      failOpenCta: true,
      noJavaScript: true,
      reducedMotion: true,
      hashNavigation: true,
      keyboardNavigation: true,
      touchTargets: true,
      horizontalOverflow: true,
      clipping: true,
      headingBounds: true,
      consentControlPlacement: true,
      heroFold: true,
    },
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
