import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

/* Historical pre-218 landing evidence. Captures ONLY the historical app
 * (served at LANDING_BASELINE_URL) into LANDING_REVIEW_SCREENSHOT_DIR —
 * never the restored build, so review-pre218 can only contain genuine
 * historical evidence. Fails when a representative capture comes out
 * byte-identical to its restored counterpart: identical bytes mean the
 * pipeline silently captured the wrong server (PR #227 closure gate).
 *
 * Required environment:
 *   LANDING_BASELINE_URL          historical server, e.g. http://127.0.0.1:3210
 *   LANDING_REVIEW_SCREENSHOT_DIR output, e.g. /tmp/recruiter-radar-landing/review-pre218
 *   LANDING_BASELINE_COMMIT       historical tree SHA (provenance manifest)
 *   LANDING_REVIEW_DIR            restored evidence dir for the integrity guard
 * Optional:
 *   LANDING_SCREENSHOT_DIR        audit dir; only derives the default review path
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
 */

const HISTORICAL_SOURCE_KIND = "historical-pre218";

const baselineUrl = process.env.LANDING_BASELINE_URL ?? "";
const baselineCommit = process.env.LANDING_BASELINE_COMMIT ?? "";
const auditScreenshotDirectory = process.env.LANDING_SCREENSHOT_DIR
  ?? path.join(os.tmpdir(), "recruiter-radar-landing", "screenshots-pre218");
const reviewDirectory = process.env.LANDING_REVIEW_SCREENSHOT_DIR
  ?? path.join(path.dirname(auditScreenshotDirectory), "review-pre218");
const restoredDirectory = process.env.LANDING_REVIEW_DIR ?? "";

function fail(message) {
  process.stderr.write(`pre218 capture: ${message}\n`);
  process.exit(1);
}

/* Exit code 2 = invalid comparison evidence (historical == restored bytes).
 * The CI step treats 2 as a hard failure; other non-zero codes stay
 * best-effort warnings. */
function failInvalidEvidence(message) {
  process.stderr.write(`pre218 capture: ${message}\n`);
  process.exit(2);
}

if (!baselineUrl) fail("LANDING_BASELINE_URL is required");
if (!baselineCommit) fail("LANDING_BASELINE_COMMIT is required");

const viewports = [
  { width: 1440, height: 900, name: "1440x900", focused: true },
  { width: 390, height: 844, name: "390x844", focused: true },
];

const focusedSurfaces = [
  { name: "hero", selector: "#scene-detection" },
  { name: "timeline", selector: "#scene-signal-timeline" },
  { name: "preview", selector: '#scene-workspace [data-product-preview="live-radar"]' },
  { name: "proof", selector: "#scene-evidence" },
  { name: "delivery", selector: "#scene-delivery" },
];

