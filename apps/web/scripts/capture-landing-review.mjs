import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const auditScreenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-landing", "screenshots");
const reviewDirectory = process.env.LANDING_REVIEW_SCREENSHOT_DIR
  ?? path.join(path.dirname(auditScreenshotDirectory), "review");
/* Provenance: which exact tree produced these captures. CI sets this to the
 * PR head SHA; ad-hoc local runs stay null and are reported as "unknown". */
const sourceCommit = process.env.LANDING_SOURCE_COMMIT || null;

const viewports = [
  { width: 1440, height: 900, name: "1440x900", focused: true, deliveryOpen: true },
  { width: 390, height: 844, name: "390x844", focused: true, deliveryOpen: false },
  { width: 320, height: 568, name: "320x568", focused: false, deliveryOpen: false },
  { width: 430, height: 932, name: "430x932", focused: false, deliveryOpen: false },
  { width: 768, height: 1024, name: "768x1024", focused: false, deliveryOpen: false },
  { width: 1024, height: 768, name: "1024x768", focused: false, deliveryOpen: true },
  { width: 1920, height: 1080, name: "1920x1080", focused: false, deliveryOpen: false },
];

const focusedSurfaces = [
  { name: "hero", selector: "#scene-detection" },
  { name: "timeline", selector: "#scene-signal-timeline" },
  { name: "preview", selector: '#scene-workspace [data-product-preview="live-radar"]' },
  { name: "proof", selector: "#scene-evidence" },
  { name: "delivery", selector: "#scene-delivery" },
  { name: "pricing", selector: "#pricing" },
  { name: "final-cta", selector: "#conversion-final" },
];

async function movePointerToNeutral(page) {
  const viewport = page.viewportSize();
  if (!viewport) return;

  const point = await page.evaluate(({ width, height }) => {
    const interactiveSelector = "a,button,summary,input,select,textarea,[role='button'],[role='link']";
    for (let y = Math.max(1, height - 2); y >= 1; y -= 24) {
      for (let x = Math.max(1, width - 2); x >= 1; x -= 24) {
        const target = document.elementFromPoint(x, y);
        if (!target?.closest(interactiveSelector)) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }, viewport);

  await page.mouse.move(point.x, point.y);
  const hoveredInteractive = page.locator(
    "a:hover,button:hover,summary:hover,input:hover,select:hover,textarea:hover,[role='button']:hover,[role='link']:hover",
  );
  if (await hoveredInteractive.count() !== 0) {
    throw new Error(`Unable to place pointer at a neutral coordinate: ${JSON.stringify(point)}`);
  }
}

async function resetInteractionState(page) {
  const menuDialog = page.getByRole("dialog", { name: "Навигация по продукту" });
  if (await menuDialog.isVisible()) {
    await page.keyboard.press("Escape");
    await menuDialog.waitFor({ state: "hidden" });
  }

  await page.locator("#scene-delivery details").evaluateAll((details) => {
    for (const detail of details) detail.open = false;
  });
  await page.locator("#faq details").evaluateAll((details) => {
    details.forEach((detail, index) => {
      detail.open = index === 0;
    });
  });

  const mobileDisclosure = page.locator('[data-mobile-lead-disclosure="true"]');
  if (await mobileDisclosure.count() === 1 && await mobileDisclosure.getAttribute("aria-expanded") === "true") {
    await mobileDisclosure.click();
    await page.waitForFunction(() => (
      document.querySelector('[data-mobile-lead-disclosure="true"]')?.getAttribute("aria-expanded") === "false"
    ));
  }

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => (
    window.scrollY === 0
    && document.querySelector('header[data-brand-header="recruiter-radar"]')?.getAttribute("data-tone") === "dark"
  ));
  await movePointerToNeutral(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function preparePage(context, targetUrl = baseUrl) {
  const page = await context.newPage();
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.route("https://mc.yandex.ru/metrika/tag.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "/* deterministic analytics loader stub for review capture */",
  }));
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });
  await page.locator("#preview-results").waitFor({ state: "attached" });

  const consent = page.getByRole("button", { name: "Принять аналитику", exact: true });
  if (await consent.isVisible()) {
    await consent.click();
    await consent.waitFor({ state: "hidden" });
  } else {
    // Symmetric dismissal so the fixed banner cannot intercept hover/click
    // targets below when analytics is configured but acceptance is declined.
    const reject = page.getByRole("button", { name: "Отклонить необязательные", exact: true });
    if (await reject.isVisible()) {
      await reject.click();
      await reject.waitFor({ state: "hidden" });
    }
  }

  const pageHeight = await page.evaluate(() => Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
  ));
  const viewport = page.viewportSize();
  const step = Math.max(320, Math.floor((viewport?.height ?? 800) * 0.7));
  for (let y = 0; y < pageHeight; y += step) {
    await page.evaluate((nextY) => window.scrollTo(0, nextY), y);
    await page.waitForTimeout(35);
  }
  await resetInteractionState(page);
  return page;
}

