import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const screenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-landing", "screenshots");
const reportDirectory = path.dirname(screenshotDirectory);
const reportPath = path.join(reportDirectory, "accessibility-contrast-geometry.json");

const deliveryMatrix = [
  { width: 320, height: 568, name: "320x568" },
  { width: 390, height: 844, name: "390x844" },
  { width: 768, height: 1024, name: "768x1024" },
  { width: 820, height: 1180, name: "820x1180" },
  { width: 900, height: 900, name: "900x900" },
  { width: 1024, height: 768, name: "1024x768" },
  { width: 1280, height: 800, name: "1280x800" },
  { width: 1440, height: 900, name: "1440x900" },
  { width: 1920, height: 1080, name: "1920x1080" },
];

const results = { contrast: [], focus: [], headerTone: [], delivery: [] };

function attachConsoleGate(page, label) {
  const messages = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      messages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => messages.push({ type: "pageerror", text: error.message }));
  return () => assert.deepEqual(messages, [], `${label}: console warnings/errors: ${JSON.stringify(messages)}`);
}

async function preparePage(context, label, url = baseUrl) {
  const page = await context.newPage();
  const assertCleanConsole = attachConsoleGate(page, label);
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.route("https://mc.yandex.ru/metrika/tag.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "/* deterministic analytics loader stub for focused accessibility audit */",
  }));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });

  const consent = page.getByRole("button", { name: "Разрешить", exact: true });
  if (await consent.isVisible()) {
    await consent.click();
    await consent.waitFor({ state: "hidden" });
  }
  return { page, assertCleanConsole };
}

async function readContrast(locator, backgroundSelector = null) {
  return locator.evaluate((element, explicitBackgroundSelector) => {
    const parseChannel = (value) => value.trim().endsWith("%")
      ? Number.parseFloat(value) / 100
      : Number.parseFloat(value) / 255;
    const parseAlpha = (value) => value.trim().endsWith("%")
      ? Number.parseFloat(value) / 100
      : Number.parseFloat(value);
    const parseColor = (value) => {
      const color = value.trim().toLowerCase();
      if (color === "transparent") return [0, 0, 0, 0];
      if (color.startsWith("color(srgb")) {
        const [channelsPart, alphaPart] = color.slice("color(srgb".length, -1).trim().split("/").map((part) => part.trim());
        const channels = channelsPart.split(/\s+/).map(Number);
        if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) throw new Error(`Invalid computed color: ${value}`);
        return [...channels, alphaPart ? parseAlpha(alphaPart) : 1];
      }
      if (color.startsWith("rgb(") || color.startsWith("rgba(")) {
        const [channelsPart, alphaPart] = color.slice(color.indexOf("(") + 1, -1).replaceAll(",", " ").trim().split("/").map((part) => part.trim());
        const tokens = channelsPart.split(/\s+/).filter(Boolean);
        let alpha = alphaPart ? parseAlpha(alphaPart) : 1;
        if (tokens.length === 4) alpha = parseAlpha(tokens.pop());
        const channels = tokens.map(parseChannel);
        if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) throw new Error(`Invalid computed color: ${value}`);
        return [...channels, alpha];
      }
      throw new Error(`Unsupported computed color: ${value}`);
    };
    const composite = (top, bottom) => {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / alpha,
        (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / alpha,
        (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / alpha,
        alpha,
      ];
    };
    const effectiveBackground = (target) => {
      const layers = [];
      for (let node = target; node instanceof Element; node = node.parentElement) {
        layers.push(parseColor(getComputedStyle(node).backgroundColor));
      }
      let rendered = [0, 0, 0, 0];
      for (const layer of layers.reverse()) rendered = composite(layer, rendered);
      return rendered[3] < 1 ? composite(rendered, [1, 1, 1, 1]) : rendered;
    };
    const linear = (channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    const luminance = (color) => 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
    const ratio = (first, second) => {
      const high = Math.max(luminance(first), luminance(second));
      const low = Math.min(luminance(first), luminance(second));
      return (high + 0.05) / (low + 0.05);
    };
    const printable = (color) => `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3].toFixed(3)})`;

    const style = getComputedStyle(element);
    const explicitBackground = explicitBackgroundSelector ? document.querySelector(explicitBackgroundSelector) : null;
    const background = effectiveBackground(explicitBackground ?? element);
    const computedForeground = parseColor(style.color);
    const foreground = computedForeground[3] < 1 ? composite(computedForeground, background) : computedForeground;
    return {
      ratio: ratio(foreground, background),
      foreground: printable(foreground),
      background: printable(background),
      computedColor: style.color,
      computedBackground: style.backgroundColor,
      fontSize: Number.parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
      text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 160) ?? "",
    };
  }, backgroundSelector);
}

