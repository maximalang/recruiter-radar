#!/usr/bin/env node
/**
 * Legal-page screenshot gate: captures /legal /terms /privacy
 * /personal-data-consent /payment-and-refund /cookies /acceptable-use
 * /data-policy at desktop-1440x900 and mobile-390x844.
 *
 * Usage: node scripts/capture-legal-screenshots.mjs [outputDir]
 * (LANDING_BASE_URL, default http://127.0.0.1:3000)
 */

import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = (process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const outputDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "recruiter-radar-legal-shots"));

const ROUTES = [
  "/legal",
  "/terms",
  "/privacy",
  "/personal-data-consent",
  "/payment-and-refund",
  "/cookies",
  "/acceptable-use",
  "/data-policy",
];

const VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const page = await context.newPage();

for (const viewport of VIEWPORTS) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  for (const route of ROUTES) {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) {
      console.error(`SKIP ${route} @${viewport.name}: HTTP ${response?.status()}`);
      continue;
    }
    await page.waitForTimeout(400);
    // dismiss the consent banner so it does not cover the footer in shots
    const banner = page.locator('[data-analytics-consent="true"]');
    if (await banner.isVisible().catch(() => false)) {
      const reject = banner.getByRole("button", { name: "Отклонить необязательные" });
      if (await reject.count()) await reject.click().catch(() => {});
    }
    const file = path.join(outputDir, `legal-${route.replace(/\//g, "")}-${viewport.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`saved ${file}`);
  }
}

await browser.close();
console.log(`done → ${outputDir}`);