async function documentHeight(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
}

async function readInteractionStyle(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      backgroundColor: style.backgroundColor,
      hovered: element.matches(":hover"),
      focused: element === document.activeElement,
    };
  });
}

async function captureHeroLoginInteraction(page, viewportName) {
  if (viewportName !== "320x568") return null;

  const login = page.locator("#scene-detection").getByRole("link", { name: "Войти", exact: true });
  await resetInteractionState(page);
  const neutralFile = `${viewportName}-hero-login-neutral.png`;
  const neutral = await readInteractionStyle(login);
  await page.screenshot({ path: path.join(reviewDirectory, neutralFile), animations: "disabled" });

  await login.hover();
  await page.waitForFunction(() => (
    document.querySelector('#scene-detection a[href^="/login?"]')?.matches(":hover") === true
  ));
  const hoverFile = `${viewportName}-hero-login-hover.png`;
  const hover = await readInteractionStyle(login);
  await page.screenshot({ path: path.join(reviewDirectory, hoverFile), animations: "disabled" });

  await resetInteractionState(page);
  return {
    neutral: { screenshot: neutralFile, ...neutral },
    hover: { screenshot: hoverFile, ...hover },
    hoverOnlyBorder: neutral.borderColor !== hover.borderColor && !neutral.hovered && hover.hovered,
  };
}

async function scrollSectionUnderHeader(page, selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (target) window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - 48);
  }, selector);
  await page.waitForTimeout(120);
}

