#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.RESPONSIVE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const outputDir = path.resolve(process.env.RESPONSIVE_ARTIFACT_DIR ?? '/tmp/recruiter-radar-responsive');
const captureAll = process.env.RESPONSIVE_CAPTURE_ALL === 'true';
const configuredMaxNavigationMs = Number(process.env.RESPONSIVE_MAX_NAVIGATION_MS ?? 0);
const routes = [
  { path: '/' },
  { path: '/login' },
  { path: '/checkout' },
  { path: '/dashboard' },
  { path: '/opportunities', allowNotFound: true, unavailableReason: 'feature-flagged' },
  { path: '/opportunities/radar', allowNotFound: true, unavailableReason: 'feature-flagged' },
  { path: '/settings/diagnostics/sources', allowNotFound: true, unavailableReason: 'feature-flagged' },
  { path: '/leads' },
  { path: '/review' },
  { path: '/profile' },
  { path: '/settings' },
  { path: '/settings/access' },
  { path: '/settings/account' },
  { path: '/settings/delivery' },
  { path: '/settings/profile' },
  { path: '/settings/radar' },
  { path: '/settings/security' },
  { path: '/settings/team' },
  { path: '/onboarding' },
  { path: '/admin' },
  { path: '/admin/payments' },
  { path: '/legal' },
  { path: '/privacy' },
  { path: '/personal-data-consent' },
  { path: '/terms' },
  { path: '/offer' },
  { path: '/payment-and-refund' },
  { path: '/auth/verify' },
  { path: '/auth/confirm' },
  { path: '/auth/invite' },
  { path: '/auth/change-email' },
];
const viewports = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop-1366', width: 1366, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1536', width: 1536, height: 960 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];
const representativeRoutes = new Set(['/', '/login', '/checkout', '/legal']);
const representativeViewports = new Set(['mobile-390', 'tablet-1024', 'desktop-1440']);
const RETRYABLE_CONTEXT_ERROR = /Execution context was destroyed|Cannot find context with specified id/i;

function slug(route) {
  return route === '/' ? 'landing' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-');
}

