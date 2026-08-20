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

const results = {
  contrast: [],
  focus: [],
  delivery: [],
};

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

async function preparePage(context, label) {
  const page = await context.newPage();
  const assertCleanConsole = attachConsoleGate(page, label);
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.route("https://mc.yandex.ru/metrika/tag.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "/* deterministic analytics loader stub for focused accessibility audit */",
  }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });

  const consent = page.getByRole("button", { name: "Разрешить", exact: true });
  if (await consent.isVisible()) {
    await consent.click();
    await consent.waitFor({ state: "hidden" });
  }

  return { page, assertCleanConsole };
}

async function readContrast(locator) {
  return locator.evaluate((element) => {
    function parseChannel(value) {
      const token = value.trim();
      if (token.endsWith("%")) return Number.parseFloat(token) / 100;
      return Number.parseFloat(token) / 255;
    }

    function parseAlpha(value) {
      const token = value.trim();
      if (token.endsWith("%")) return Number.parseFloat(token) / 100;
      return Number.parseFloat(token);
    }

    function parseColor(value) {
      const color = value.trim().toLowerCase();
      if (color === "transparent") return [0, 0, 0, 0];

      if (color.startsWith("color(srgb")) {
        const body = color.slice("color(srgb".length, -1).trim();
        const [channelsPart, alphaPart] = body.split("/").map((part) => part.trim());
        const channels = channelsPart.split(/\s+/).map(Number);
        assertChannels(channels, value);
        return [channels[0], channels[1], channels[2], alphaPart ? parseAlpha(alphaPart) : 1];
      }

      if (color.startsWith("rgb(" ) || color.startsWith("rgba(")) {
        const body = color.slice(color.indexOf("(") + 1, -1).replaceAll(",", " ").trim();
        const [channelsPart, alphaPart] = body.split("/").map((part) => part.trim());
        const tokens = channelsPart.split(/\s+/).filter(Boolean);
        let alpha = alphaPart ? parseAlpha(alphaPart) : 1;
        if (tokens.length === 4) alpha = parseAlpha(tokens.pop());
        const channels = tokens.map(parseChannel);
        assertChannels(channels, value);
        return [channels[0], channels[1], channels[2], alpha];
      }

      throw new Error(`Unsupported computed color: ${value}`);
    }

    function assertChannels(channels, source) {
      if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
        throw new Error(`Invalid computed color: ${source}`);
      }
    }

    function composite(top, bottom) {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / alpha,
        (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / alpha,
        (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / alpha,
        alpha,
      ];
    }

    function effectiveBackground(target) {
      const layers = [];
      for (let node = target; node instanceof Element; node = node.parentElement) {
        layers.push(parseColor(getComputedStyle(node).backgroundColor));
      }
      let rendered = [0, 0, 0, 0];
      for (const layer of layers.reverse()) rendered = composite(layer, rendered);
      if (rendered[3] < 1) rendered = composite(rendered, [1, 1, 1, 1]);
      return rendered;
    }

    function linear(channel) {
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }

    function luminance(color) {
      return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
    }

    function ratio(foreground, background) {
      const high = Math.max(luminance(foreground), luminance(background));
      const low = Math.min(luminance(foreground), luminance(background));
      return (high + 0.05) / (low + 0.05);
    }

    function printable(color) {
      return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3].toFixed(3)})`;
    }

    const style = getComputedStyle(element);
    const background = effectiveBackground(element);
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
  });
}

async function assertContrast(locator, label, minimum = 4.5) {
  await locator.waitFor({ state: "visible" });
  const measurement = await readContrast(locator);
  results.contrast.push({ label, minimum, ...measurement });
  assert.ok(
    measurement.ratio >= minimum,
    `${label}: contrast ${measurement.ratio.toFixed(2)}:1 is below ${minimum}:1 (${measurement.foreground} on ${measurement.background})`,
  );
  return measurement;
}

async function assertFocus(page, locator, label) {
  await locator.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const focus = await locator.evaluate((element) => {
    function parseChannel(value) {
      const token = value.trim();
      if (token.endsWith("%")) return Number.parseFloat(token) / 100;
      return Number.parseFloat(token) / 255;
    }

    function parseAlpha(value) {
      const token = value.trim();
      if (token.endsWith("%")) return Number.parseFloat(token) / 100;
      return Number.parseFloat(token);
    }

    function parseColor(value) {
      const color = value.trim().toLowerCase();
      if (color === "transparent") return [0, 0, 0, 0];
      if (color.startsWith("color(srgb")) {
        const body = color.slice("color(srgb".length, -1).trim();
        const [channelsPart, alphaPart] = body.split("/").map((part) => part.trim());
        const channels = channelsPart.split(/\s+/).map(Number);
        return [channels[0], channels[1], channels[2], alphaPart ? parseAlpha(alphaPart) : 1];
      }
      if (color.startsWith("rgb(") || color.startsWith("rgba(")) {
        const body = color.slice(color.indexOf("(") + 1, -1).replaceAll(",", " ").trim();
        const [channelsPart, alphaPart] = body.split("/").map((part) => part.trim());
        const tokens = channelsPart.split(/\s+/).filter(Boolean);
        let alpha = alphaPart ? parseAlpha(alphaPart) : 1;
        if (tokens.length === 4) alpha = parseAlpha(tokens.pop());
        const channels = tokens.map(parseChannel);
        return [channels[0], channels[1], channels[2], alpha];
      }
      throw new Error(`Unsupported computed color: ${value}`);
    }

    function composite(top, bottom) {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / alpha,
        (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / alpha,
        (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / alpha,
        alpha,
      ];
    }

    function effectiveBackground(target) {
      const layers = [];
      for (let node = target; node instanceof Element; node = node.parentElement) {
        layers.push(parseColor(getComputedStyle(node).backgroundColor));
      }
      let rendered = [0, 0, 0, 0];
      for (const layer of layers.reverse()) rendered = composite(layer, rendered);
      if (rendered[3] < 1) rendered = composite(rendered, [1, 1, 1, 1]);
      return rendered;
    }

    function linear(channel) {
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }

    function luminance(color) {
      return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
    }

    function ratio(first, second) {
      const high = Math.max(luminance(first), luminance(second));
      const low = Math.min(luminance(first), luminance(second));
      return (high + 0.05) / (low + 0.05);
    }

    const style = getComputedStyle(element);
    const adjacent = effectiveBackground(element.parentElement ?? element);
    const computedOutline = parseColor(style.outlineColor);
    const renderedOutline = computedOutline[3] < 1 ? composite(computedOutline, adjacent) : computedOutline;

    return {
      active: document.activeElement === element,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineColor: style.outlineColor,
      adjacentBackground: getComputedStyle(element.parentElement ?? element).backgroundColor,
      outlineContrast: ratio(renderedOutline, adjacent),
    };
  });
  assert.equal(focus.active, true, `${label}: element did not receive focus`);
  assert.notEqual(focus.outlineStyle, "none", `${label}: focus outline is missing`);
  assert.ok(focus.outlineWidth >= 2, `${label}: focus outline is thinner than 2px`);
  assert.ok(focus.outlineOffset >= 2, `${label}: focus outline needs separation from the control`);
  assert.ok(focus.outlineContrast >= 3, `${label}: focus indicator contrast ${focus.outlineContrast.toFixed(2)}:1 is below 3:1`);
  results.focus.push({ label, ...focus });
  await assertContrast(locator, `${label} text while focused`, 4.5);
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
    const intersectsPricing = !(
      extraRect.right <= pricingRect.left + 1
      || extraRect.left >= pricingRect.right - 1
      || extraRect.bottom <= pricingRect.top + 1
      || extraRect.top >= pricingRect.bottom - 1
    );

    return {
      extra: extraRect.toJSON(),
      pricing: pricingRect.toJSON(),
      summary: summaryRect.toJSON(),
      header: headerRect?.toJSON() ?? null,
      intersectsPricing,
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

  results.delivery.push({
    viewport: viewport.name,
    closedHeight,
    openHeight,
    addedHeight: openHeight - closedHeight,
    geometry,
  });

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
  for (const viewport of deliveryMatrix) await auditDelivery(browser, viewport);
} finally {
  await browser.close();
}

await writeFile(reportPath, JSON.stringify(results, null, 2));
process.stdout.write(`${JSON.stringify({ ok: true, reportPath, results })}\n`);