async function captureHeaderEvidence(page, viewportName) {
  const artifacts = [];
  const topViewports = new Set(["1440x900", "1024x768", "390x844", "320x568"]);
  await resetInteractionState(page);
  if (topViewports.has(viewportName)) {
    const fileName = `${viewportName}-hero-header-top.png`;
    await page.screenshot({
      path: path.join(reviewDirectory, fileName),
      animations: "disabled",
    });
    artifacts.push(fileName);
  }

  if (viewportName === "1440x900") {
    await scrollSectionUnderHeader(page, "#scene-workspace");
    await movePointerToNeutral(page);
    await page.waitForFunction(() => document.querySelector('header[data-brand-header="recruiter-radar"]')?.hasAttribute("data-scrolled"));
    let fileName = `${viewportName}-header-preview.png`;
    await page.screenshot({ path: path.join(reviewDirectory, fileName), animations: "disabled" });
    artifacts.push(fileName);

    await scrollSectionUnderHeader(page, "#scene-evidence");
    await movePointerToNeutral(page);
    await page.waitForFunction(() => (
      document.querySelector('header[data-brand-header="recruiter-radar"]')?.getAttribute("data-tone") === "dark"
    ));
    fileName = `${viewportName}-header-proof-dark.png`;
    await page.screenshot({ path: path.join(reviewDirectory, fileName), animations: "disabled" });
    artifacts.push(fileName);

    await resetInteractionState(page);
  }

  if (viewportName === "390x844") {
    await resetInteractionState(page);
    let fileName = `${viewportName}-menu-trigger.png`;
    await page.screenshot({ path: path.join(reviewDirectory, fileName), animations: "disabled" });
    artifacts.push(fileName);

    const trigger = page.getByRole("button", { name: "Открыть меню" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Навигация по продукту" });
    await dialog.waitFor({ state: "visible" });
    fileName = `${viewportName}-menu-open.png`;
    await page.screenshot({ path: path.join(reviewDirectory, fileName), animations: "disabled" });
    artifacts.push(fileName);
    await resetInteractionState(page);
  }

  return artifacts;
}

async function captureContrastCrops(page, viewportName) {
  if (viewportName !== "1440x900") return [];

  const artifacts = [];
  await resetInteractionState(page);
  const decision = page.locator("#scene-detection [data-hero-copy]").first();
  await decision.screenshot({
    path: path.join(reviewDirectory, `${viewportName}-hero-copy.png`),
    animations: "disabled",
  });
  artifacts.push(`${viewportName}-hero-copy.png`);

  const states = [
    { name: "pilot-cta", locator: page.locator("#pricing [data-pricing-primary] > a").first() },
    { name: "final-cta-primary", locator: page.locator('#conversion-final [data-analytics-context="closing"]').first() },
  ];

  for (const state of states) {
    await resetInteractionState(page);
    await state.locator.scrollIntoViewIfNeeded();
    await movePointerToNeutral(page);
    await state.locator.screenshot({
      path: path.join(reviewDirectory, `${viewportName}-${state.name}-normal.png`),
      animations: "disabled",
    });
    artifacts.push(`${viewportName}-${state.name}-normal.png`);

    await state.locator.hover();
    await page.waitForFunction((selector) => document.querySelector(selector)?.matches(":hover") === true, (
      state.name === "pilot-cta"
        ? "#pricing [data-pricing-primary] > a"
        : '#conversion-final [data-analytics-context="closing"]'
    ));
    await state.locator.screenshot({
      path: path.join(reviewDirectory, `${viewportName}-${state.name}-hover.png`),
      animations: "disabled",
    });
    artifacts.push(`${viewportName}-${state.name}-hover.png`);
  }

  await resetInteractionState(page);
  return artifacts;
}

await rm(reviewDirectory, { recursive: true, force: true });
await mkdir(reviewDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

const manifest = {
  fullPage: {},
  deliveryOpen: {},
  contrastCrops: [],
  headerEvidence: [],
  heroLogin320: null,
  hero320: null,
};

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
    });
    const page = await preparePage(context);

    manifest.heroLogin320 = await captureHeroLoginInteraction(page, viewport.name) ?? manifest.heroLogin320;

    await resetInteractionState(page);
    const closedHeight = await documentHeight(page);
    manifest.fullPage[viewport.name] = { width: viewport.width, height: closedHeight, state: "default" };

    manifest.headerEvidence.push(...await captureHeaderEvidence(page, viewport.name));

    // Dedicated 320px Hero evidence: the full-page 320 capture exists, but
    // the human visual gate needs a focused Hero crop at 320 as well.
    if (viewport.name === "320x568") {
      await resetInteractionState(page);
      const hero = page.locator("#scene-detection").first();
      await hero.waitFor({ state: "visible" });
      await hero.scrollIntoViewIfNeeded();
      await movePointerToNeutral(page);
      await hero.screenshot({
        path: path.join(reviewDirectory, "320x568-hero.png"),
        animations: "disabled",
      });
      manifest.hero320 = "320x568-hero.png";
    }

    await resetInteractionState(page);
    await page.screenshot({
      path: path.join(reviewDirectory, `${viewport.name}-full-default.png`),
      fullPage: true,
      animations: "disabled",
    });

    if (viewport.focused) {
      for (const surface of focusedSurfaces) {
        await resetInteractionState(page);
        const locator = page.locator(surface.selector).first();
        await locator.waitFor({ state: "visible" });
        await locator.scrollIntoViewIfNeeded();
        await movePointerToNeutral(page);
        await locator.screenshot({
          path: path.join(reviewDirectory, `${viewport.name}-${surface.name}.png`),
          animations: "disabled",
        });
      }
    }

    manifest.contrastCrops.push(...await captureContrastCrops(page, viewport.name));

    if (viewport.deliveryOpen) {
      await resetInteractionState(page);
      const details = page.locator("#scene-delivery details").first();
      const summary = details.locator("summary");
      await summary.scrollIntoViewIfNeeded();
      await summary.click();
      await details.locator(":scope > div").waitFor({ state: "visible" });
      const openHeight = await documentHeight(page);
      manifest.deliveryOpen[viewport.name] = { width: viewport.width, height: openHeight, state: "delivery-open" };
      await page.screenshot({
        path: path.join(reviewDirectory, `${viewport.name}-delivery-open-full.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.locator("#scene-delivery").screenshot({
        path: path.join(reviewDirectory, `${viewport.name}-delivery-open.png`),
        animations: "disabled",
      });
    }

    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(reviewDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(
  path.join(reviewDirectory, "provenance.json"),
  JSON.stringify({
    sourceKind: "restored",
    sourceCommit: sourceCommit ?? "unknown",
    baseUrl,
    capturedAt: new Date().toISOString(),
  }, null, 2),
);

process.stdout.write(JSON.stringify({
  ok: true,
  reviewDirectory,
  provenance: { sourceKind: "restored", sourceCommit: sourceCommit ?? "unknown" },
  viewports: viewports.map(({ width, height }) => `${width}x${height}`),
  focusedSurfaces: focusedSurfaces.map(({ name }) => name),
  manifest,
}) + "\n");