async function waitForVisualReadiness(page) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    await page.waitForLoadState('load', { timeout: remaining });
    const settledUrl = page.url();

    try {
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (RETRYABLE_CONTEXT_ERROR.test(message) && Date.now() < deadline) continue;
      throw error;
    }

    await page.waitForTimeout(75);
    if (page.url() === settledUrl) return;
  }

  throw new Error(`Visual readiness did not stabilize for ${page.url()}`);
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
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

    for (const routeSpec of routes) {
      const route = routeSpec.path;
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
      await waitForVisualReadiness(page);

      const analyticsConsent = page.locator('[data-analytics-consent="true"]');
      if (await analyticsConsent.isVisible().catch(() => false)) {
        const allowAnalytics = analyticsConsent.getByRole('button', { name: 'Разрешить' });
        if (await allowAnalytics.count() > 0) {
          await allowAnalytics.click();
          await analyticsConsent.waitFor({ state: 'hidden', timeout: 5_000 });
        }
      }

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
            && rect.bottom > 0
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
          const imageAlt = element.querySelector?.('img[alt]')?.getAttribute('alt')?.trim() ?? '';
          const controlValue = 'value' in element && typeof element.value === 'string'
            ? element.value.trim()
            : '';
          return (
            element.getAttribute('aria-label')?.trim()
            || labelledByText
            || associatedLabel
            || element.getAttribute('title')?.trim()
            || element.textContent?.trim()
            || imageAlt
            || controlValue
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
            || /nav|button|action|cta|back|brand|footer/i.test(className)
            || element.getAttribute('role') === 'button'
          );
        };
        const insideHorizontalScroller = (element) => {
          let ancestor = element.parentElement;
          while (ancestor && ancestor !== document.body) {
            const style = window.getComputedStyle(ancestor);
            const canScrollHorizontally = ['auto', 'scroll'].includes(style.overflowX);
            if (canScrollHorizontally && ancestor.scrollWidth > ancestor.clientWidth + 1) {
              return true;
            }
            ancestor = ancestor.parentElement;
          }
          return false;
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
          .filter((element) => !insideHorizontalScroller(element))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              label: accessibleName(element).slice(0, 80),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
            };
          })
          .filter((item) => item.left < -1 || item.right > window.innerWidth + 1);

        const dialogs = Array.from(document.querySelectorAll('dialog, [role="dialog"]'))
          .filter(visible);
        const unlabeledDialogs = dialogs
          .filter((element) => accessibleName(element) === '')
          .map((element) => element.outerHTML.slice(0, 300));

        const motionElements = Array.from(document.querySelectorAll(
          '[data-motion-interactive], [data-motion-list] [data-motion-item], [data-motion-status], [data-motion-disclosure], [data-motion-icon]',
        )).filter(visible);
        const durationMs = (value) => {
          const normalized = value.trim();
          return normalized.endsWith('ms')
            ? Number.parseFloat(normalized)
            : Number.parseFloat(normalized) * 1000;
        };
        const reducedMotionViolations = motionElements
          .map((element) => {
            const style = window.getComputedStyle(element);
            const transitionDurations = style.transitionDuration
              .split(',')
              .map(durationMs)
              .filter(Number.isFinite);
            const animationNames = style.animationName
              .split(',')
              .map((name) => name.trim())
              .filter((name) => name && name !== 'none');
            return {
              element: element.outerHTML.slice(0, 180),
              transitionDuration: style.transitionDuration,
              animationName: style.animationName,
              violates: transitionDurations.some((duration) => duration > 1)
                || animationNames.length > 0,
            };
          })
          .filter((item) => item.violates);

        const continuousAnimations = document.getAnimations({ subtree: true })
          .filter((animation) => {
            const timing = animation.effect?.getTiming();
            return animation.playState === 'running' && timing?.iterations === Infinity;
          })
          .map((animation) => ({
            animationName: animation.animationName,
            target: animation.effect?.target?.outerHTML?.slice(0, 180) ?? '',
          }));

        const bodyText = document.body?.innerText?.toLowerCase() ?? '';
        const semanticNotFound = Boolean(
          document.querySelector('[data-nextjs-error-code="404"]')
          || [...document.querySelectorAll('h1')]
            .filter(visible)
            .some((heading) => heading.innerText.trim() === '404')
          || bodyText.includes('this page could not be found'),
        );
        const navigationEntry = performance.getEntriesByType('navigation')[0];

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
          unlabeledDialogs,
          semanticNotFound,
          reducedMotionMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          reducedMotionViolations,
          continuousAnimations,
          motionElementCount: motionElements.length,
          navigationDurationMs: navigationEntry
            ? Math.round(navigationEntry.duration * 10) / 10
            : null,
          interactiveCount: interactive.length,
        };
      });

      const firstDisclosure = page.locator('details > summary:visible').first();
      const disclosureAvailable = await firstDisclosure.count() > 0;
      let disclosureAudit = { available: false, opened: false, clippedControls: [] };
      if (disclosureAvailable) {
        const disclosureWasOpen = await firstDisclosure.evaluate((summary) =>
          Boolean(summary.closest('details')?.open),
        );
        if (!disclosureWasOpen) await firstDisclosure.click();
        disclosureAudit = await firstDisclosure.evaluate((summary) => {
          const details = summary.closest('details');
          const controls = details
            ? Array.from(details.querySelectorAll('a[href], button, input, select, textarea, summary'))
            : [];
          const clippedControls = controls
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName.toLowerCase(),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
              };
            })
            .filter((item) => item.left < -1 || item.right > window.innerWidth + 1);
          return {
            available: true,
            opened: Boolean(details?.open),
            clippedControls,
          };
        });
      }

      let keyboardFocus = true;
      let focusIndicator = true;
      let focusedElement = null;
      if (result.interactiveCount > 0) {
        await page.keyboard.press('Tab');
        ({ keyboardFocus, focusIndicator, focusedElement } = await page.evaluate(() => {
          const active = document.activeElement;
          const keyboardFocus = Boolean(
            active && active !== document.body && active !== document.documentElement,
          );
          if (!keyboardFocus) {
            return { keyboardFocus: false, focusIndicator: false, focusedElement: null };
          }
          const style = window.getComputedStyle(active);
          const hasOutline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
          const hasShadow = style.boxShadow !== 'none';
          return {
            keyboardFocus: true,
            focusIndicator: hasOutline || hasShadow,
            focusedElement: active.outerHTML.slice(0, 240),
          };
        }));
      }

      const unexpectedNotFound = result.semanticNotFound && !routeSpec.allowNotFound;
      const badStatus = status >= 400 && !(status === 404 && routeSpec.allowNotFound);
      const navigationTooSlow = Number.isFinite(configuredMaxNavigationMs)
        && configuredMaxNavigationMs > 0
        && result.navigationDurationMs !== null
        && result.navigationDurationMs > configuredMaxNavigationMs;
      const entryFailed = (
        badStatus
        || unexpectedNotFound
        || result.horizontalOverflow
        || result.undersized.length > 0
        || result.unlabeledControls.length > 0
        || result.unlabeledFormControls.length > 0
        || result.formButtonsWithoutType.length > 0
        || result.invalidLinks.length > 0
        || result.duplicateIds.length > 0
        || result.clippedControls.length > 0
        || result.unlabeledDialogs.length > 0
        || !result.reducedMotionMatches
        || result.reducedMotionViolations.length > 0
        || result.continuousAnimations.length > 0
        || (disclosureAudit.available && !disclosureAudit.opened)
        || disclosureAudit.clippedControls.length > 0
        || !keyboardFocus
        || !focusIndicator
        || navigationTooSlow
        || consoleErrors.length > 0
      );
      const representativeCapture = representativeRoutes.has(route)
        && representativeViewports.has(viewport.name);
      const screenshot = entryFailed || captureAll || representativeCapture
        ? path.join(outputDir, `${viewport.name}-${slug(route)}.png`)
        : null;
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });

      const entry = {
        viewport: viewport.name,
        route,
        surfaceState: result.semanticNotFound
          ? (routeSpec.allowNotFound ? routeSpec.unavailableReason : 'unexpected-not-found')
          : (
              route !== '/login' && new URL(page.url()).pathname === '/login'
                ? 'authentication-required'
                : 'rendered'
            ),
        finalUrl: page.url(),
        status,
        ...result,
        keyboardFocus,
        focusIndicator,
        focusedElement,
        disclosureAudit,
        navigationTooSlow,
        consoleErrors,
        screenshot,
      };
      report.push(entry);

      if (entryFailed) failed = true;
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
    surfaceState: entry.surfaceState,
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
    unlabeledDialogs: entry.unlabeledDialogs.length,
    semanticNotFound: entry.semanticNotFound,
    reducedMotionViolations: entry.reducedMotionViolations.length,
    continuousAnimations: entry.continuousAnimations.length,
    disclosureOpened: entry.disclosureAudit.opened,
    keyboardFocus: entry.keyboardFocus,
    focusIndicator: entry.focusIndicator,
    navigationDurationMs: entry.navigationDurationMs,
    consoleErrors: entry.consoleErrors.length,
  }));
}

if (failed) {
  console.error(`Responsive and interaction audit failed. Inspect ${path.join(outputDir, 'report.json')}`);
  process.exitCode = 1;
}
