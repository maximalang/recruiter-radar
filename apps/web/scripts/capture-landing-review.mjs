import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const auditScreenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-landing", "screenshots");
const reviewDirectory = process.env.LANDING_REVIEW_SCREENSHOT_DIR
  ?? path.join(path.dirname(auditScreenshotDirectory), "review");

const viewports = [
  { width: 1440, height: 900, name: "1440x900", focused: true, deliveryOpen: true },
  { width: 390, height: 844, name: "390x844", focused: true, deliveryOpen: false },
  { width: 320, height: 568, name: "320x568", focused: false, deliveryOpen: false },
  { width: 768, height: 1024, name: "768x1024", focused: false, deliveryOpen: false },
  { width: 1024, height: 768, name: "1024x768", focused: false, deliveryOpen: true },
  { width: 1920, height: 1080, name: "1920x1080", focused: false, deliveryOpen: false },
];

const focusedSurfaces = [
  { name: "hero", selector: "#scene-detection" },
  { name: "preview", selector: '#scene-workspace [data-product-preview="live-radar"]' },
  { name: "proof", selector: "#scene-evidence" },
  { name: "delivery", selector: "#scene-delivery" },
  { name: "pricing", selector: "#pricing" },
  { name: "final-cta", selector: "#conversion-final" },
];

async function preparePage(context) {
  const page = await context.newPage();
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.route("https://mc.yandex.ru/metrika/tag.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "/* deterministic analytics loader stub for review capture */",
  }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });
  await page.locator("#preview-results").waitFor({ state: "attached" });

  const consent = page.getByRole("button", { name: "Разрешить", exact: true });
  if (await consent.isVisible()) {
    await consent.click();
    await consent.waitFor({ state: "hidden" });
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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(80);
  return page;
}

async function documentHeight(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
}

async function captureContrastCrops(page, viewportName) {
  if (viewportName !== "1440x900") return [];

  const artifacts = [];
  const decision = page.locator('[data-hero-stage="decision"]').first();
  await decision.screenshot({
    path: path.join(reviewDirectory, `${viewportName}-hero-decision.png`),
    animations: "disabled",
  });
  artifacts.push(`${viewportName}-hero-decision.png`);

  const states = [
    { name: "pilot-cta", locator: page.locator("#pricing [data-pricing-primary] > a").first() },
    { name: "final-cta-primary", locator: page.locator('#conversion-final [data-analytics-context="closing"]').first() },
  ];

  for (const state of states) {
    await page.mouse.move(0, 0);
    await state.locator.screenshot({
      path: path.join(reviewDirectory, `${viewportName}-${state.name}-normal.png`),
      animations: "disabled",
    });
    artifacts.push(`${viewportName}-${state.name}-normal.png`);

    await state.locator.hover();
    await page.waitForTimeout(40);
    await state.locator.screenshot({
      path: path.join(reviewDirectory, `${viewportName}-${state.name}-hover.png`),
      animations: "disabled",
    });
    artifacts.push(`${viewportName}-${state.name}-hover.png`);
  }

  await page.mouse.move(0, 0);
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
};

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
    });
    const page = await preparePage(context);
    const closedHeight = await documentHeight(page);
    manifest.fullPage[viewport.name] = { width: viewport.width, height: closedHeight };

    await page.screenshot({
      path: path.join(reviewDirectory, `${viewport.name}-full.png`),
      fullPage: true,
      animations: "disabled",
    });

    if (viewport.focused) {
      for (const surface of focusedSurfaces) {
        const locator = page.locator(surface.selector).first();
        await locator.waitFor({ state: "visible" });
        await locator.screenshot({
          path: path.join(reviewDirectory, `${viewport.name}-${surface.name}.png`),
          animations: "disabled",
        });
      }
    }

    manifest.contrastCrops.push(...await captureContrastCrops(page, viewport.name));

    if (viewport.deliveryOpen) {
      const details = page.locator("#scene-delivery details").first();
      const summary = details.locator("summary");
      await summary.scrollIntoViewIfNeeded();
      await summary.click();
      await details.locator(":scope > div").waitFor({ state: "visible" });
      const openHeight = await documentHeight(page);
      manifest.deliveryOpen[viewport.name] = { width: viewport.width, height: openHeight };
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

process.stdout.write(JSON.stringify({
  ok: true,
  reviewDirectory,
  viewports: viewports.map(({ width, height }) => `${width}x${height}`),
  focusedSurfaces: focusedSurfaces.map(({ name }) => name),
  manifest,
}) + "\n");