async function assertContrast(locator, label, minimum = 4.5, backgroundSelector = null) {
  await locator.waitFor({ state: "visible" });
  const measurement = await readContrast(locator, backgroundSelector);
  results.contrast.push({ label, minimum, ...measurement });
  assert.ok(
    measurement.ratio >= minimum,
    `${label}: contrast ${measurement.ratio.toFixed(2)}:1 is below ${minimum}:1 (${measurement.foreground} on ${measurement.background})`,
  );
  return measurement;
}

async function assertFocus(page, locator, label, backgroundSelector = null) {
  await locator.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const focus = await locator.evaluate((element, explicitBackgroundSelector) => {
    const toRgba = (value) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      probe.style.position = "fixed";
      probe.style.visibility = "hidden";
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      const numbers = resolved.match(/[\d.]+/g)?.map(Number) ?? [];
      return [numbers[0] / 255, numbers[1] / 255, numbers[2] / 255, numbers[3] ?? 1];
    };
    const composite = (top, bottom) => {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / alpha,
        (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / alpha,
        (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / alpha,
        alpha,
      ];
    };
    const effectiveBackground = (target) => {
      const layers = [];
      for (let node = target; node instanceof Element; node = node.parentElement) layers.push(toRgba(getComputedStyle(node).backgroundColor));
      let rendered = [0, 0, 0, 0];
      for (const layer of layers.reverse()) rendered = composite(layer, rendered);
      return rendered[3] < 1 ? composite(rendered, [1, 1, 1, 1]) : rendered;
    };
    const linear = (channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    const luminance = (color) => 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
    const ratio = (first, second) => (Math.max(luminance(first), luminance(second)) + 0.05) / (Math.min(luminance(first), luminance(second)) + 0.05);

    const style = getComputedStyle(element);
    const explicitBackground = explicitBackgroundSelector ? document.querySelector(explicitBackgroundSelector) : null;
    const adjacent = effectiveBackground(explicitBackground ?? element.parentElement ?? element);
    const outline = toRgba(style.outlineColor);
    return {
      active: document.activeElement === element,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineColor: style.outlineColor,
      outlineContrast: ratio(outline[3] < 1 ? composite(outline, adjacent) : outline, adjacent),
    };
  }, backgroundSelector);

  assert.equal(focus.active, true, `${label}: element did not receive focus`);
  assert.notEqual(focus.outlineStyle, "none", `${label}: focus outline is missing`);
  assert.ok(focus.outlineWidth >= 2, `${label}: focus outline is thinner than 2px`);
  assert.ok(focus.outlineOffset >= 2, `${label}: focus outline needs separation from the control`);
  assert.ok(focus.outlineContrast >= 3, `${label}: focus indicator contrast ${focus.outlineContrast.toFixed(2)}:1 is below 3:1`);
  results.focus.push({ label, ...focus });
  await assertContrast(locator, `${label} text while focused`, 4.5, backgroundSelector);
}

async function assertHeaderTone(page, label, expected) {
  const selector = 'header[data-brand-header="recruiter-radar"]';
  await page.waitForFunction(([headerSelector, tone]) => document.querySelector(headerSelector)?.getAttribute("data-tone") === tone, [selector, expected]);
  const actual = await page.locator(selector).getAttribute("data-tone");
  results.headerTone.push({ label, expected, actual, scrollY: await page.evaluate(() => window.scrollY) });
  assert.equal(actual, expected, `${label}: expected ${expected}, received ${actual}`);
}

async function scrollSectionUnderHeader(page, selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (target) window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - 48);
  }, selector);
  await page.waitForTimeout(120);
}

