#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.RESPONSIVE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const outputDir = path.resolve(process.env.RESPONSIVE_ARTIFACT_DIR ?? '/tmp/recruiter-radar-responsive');
const routes = [
  '/',
  '/login',
  '/checkout?plan=pilot',
  '/checkout?plan=monthly',
  '/checkout?plan=quarterly',
  '/legal',
  '/terms',
  '/payment-and-refund',
  '/privacy',
  '/personal-data-consent',
  '/dashboard',
  '/leads',
  '/review',
  '/profile',
  '/settings/profile',
  '/admin',
];
const viewports = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'desktop-1280', width: 1280, height: 900 },
];

function slug(route) {
  return route === '/'
    ? 'landing'
    : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '');
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
let failed = false;

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    await context.route('https://mc.yandex.ru/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
    );
    await context.route('**/api/landing-events', (route) =>
      route.fulfill({ status: 204, body: '' }),
    );
    for (const route of routes) {
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500));
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message.slice(0, 500)));

      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForTimeout(300);

      const status = response?.status() ?? 0;
      const result = await page.evaluate(() => {
        const root = document.documentElement;
        const interactive = Array.from(document.querySelectorAll('button, [role="button"], input, select, textarea'));
        const undersized = interactive
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 80) || '',
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          })
          .filter((item) => item.width < 44 || item.height < 44);

        const iconOnlyWithoutLabel = Array.from(document.querySelectorAll('button, a'))
          .filter((element) => {
            const text = element.textContent?.trim() ?? '';
            const hasSvg = element.querySelector('svg') !== null;
            return hasSvg && text === '' && !element.getAttribute('aria-label') && !element.getAttribute('title');
          })
          .map((element) => element.outerHTML.slice(0, 300));

        return {
          title: document.title,
          scrollWidth: root.scrollWidth,
          innerWidth: window.innerWidth,
          horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
          undersized,
          iconOnlyWithoutLabel,
        };
      });

      const screenshot = path.join(outputDir, `${viewport.name}-${slug(route)}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });

      const entry = {
        viewport: viewport.name,
        route,
        finalUrl: page.url(),
        status,
        ...result,
        consoleErrors,
        screenshot,
      };
      report.push(entry);

      if (
        status >= 500 ||
        result.horizontalOverflow ||
        result.undersized.length > 0 ||
        result.iconOnlyWithoutLabel.length > 0 ||
        consoleErrors.length > 0
      ) {
        failed = true;
      }
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const entry of report) {
  console.log(JSON.stringify({
    viewport: entry.viewport,
    route: entry.route,
    status: entry.status,
    finalUrl: entry.finalUrl,
    horizontalOverflow: entry.horizontalOverflow,
    undersized: entry.undersized.length,
    unlabeledIconControls: entry.iconOnlyWithoutLabel.length,
    consoleErrors: entry.consoleErrors.length,
  }));
}

if (failed) {
  console.error(`Responsive audit failed. Inspect ${path.join(outputDir, 'report.json')}`);
  process.exitCode = 1;
}
