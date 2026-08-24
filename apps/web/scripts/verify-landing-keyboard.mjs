import assert from "node:assert/strict";

import { chromium } from "playwright";

const baseUrl = process.env.LANDING_BASE_URL ?? "http://127.0.0.1:3000";

async function preparePage(context) {
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
    body: "/* deterministic analytics loader stub for keyboard audit */",
  }));
  await page.goto(baseUrl, { waitUntil: "load", timeout: 30_000 });
  // Bounded readiness instead of networkidle: keep-alive sessions and analytics
  // stubs can hold the network busy forever. DOM landmarks plus hydration state
  // are deterministic; a short settle window lets late layout settle without
  // masking genuinely pending requests (console gate still fires).
  await page.waitForLoadState("load", { timeout: 30_000 });
  await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.readyState === "complete"
      && Array.from(document.querySelectorAll("script"))
        .some((script) => script.src.includes("/_next/static/chunks/")),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(160);

  const consent = page.getByRole("button", { name: "Разрешить", exact: true });
  if (await consent.isVisible()) {
    await consent.click();
    await consent.waitFor({ state: "hidden" });
  }

  await page.reload({ waitUntil: "load", timeout: 30_000 });
  await page.waitForLoadState("load", { timeout: 30_000 });
  await page.waitForFunction(
    () => document.readyState === "complete"
      && Array.from(document.querySelectorAll("script"))
        .some((script) => script.src.includes("/_next/static/chunks/")),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(160);
  await page.locator('[data-landing-experience="signal-lock"]').waitFor({ state: "attached" });
  await page.locator("#scene-detection").waitFor({ state: "visible" });
  return { page, assertCleanConsole: () => assert.deepEqual(consoleMessages, []) };
}

