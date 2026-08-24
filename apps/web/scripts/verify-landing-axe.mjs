import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { chromium } from "playwright";

const require = createRequire(import.meta.url);

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";
const screenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-landing", "screenshots");
const reportDirectory = path.dirname(screenshotDirectory);
const reportPath = path.join(reportDirectory, "accessibility-axe.json");

// WCAG 2.1 AA subset: serious/critical violations only. Known cosmetic-only
// rules stay disabled here; everything else must be clean on every viewport.
const DISABLED_RULES = ["region", "landmark-one-main"];

const axeSource = await readFile(
  require.resolve("axe-core/axe.min.js"),
  "utf8",
);
assert.ok(axeSource.length > 100_000, "axe-core source looks truncated");

const viewports = [
  { width: 320, height: 568, name: "320x568" },
  { width: 390, height: 844, name: "390x844" },
  { width: 768, height: 1024, name: "768x1024" },
  { width: 1280, height: 800, name: "1280x800" },
  { width: 1920, height: 1080, name: "1920x1080" },
];

const results = { baseUrl, viewports: [] };
let totalViolations = 0;

async function preparePage(context, label) {
  const page = await context.newPage();
  const consoleMessages = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => consoleMessages.push({ type: "pageerror", text: error.message }));
  await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
  await page.route("https://mc.yandex.ru/metrika/tag.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "/* deterministic analytics loader stub for focused axe audit */",
  }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });

  const consent = page.getByRole("button", { name: "Разрешить", exact: true });
  if (await consent.isVisible()) {
    await consent.click();
    await consent.waitFor({ state: "hidden" });
  }
  return { page, consoleMessages, label };
}

await mkdir(reportDirectory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const { page, consoleMessages, label } = await preparePage(context, `axe-${viewport.name}`);

    // Full-page audit at the top of the landing.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addScriptTag({ content: axeSource });
    const fullScan = await page.evaluate(async (disabledRules) => {
      const axe = window.axe;
      axe.reset();
      return axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        resultTypes: ["violations"],
        rules: Object.fromEntries(disabledRules.map((rule) => [rule, { enabled: false }])),
      });
    }, DISABLED_RULES);

    // Expanded Delivery disclosure changes the DOM — re-scan after opening it
    // so keyboard-reachable extra routes are audited too.
    const details = page.locator("#scene-delivery details");
    if (await details.count() > 0) {
      await details.locator("summary").scrollIntoViewIfNeeded().catch(() => {});
      await page.evaluate(() => {
        const summary = document.querySelector("#scene-delivery details")?.querySelector("summary");
        if (summary) summary.click();
      });
      await page.waitForTimeout(200);
      const openScan = await page.evaluate(async (disabledRules) => {
        const axe = window.axe;
        return axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
          resultTypes: ["violations"],
          rules: Object.fromEntries(disabledRules.map((rule) => [rule, { enabled: false }])),
        });
      }, DISABLED_RULES);
      mergeViolations(fullScan.violations, openScan.violations);
    }

    const violations = dedupeViolations(fullScan.violations);
    totalViolations += violations.length;
    results.viewports.push({ viewport: viewport.name, violations });
    assert.equal(
      violations.length,
      0,
      `${label}: ${violations.length} axe violation(s): ${formatViolations(violations)}`,
    );
    assert.deepEqual(consoleMessages, [], `${label}: console warnings/errors: ${JSON.stringify(consoleMessages)}`);
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(reportPath, JSON.stringify({ ...results, ok: totalViolations === 0 }, null, 2));
process.stdout.write(`${JSON.stringify({ ok: totalViolations === 0, reportPath })}\n`);

function mergeViolations(target, additions) {
  for (const violation of additions) target.push(violation);
}

function dedupeViolations(violations) {
  const byId = new Map();
  for (const violation of violations) {
    const existing = byId.get(violation.id);
    if (!existing) {
      byId.set(violation.id, violation);
      continue;
    }
    const seenNodes = new Set(existing.nodes.map((node) => node.target.join("|")));
    for (const node of violation.nodes) {
      const key = node.target.join("|");
      if (!seenNodes.has(key)) {
        existing.nodes.push(node);
        seenNodes.add(key);
      }
    }
  }
  return [...byId.values()];
}

function formatViolations(violations) {
  return violations.map((violation) => {
    const nodes = violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join("; ");
    return `${violation.id} (${violation.impact}): ${nodes}${violation.nodes.length > 3 ? "; …" : ""}`;
  }).join(" | ");
}
