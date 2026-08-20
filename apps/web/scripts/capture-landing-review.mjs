import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const auditScreenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-landing", "screenshots");
const reviewDirectory = process.env.LANDING_REVIEW_SCREENSHOT_DIR
  ?? path.join(path.dirname(auditScreenshotDirectory), "review");

const viewports = [
  { width: 1440, height: 900, name: "1440x900", focused: true },
  { width: 390, height: 844, name: "390x844", focused: true },
  { width: 320, height: 568, name: "320x568", focused: false },
  { width: 768, height: 1024, name: "768x1024", focused: false },
  { width: 1024, height: 768, name: "1024x768", focused: false },
  { width: 1920, height: 1080, name: "1920x1080", focused: false },
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

await rm(reviewDirectory, { recursive: true, force: true });
await mkdir(reviewDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
    });
    const page = await preparePage(context);

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

    await context.close();
  }
} finally {
  await browser.close();
}

process.stdout.write(JSON.stringify({
  ok: true,
  reviewDirectory,
  viewports: viewports.map(({ width, height }) => `${width}x${height}`),
  focusedSurfaces: focusedSurfaces.map(({ name }) => name),
}) + "\n");
