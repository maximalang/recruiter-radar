// Stage 1/2 visual evidence capture (t_ee208805). Not committed.
import { chromium } from "playwright";
import path from "node:path";

const baseUrl = "http://127.0.0.1:3457";
const outDir = "C:/tmp/rr-ee208805/apps/web/artifacts";

async function shot(viewport, name, { full = false, consent = false } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  if (!consent) {
    const allow = page.getByRole("button", { name: "Разрешить", exact: true });
    if (await allow.count()) { await allow.click(); await page.waitForTimeout(400); }
  }
  if (full) {
    await page.screenshot({ path: path.join(outDir, name), fullPage: true, animations: "disabled" });
  } else {
    await page.screenshot({ path: path.join(outDir, name), animations: "disabled" });
  }
  const metrics = await page.evaluate(() => {
    const dots = [...document.querySelectorAll("[data-shot-dot]")].map((d) => {
      const r = d.getBoundingClientRect();
      const cs = getComputedStyle(d);
      return { color: d.dataset.shotDot, w: +r.width.toFixed(1), h: +r.height.toFixed(1), visible: r.width > 0 && cs.display !== "none" && cs.visibility !== "hidden", bg: cs.backgroundColor };
    });
    const dialog = document.querySelector("[data-analytics-consent]");
    let banner = null;
    if (dialog) {
      const r = dialog.getBoundingClientRect();
      const h1 = document.querySelector("h1");
      const h1r = h1 ? h1.getBoundingClientRect() : null;
      const overlaps = h1r ? !(r.top > h1r.bottom || r.bottom < h1r.top || r.left > h1r.right || r.right < h1r.left) : false;
      banner = { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), overlapsH1: overlaps };
    }
    return { dots, banner, viewport: { w: innerWidth, h: innerHeight } };
  });
  await browser.close();
  return metrics;
}

const m1440 = await shot({ width: 1440, height: 900 }, "stage1-consent-1440x900.png", { consent: true });
console.log("1440 consent:", JSON.stringify(m1440, null, 1));
const m390 = await shot({ width: 390, height: 844 }, "stage1-consent-390x844.png", { consent: true });
console.log("390 consent:", JSON.stringify(m390, null, 1));
const f1440 = await shot({ width: 1440, height: 900 }, "stage1-full-1440x900.png", { full: true });
console.log("1440 full dots:", JSON.stringify(f1440.dots));
const f390 = await shot({ width: 390, height: 844 }, "stage1-full-390x844.png", { full: true });
console.log("390 full dots:", JSON.stringify(f390.dots));
console.log("DONE");