async function auditHeader(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const { page, assertCleanConsole } = await preparePage(context, `header-${viewport.name}`);
  const header = page.locator('header[data-brand-header="recruiter-radar"]');
  const heroBackground = "#scene-detection";

  await page.evaluate(() => window.scrollTo(0, 0));
  await assertHeaderTone(page, `${viewport.name} Hero top`, "light");
  await page.waitForFunction(() => !document.querySelector('header[data-brand-header="recruiter-radar"]')?.hasAttribute("data-scrolled"));
  assert.equal(await header.getAttribute("data-scrolled"), null, `${viewport.name}: header must stay transparent at page top`);

  const brand = header.locator('[role="img"][aria-label="Recruiter Radar"]');
  await assertContrast(brand, `${viewport.name} Header BrandLogo`, 4.5, heroBackground);

  if (viewport.width >= 960) {
    const nav = header.getByRole("navigation", { name: "Разделы лендинга" }).getByRole("link", { name: "Пример", exact: true });
    const login = header.getByRole("link", { name: "Войти", exact: true });
    const cta = header.locator('[data-analytics-context="header"]');
    await assertContrast(nav, `${viewport.name} Header nav`, 4.5, heroBackground);
    await assertContrast(login, `${viewport.name} Header login`, 4.5, heroBackground);
    await assertContrast(cta, `${viewport.name} Header preview CTA`, 4.5, heroBackground);
    await assertFocus(page, cta, `${viewport.name} Header preview CTA focus`, heroBackground);
  } else {
    const menu = header.getByRole("button", { name: "Открыть меню" });
    const target = await menu.boundingBox();
    assert.ok(target && target.width >= 44 && target.height >= 44, `${viewport.name}: menu target is below 44x44`);
    await assertContrast(menu, `${viewport.name} Header menu glyph`, 3, heroBackground);
    await assertFocus(page, menu, `${viewport.name} Header menu focus`, heroBackground);
  }

  await scrollSectionUnderHeader(page, "#scene-workspace");
  await page.waitForFunction(() => document.querySelector('header[data-brand-header="recruiter-radar"]')?.hasAttribute("data-scrolled"));
  await assertContrast(brand, `${viewport.name} Scrolled header BrandLogo`);
  if (viewport.width >= 960) {
    await assertContrast(header.locator('[data-analytics-context="header"]'), `${viewport.name} Scrolled header preview CTA`);
  } else {
    await assertContrast(header.getByRole("button", { name: "Открыть меню" }), `${viewport.name} Scrolled header menu glyph`, 3);
  }

  await scrollSectionUnderHeader(page, "#scene-evidence");
  await assertHeaderTone(page, `${viewport.name} dark Proof`, "dark");
  await scrollSectionUnderHeader(page, "#scene-delivery");
  await assertHeaderTone(page, `${viewport.name} light Delivery`, "light");
  await scrollSectionUnderHeader(page, "#pricing");
  await assertHeaderTone(page, `${viewport.name} light Pricing`, "light");
  await page.evaluate(() => window.scrollTo(0, 0));
  await assertHeaderTone(page, `${viewport.name} Hero restored`, "light");

  assertCleanConsole();
  await context.close();
}

