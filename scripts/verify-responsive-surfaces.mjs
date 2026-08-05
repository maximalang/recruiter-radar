#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.RESPONSIVE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const outputDir = path.resolve(process.env.RESPONSIVE_ARTIFACT_DIR ?? '/tmp/recruiter-radar-responsive');
const routes = [
  '/',
  '/login',
  '/checkout',
  '/dashboard',
  '/opportunities',
  '/leads',
  '/review',
  '/profile',
  '/settings',
  '/settings/profile',
  '/settings/security',
  '/settings/team',
  '/onboarding',
  '/admin',
  '/legal',
  '/privacy',
  '/terms',
  '/auth/verify',
  '/auth/confirm',
  '/auth/invite',
  '/auth/change-email',
];
const viewports = [
  { name: 'mobile-320', width: 320, height: 720 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 1000 },
];

function slug(route) {
  return route === '/' ? 'landing' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-');
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
let failed = false;

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport,
      locale: 'ru-RU',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    for (const origin of ['https://mc.yandex.ru/**', 'https://mc.yandex.com/**']) {
      await context.route(origin, (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
      );
    }
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
      await page.waitForTimeout(250);

      const status = response?.status() ?? 0;
      const result = await page.evaluate(() => {
        const root = document.documentElement;
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0'
            && rect.width > 0
            && rect.height > 0
            && !element.closest('[hidden], [inert], [aria-hidden="true"]')
          );
        };
        const accessibleName = (element) => {
          const labelledBy = element.getAttribute('aria-labelledby');
          const labelledByText = labelledBy
            ? labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
                .join(' ')
                .trim()
            : '';
          const associatedLabel = 'labels' in element
            ? [...(element.labels ?? [])]
                .map((label) => label.textContent?.trim() ?? '')
                .join(' ')
                .trim()
            : '';
          return (
            element.getAttribute('aria-label')?.trim()
            || labelledByText
            || associatedLabel
            || element.getAttribute('title')?.trim()
            || element.textContent?.trim()
            || ''
          );
        };
        const effectiveRect = (element) => {
          if (
            element instanceof HTMLInputElement
            && (element.type === 'checkbox' || element.type === 'radio')
          ) {
            const label = element.labels?.[0] ?? element.closest('label');
            if (label && visible(label)) return label.getBoundingClientRect();
          }
          return element.getBoundingClientRect();
        };
        const needsTouchTarget = (element) => {
          if (!(element instanceof HTMLAnchorElement)) return true;
          const style = window.getComputedStyle(element);
          const className = typeof element.className === 'string' ? element.className : '';
          return (
            ['flex', 'inline-flex', 'grid', 'inline-grid', 'block'].includes(style.display)
            || /nav|button|action|cta|back|brand/i.test(className)
            || element.getAttribute('role') === 'button'
          );
        };

        const interactive = Array.from(document.querySelectorAll(
          'a[href], button, [role="button"], [role="link"], input:not([type="hidden"]), select, textarea, summary',
        )).filter(visible);

        const undersized = interactive
          .filter(needsTouchTarget)
          .map((element) => {
            const rect = effectiveRect(element);
            return {
              tag: element.tagName.toLowerCase(),
              label: accessibleName(element).slice(0, 80),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
            };
          })
          .filter((item) => item.width < 44 || item.height < 44);

        const unlabeledControls = interactive
          .filter((element) => {
            if (element instanceof HTMLInputElement && element.type === 'hidden') return false;
            return accessibleName(element) === '';
          })
          .map((element) => element.outerHTML.slice(0, 300));

        const unlabeledFormControls = Array.from(
          document.querySelectorAll('input:not([type="hidden"]), select, textarea'),
        )
          .filter(visible)
          .filter((element) => accessibleName(element) === '')
          .map((element) => element.outerHTML.slice(0, 300));

        const formButtonsWithoutType = Array.from(document.querySelectorAll('form button'))
          .filter(visible)
          .filter((element) => !element.hasAttribute('type'))
          .map((element) => element.outerHTML.slice(0, 300));

        const invalidLinks = Array.from(document.querySelectorAll('a[href]'))
          .filter(visible)
          .filter((element) => {
            const href = element.getAttribute('href')?.trim() ?? '';
            return href === '' || href.toLowerCase().startsWith('javascript:');
          })
          .map((element) => element.outerHTML.slice(0, 300));

        const idCounts = new Map();
        for (const element of document.querySelectorAll('[id]')) {
          const id = element.id;
          if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
        }
        const duplicateIds = [...idCounts.entries()]
          .filter(([, count]) => count > 1)
          .map(([id, count]) => ({ id, count }));

        const clippedControls = interactive
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              label: accessibleName(element).slice(0, 80),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
            };
          })
          .filter((item) => item.left < -1 || item.right > window.innerWidth + 1);

        return {
          title: document.title,
          scrollWidth: root.scrollWidth,
          innerWidth: window.innerWidth,
          horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
          undersized,
          unlabeledControls,
          unlabeledFormControls,
          formButtonsWithoutType,
          invalidLinks,
          duplicateIds,
          clippedControls,
          interactiveCount: interactive.length,
        };
      });

      let keyboardFocus = true;
      if (result.interactiveCount > 0) {
        await page.keyboard.press('Tab');
        keyboardFocus = await page.evaluate(() => {
          const active = document.activeElement;
          return Boolean(active && active !== document.body && active !== document.documentElement);
        });
      }

      const screenshot = path.join(outputDir, `${viewport.name}-${slug(route)}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });

      const entry = {
        viewport: viewport.name,
        route,
        finalUrl: page.url(),
        status,
        ...result,
        keyboardFocus,
        consoleErrors,
        screenshot,
      };
      report.push(entry);

      if (
        status >= 500
        || result.horizontalOverflow
        || result.undersized.length > 0
        || result.unlabeledControls.length > 0
        || result.unlabeledFormControls.length > 0
        || result.formButtonsWithoutType.length > 0
        || result.invalidLinks.length > 0
        || result.duplicateIds.length > 0
        || result.clippedControls.length > 0
        || !keyboardFocus
        || consoleErrors.length > 0
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
    unlabeledControls: entry.unlabeledControls.length,
    unlabeledFormControls: entry.unlabeledFormControls.length,
    formButtonsWithoutType: entry.formButtonsWithoutType.length,
    invalidLinks: entry.invalidLinks.length,
    duplicateIds: entry.duplicateIds.length,
    clippedControls: entry.clippedControls.length,
    keyboardFocus: entry.keyboardFocus,
    consoleErrors: entry.consoleErrors.length,
  }));
}

if (failed) {
  console.error(`Responsive and interaction audit failed. Inspect ${path.join(outputDir, 'report.json')}`);
  process.exitCode = 1;
}