async function movePointerToNeutral(page) {
  const viewport = page.viewportSize();
  if (!viewport) return;
  const point = await page.evaluate(({ width, height }) => {
    const interactiveSelector = "a,button,summary,input,select,textarea,[role='button'],[role='link']";
    for (let y = Math.max(1, height - 2); y >= 1; y -= 24) {
      for (let x = 1; x <= width - 2; x += 24) {
        const target = document.elementFromPoint(x, y);
        if (!target?.closest(interactiveSelector)) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }, viewport);
  await page.mouse.move(point.x, point.y);
}

await rm(reviewDirectory, { recursive: true, force: true });
await mkdir(reviewDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});

const manifest = {
  surfaces: [],
};

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.route("**/api/landing-events", (route) => route.fulfill({ status: 204 }));
    await page.route("https://mc.yandex.ru/metrika/tag.js", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "/* deterministic analytics loader stub for pre-218 capture */",
    }));
    await page.goto(baselineUrl, { waitUntil: "networkidle" });
    await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
    await page.locator("#scene-detection").waitFor({ state: "visible" });
    await page.locator("#preview-results").waitFor({ state: "attached" });
    await page.waitForTimeout(400);

    const pageHeight = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    ));
    const step = Math.max(320, Math.floor((page.viewportSize()?.height ?? 800) * 0.7));
    for (let y = 0; y < pageHeight; y += step) {
      await page.evaluate((nextY) => window.scrollTo(0, nextY), y);
      await page.waitForTimeout(35);
    }

    // Mobile menu evidence mirrors the restored capture flow where present.
    const menuTrigger = page.getByRole("button", { name: "Открыть меню" });
    const hasMenuTrigger = viewport.width < 768 && await menuTrigger.count() === 1;
    if (hasMenuTrigger) {
      await page.screenshot({ path: path.join(reviewDirectory, `${viewport.name}-menu-trigger.png`), animations: "disabled" });
      await menuTrigger.click();
      const dialog = page.getByRole("dialog", { name: "Навигация по продукту" });
      await dialog.waitFor({ state: "visible" });
      await page.screenshot({ path: path.join(reviewDirectory, `${viewport.name}-menu-open.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);

    await page.screenshot({
      path: path.join(reviewDirectory, `${viewport.name}-full-default.png`),
      fullPage: true,
      animations: "disabled",
    });

    if (viewport.focused) {
      for (const surface of focusedSurfaces) {
        const locator = page.locator(surface.selector).first();
        try {
          await locator.waitFor({ state: "visible", timeout: 8000 });
        } catch {
          continue; // Surface predates this revision; skip rather than fail.
        }
        await locator.scrollIntoViewIfNeeded();
        await movePointerToNeutral(page);
        await locator.screenshot({
          path: path.join(reviewDirectory, `${viewport.name}-${surface.name}.png`),
          animations: "disabled",
        });
        manifest.surfaces.push({ viewport: viewport.name, surface: surface.name, file: `${viewport.name}-${surface.name}.png` });
      }
    }

    await context.close();
  }
} finally {
  await browser.close();
}

// Integrity guard: representative comparison surfaces must NOT be byte-
// identical to the restored captures — identical bytes mean the pipeline
// captured the wrong server and any comparison evidence would be invalid.
const comparisonSurfaces = ["hero", "preview"];
for (const entry of manifest.surfaces) {
  if (!comparisonSurfaces.includes(entry.surface)) continue;
  let historicalHash;
  let restoredHash;
  try {
    const [historicalBuffer, restoredBuffer] = await Promise.all([
      readFile(path.join(reviewDirectory, entry.file)),
      readFile(path.join(restoredDirectory, entry.file)),
    ]);
    historicalHash = createHash("sha256").update(historicalBuffer).digest("hex");
    restoredHash = createHash("sha256").update(restoredBuffer).digest("hex");
  } catch (error) {
    fail(`integrity guard could not read ${entry.file} (${error.message})`);
  }
  entry.sha256 = historicalHash;
  entry.restoredCounterpartSha256 = restoredHash;
  entry.identicalToRestored = historicalHash === restoredHash;
  if (entry.identicalToRestored) {
    failInvalidEvidence(`INVALID COMPARISON EVIDENCE: ${entry.file} is byte-identical to the restored capture — the historical pipeline captured the wrong server`);
  }
}

// Every captured file must be a real PNG before it can count as evidence.
for (const entry of manifest.surfaces) {
  const buffer = await readFile(path.join(reviewDirectory, entry.file)).catch(() => null);
  if (!buffer || buffer.length < 8 || buffer.subarray(1, 4).toString("latin1") !== "PNG") {
    fail(`captured file ${entry.file} is not a valid PNG`);
  }
}

await writeFile(path.join(reviewDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(
  path.join(reviewDirectory, "provenance.json"),
  JSON.stringify({
    sourceKind: HISTORICAL_SOURCE_KIND,
    sourceCommit: baselineCommit,
    baseUrl: baselineUrl,
    capturedAt: new Date().toISOString(),
    integrityGuard: {
      comparedFiles: manifest.surfaces
        .filter((entry) => entry.identicalToRestored !== undefined)
        .map((entry) => ({
          file: entry.file,
          sha256: entry.sha256,
          restoredSha256: entry.restoredCounterpartSha256,
          identical: entry.identicalToRestored,
        })),
      policy: "fail when historical and restored captures are byte-identical",
    },
  }, null, 2),
);

process.stdout.write(JSON.stringify({
  ok: true,
  reviewDirectory,
  provenance: { sourceKind: HISTORICAL_SOURCE_KIND, sourceCommit: baselineCommit },
  integrityGuardPassed: true,
  surfaces: manifest.surfaces,
}) + "\n");