async function auditHeaderHashes(browser) {
  const specs = [
    { hash: "scene-evidence", tone: "dark" },
    { hash: "pricing", tone: "light" },
    { hash: "faq", tone: "light" },
  ];
  for (const spec of specs) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const { page, assertCleanConsole } = await preparePage(context, `header-hash-${spec.hash}`, `${baseUrl}/#${spec.hash}`);
    await assertHeaderTone(page, `hash #${spec.hash}`, spec.tone);
    assertCleanConsole();
    await context.close();
  }
}

async function auditContrast(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, assertCleanConsole } = await preparePage(context, "contrast-1440x900");

  await assertContrast(page.locator("#scene-detection [data-hero-copy] > div:first-child > p"), "Hero service label");
  await assertContrast(page.locator("#scene-detection [data-hero-trust-line]"), "Hero trust line");
  await assertContrast(page.locator('#scene-detection [data-hero-stage="signal"] > span:first-child'), "Hero Signal stage label");
  await assertContrast(page.locator('#scene-detection [data-hero-stage="signal"] > small'), "Hero signal metadata");
  await assertContrast(page.locator('#scene-detection [data-hero-stage="signal"] > div > span:first-child'), "Hero Why now label");

  const heroCta = page.locator('#scene-detection [data-analytics-context="hero_primary"]');
  await assertContrast(heroCta, "Hero primary CTA");
  await heroCta.hover();
  await assertContrast(heroCta, "Hero primary CTA hover");
  await page.mouse.move(0, 0);
  await assertFocus(page, heroCta, "Hero primary CTA focus");

  const decision = page.locator('#scene-detection [data-hero-stage="decision"]');
  await assertContrast(decision.locator(":scope > span:first-child"), "Hero decision label");
  await assertContrast(decision.getByText("Уверенность", { exact: true }), "Hero decision confidence label");
  await assertContrast(decision.locator("strong").first(), "Hero decision confidence value");
  await assertContrast(decision.locator("small"), "Hero decision score metadata");
  await assertContrast(decision.getByText("Следующий ход", { exact: true }), "Hero decision next-move label");
  await assertContrast(decision.locator(":scope > div:last-child > strong"), "Hero decision next move");

  const pricing = page.locator("#pricing [data-pricing-primary]");
  await assertContrast(pricing.locator(":scope > div:first-child > div:first-child > span"), "Pilot eyebrow");
  const pilotCta = pricing.locator("a").first();
  await assertContrast(pilotCta, "Pilot primary CTA");
  await pilotCta.hover();
  await assertContrast(pilotCta, "Pilot primary CTA hover");
  await page.mouse.move(0, 0);
  await assertFocus(page, pilotCta, "Pilot primary CTA focus");

  const final = page.locator("#conversion-final");
  await assertContrast(final.locator(":scope > div:first-child > span"), "Final CTA eyebrow");
  for (const [index, item] of (await final.locator("ul li").all()).entries()) {
    await assertContrast(item, `Final CTA trust item ${index + 1}`);
  }
  const finalCta = final.locator('[data-analytics-context="closing"]');
  await assertContrast(finalCta, "Final primary CTA");
  await finalCta.hover();
  await assertContrast(finalCta, "Final primary CTA hover");
  await page.mouse.move(0, 0);
  await assertFocus(page, finalCta, "Final primary CTA focus");
  await assertContrast(final.getByRole("link", { name: "Сначала посмотреть пример", exact: true }), "Final secondary link");

  assertCleanConsole();
  await context.close();
}