function rememberFirst(map, category, index) {
  if (category && !map.has(category)) map.set(category, index);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, assertCleanConsole } = await preparePage(context);
  const sequence = [];
  const categoryIndex = new Map();
  const legal = { offer: false, privacy: false };
  let reachedCookieSettings = false;
  let mobileDisclosureToggled = false;
  let deliveryDisclosureToggled = false;

  for (let index = 0; index < 180; index += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const header = document.querySelector('header[data-brand-header="recruiter-radar"]');
      const headerRect = header?.getBoundingClientRect() ?? null;
      const text = (element.getAttribute("aria-label") || element.textContent || "")
        .trim().replace(/\s+/g, " ").slice(0, 120);
      let category = null;
      if (text === "Перейти к содержанию") category = "skip";
      else if (element.closest("header")) category = "header";
      else if (element.closest("#scene-detection")) category = "hero";
      else if (element.closest("#scene-workspace")) category = "preview";
      else if (element.closest("#scene-delivery")) category = "delivery";
      else if (element.closest("#pricing")) category = "pricing";
      else if (element.closest("#faq")) category = "faq";
      else if (element.closest("#conversion-final")) category = "final";
      else if (element.closest("footer")) category = "footer";
      return {
        tag: element.tagName.toLowerCase(),
        text,
        category,
        rect: rect.toJSON(),
        display: style.display,
        visibility: style.visibility,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        inHeader: Boolean(element.closest("header")),
        headerBottom: headerRect?.bottom ?? 0,
        mobileDisclosure: element.matches('[data-mobile-lead-disclosure="true"]'),
        deliverySummary: element.matches("#scene-delivery summary"),
      };
    });

    assert.ok(focused, `keyboard: missing active element after Tab ${index + 1}`);
    assert.ok(focused.rect.width > 0 && focused.rect.height > 0, `keyboard: hidden focus target ${focused.text}`);
    assert.notEqual(focused.display, "none", `keyboard: display:none focus target ${focused.text}`);
    assert.notEqual(focused.visibility, "hidden", `keyboard: visibility:hidden focus target ${focused.text}`);
    assert.notEqual(focused.outlineStyle, "none", `keyboard: missing focus ring for ${focused.text}`);
    assert.ok(focused.outlineWidth >= 2, `keyboard: focus ring thinner than 2px for ${focused.text}`);
    assert.ok(focused.rect.left >= -1 && focused.rect.right <= 391, `keyboard: focused target escapes viewport ${focused.text}`);
    if (!focused.inHeader && focused.category !== "skip") {
      assert.ok(focused.rect.top >= focused.headerBottom - 1, `keyboard: focused target hidden under sticky header ${focused.text}`);
      assert.ok(focused.rect.bottom <= 845, `keyboard: focused target below viewport ${focused.text}`);
    }

    sequence.push(focused);
    rememberFirst(categoryIndex, focused.category, index);

    if (focused.mobileDisclosure) {
      const disclosure = page.locator('[data-mobile-lead-disclosure="true"]');
      assert.equal(await disclosure.getAttribute("aria-expanded"), "false");
      await page.keyboard.press("Enter");
      assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Enter");
      assert.equal(await disclosure.getAttribute("aria-expanded"), "false");
      mobileDisclosureToggled = true;
    }

    if (focused.deliverySummary) {
      const details = page.locator("#scene-delivery details");
      assert.equal(await details.getAttribute("open"), null);
      await page.keyboard.press("Enter");
      assert.notEqual(await details.getAttribute("open"), null);
      await page.keyboard.press("Enter");
      assert.equal(await details.getAttribute("open"), null);
      deliveryDisclosureToggled = true;
    }

    if (focused.category === "footer") {
      if (/Оферта/i.test(focused.text)) legal.offer = true;
      if (/Конфиденциальност/i.test(focused.text)) legal.privacy = true;
      if (focused.text === "Настройки cookies") {
        reachedCookieSettings = true;
        break;
      }
    }
  }

  assert.equal(sequence[0]?.category, "skip", "keyboard: skip link must be first");
  assert.equal(reachedCookieSettings, true, "keyboard: cookie settings not reachable within tab budget");
  assert.equal(mobileDisclosureToggled, true, "keyboard: mobile disclosure was not reached/toggled");
  assert.equal(deliveryDisclosureToggled, true, "keyboard: Delivery disclosure was not reached/toggled");
  assert.deepEqual(legal, { offer: true, privacy: true }, "keyboard: legal links were not both reached");

  const ordered = ["skip", "header", "hero", "preview", "delivery", "pricing", "faq", "final", "footer"];
  for (const category of ordered) assert.ok(categoryIndex.has(category), `keyboard: did not reach ${category}`);
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(
      categoryIndex.get(ordered[index - 1]) < categoryIndex.get(ordered[index]),
      `keyboard: ${ordered[index]} appeared before ${ordered[index - 1]}`,
    );
  }

  const programmaticTargets = [
    page.getByRole("link", { name: /Конфиденциальность/ }).last(),
    page.getByRole("button", { name: "Настройки cookies", exact: true }),
  ];
  for (const target of programmaticTargets) {
    await target.scrollIntoViewIfNeeded();
    await target.focus();
    const geometry = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        active: document.activeElement === element,
        top: rect.top,
        bottom: rect.bottom,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    });
    assert.equal(geometry.active, true, "footer: programmatic focus did not land");
    assert.notEqual(geometry.outlineStyle, "none", "footer: focus ring missing");
    assert.ok(geometry.outlineWidth >= 2, "footer: focus ring thinner than 2px");
    assert.ok(geometry.top >= 0 && geometry.bottom <= 845, "footer: focused target outside viewport");
  }

  assertCleanConsole();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    viewport: "390x844",
    tabStops: sequence.length,
    categories: Object.fromEntries(categoryIndex),
    legal,
    reachedCookieSettings,
    mobileDisclosureToggled,
    deliveryDisclosureToggled,
  })}\n`);
  await context.close();
} finally {
  await browser.close();
}
