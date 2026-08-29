import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

// Landing performance budget gate. Measures field-style CWV (LCP, CLS) via
// buffered PerformanceObserver entries and transferred bytes by resource type
// (Resource Timing), then asserts against budgets. Tune via env; the gate
// fails when any budget is exceeded.
const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const screenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-landing", "screenshots");
const reportDirectory = path.dirname(screenshotDirectory);
const reportPath = path.join(reportDirectory, "perf-budget.json");

const budgets = {
  lcpMs: Number.parseInt(process.env.PERF_BUDGET_LCP_MS ?? "2500", 10),
  cls: Number.parseFloat(process.env.PERF_BUDGET_CLS ?? "0.1"),
  totalKb: Number.parseInt(process.env.PERF_BUDGET_TOTAL_KB ?? "900", 10),
  scriptKb: Number.parseInt(process.env.PERF_BUDGET_SCRIPT_KB ?? "350", 10),
  fontKb: Number.parseInt(process.env.PERF_BUDGET_FONT_KB ?? "200", 10),
  imageKb: Number.parseInt(process.env.PERF_BUDGET_IMAGE_KB ?? "250", 10),
};

const results = { baseUrl, budgets, measurements: {} };

await mkdir(reportDirectory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.route("https://mc.yandex.ru/metrika/tag.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "/* deterministic analytics loader stub for focused perf audit */",
  }));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });

  // Scroll through the landing so lazy content/images load before measuring.
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);

  const metrics = await page.evaluate(() => new Promise((resolve) => {
    const lcpEntries = [];
    const lcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "largest-contentful-paint") lcpEntries.push(entry);
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });

    const shifts = [];
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) shifts.push(entry.value);
      }
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });

    setTimeout(() => {
      lcpObserver.disconnect();
      clsObserver.disconnect();
      resolve({
        lcpMs: lcpEntries.length ? Math.round(Math.max(...lcpEntries.map((e) => e.startTime))) : null,
        cls: Number.parseFloat(shifts.reduce((sum, value) => sum + value, 0).toFixed(4)),
        ttfbMsRaw: performance.getEntriesByType("navigation")[0]?.responseStart ?? null,
        resources: performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          transferSize: entry.transferSize,
        })),
      });
    }, 500);
  }));

  const byType = {};
  for (const resource of metrics.resources) {
    const type = classifyResource(resource.name, resource.initiatorType);
    byType[type] = (byType[type] ?? 0) + Math.max(0, resource.transferSize ?? 0);
  }
  const totalBytes = Object.values(byType).reduce((sum, value) => sum + value, 0);

  results.measurements = {
    lcpMs: metrics.lcpMs,
    cls: metrics.cls,
    ttfbMs: metrics.ttfbMsRaw === null ? null : Math.round(metrics.ttfbMsRaw),
    transferredBytesByType: byType,
    totalTransferredKb: Math.round(totalBytes / 1024),
  };

  assert.ok(metrics.lcpMs !== null, "LCP entry missing — page did not paint?");
  assert.ok(
    metrics.lcpMs <= budgets.lcpMs,
    `LCP ${metrics.lcpMs}ms exceeds budget ${budgets.lcpMs}ms`,
  );
  assert.ok(
    metrics.cls <= budgets.cls,
    `CLS ${metrics.cls} exceeds budget ${budgets.cls}`,
  );
  assert.ok(
    totalBytes <= budgets.totalKb * 1024,
    `Total transfer ${(totalBytes / 1024).toFixed(0)}KB exceeds budget ${budgets.totalKb}KB`,
  );
  for (const [type, key] of [["script", "scriptKb"], ["font", "fontKb"], ["image", "imageKb"]]) {
    const actual = byType[type] ?? 0;
    assert.ok(
      actual <= budgets[key] * 1024,
      `${type} transfer ${(actual / 1024).toFixed(0)}KB exceeds budget ${budgets[key]}KB`,
    );
  }

  await context.close();
} finally {
  await browser.close();
}

await writeFile(reportPath, JSON.stringify(results, null, 2));
process.stdout.write(`${JSON.stringify({ ok: true, reportPath })}\n`);

function classifyResource(url, initiatorType) {
  if (/\.woff2?($|\?)/i.test(url)) return "font";
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico)($|\?)/i.test(url)) return "image";
  if (initiatorType === "script" || /\.m?js($|\?)/i.test(url)) return "script";
  if (initiatorType === "css" || initiatorType === "link" || /\.css($|\?)/i.test(url)) return "css";
  if (/^data:/i.test(url)) return "inline";
  return "other";
}