async function auditDelivery(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const { page, assertCleanConsole } = await preparePage(context, `delivery-${viewport.name}`);
  const details = page.locator("#scene-delivery details");
  const summary = details.locator("summary");
  const extraRoutes = details.locator(":scope > div");

  const closedHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  assert.equal(await details.getAttribute("open"), null, `${viewport.name}: disclosure should start closed`);
  const target = await summary.boundingBox();
  assert.ok(target && target.width >= 44 && target.height >= 44, `${viewport.name}: disclosure target is below 44x44`);

  await summary.scrollIntoViewIfNeeded();
  await summary.focus();
  await page.keyboard.press("Enter");
  await extraRoutes.waitFor({ state: "visible" });
  assert.notEqual(await details.getAttribute("open"), null, `${viewport.name}: disclosure did not open from keyboard`);

  const geometry = await page.evaluate(() => {
    const detailsElement = document.querySelector("#scene-delivery details");
    const summaryElement = detailsElement?.querySelector("summary");
    const extra = detailsElement?.querySelector(":scope > div");
    const pricing = document.querySelector("#pricing");
    const header = document.querySelector('header[data-brand-header="recruiter-radar"]');
    if (!(detailsElement && summaryElement && extra && pricing)) return null;
    const extraRect = extra.getBoundingClientRect();
    const pricingRect = pricing.getBoundingClientRect();
    const summaryRect = summaryElement.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect() ?? null;
    return {
      extra: extraRect.toJSON(),
      pricing: pricingRect.toJSON(),
      summary: summaryRect.toJSON(),
      header: headerRect?.toJSON() ?? null,
      intersectsPricing: !(
        extraRect.right <= pricingRect.left + 1
        || extraRect.left >= pricingRect.right - 1
        || extraRect.bottom <= pricingRect.top + 1
        || extraRect.top >= pricingRect.bottom - 1
      ),
      viewportWidth: document.documentElement.clientWidth,
      activeIsSummary: document.activeElement === summaryElement,
      open: detailsElement.hasAttribute("open"),
      position: getComputedStyle(extra).position,
    };
  });

  assert.ok(geometry, `${viewport.name}: missing Delivery geometry`);
  assert.equal(geometry.open, true, `${viewport.name}: disclosure open state missing`);
  assert.equal(geometry.position, "static", `${viewport.name}: extra routes must participate in normal flow`);
  assert.equal(geometry.intersectsPricing, false, `${viewport.name}: extra routes overlap Pricing`);
  assert.ok(geometry.extra.left >= -1, `${viewport.name}: extra routes escape left viewport edge`);
  assert.ok(geometry.extra.right <= geometry.viewportWidth + 1, `${viewport.name}: extra routes escape right viewport edge`);
  assert.equal(geometry.activeIsSummary, true, `${viewport.name}: keyboard focus left the summary unexpectedly`);
  if (geometry.header) {
    assert.ok(geometry.summary.top >= geometry.header.bottom - 1, `${viewport.name}: focused summary is hidden under sticky header`);
    assert.ok(geometry.extra.top >= geometry.header.bottom - 1, `${viewport.name}: expanded routes are hidden under sticky header`);
  }

  const openHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(openHeight > closedHeight, `${viewport.name}: open disclosure must add document height`);
  await page.keyboard.press("Enter");
  await extraRoutes.waitFor({ state: "hidden" });
  assert.equal(await details.getAttribute("open"), null, `${viewport.name}: disclosure did not close from keyboard`);
  const restoredHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(Math.abs(restoredHeight - closedHeight) <= 2, `${viewport.name}: closed document height did not restore`);

  results.delivery.push({ viewport: viewport.name, closedHeight, openHeight, addedHeight: openHeight - closedHeight, geometry });
  assertCleanConsole();
  await context.close();
}

await mkdir(reportDirectory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

try {
  await auditContrast(browser);
  await auditHeader(browser, { width: 1440, height: 900, name: "1440x900" });
  await auditHeader(browser, { width: 390, height: 844, name: "390x844" });
  await auditHeaderHashes(browser);
  for (const viewport of deliveryMatrix) await auditDelivery(browser, viewport);
} finally {
  await browser.close();
}

await writeFile(reportPath, JSON.stringify(results, null, 2));
process.stdout.write(`${JSON.stringify({ ok: true, reportPath, results })}\n`);
