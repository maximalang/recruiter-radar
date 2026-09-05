import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("polished unified landing visual contract", () => {
  it("restores the dark ambient hero with the signal field on canonical tokens", () => {
    const heroScene = source("app/landing/detection-scene.tsx");
    const sceneStyles = source("app/landing/detection-scene.module.css");
    const landingStyles = source("app/landing/landing.module.css");
    const visualStyles = source("app/landing/landing-visual-system.module.css");
    const obsoleteResponsiveStyles = resolve(WEB_ROOT, "app/landing/detection-responsive.module.css");
    const retiredRadar = resolve(WEB_ROOT, "app/landing/hero-radar.tsx");
    const retiredRadarStyles = resolve(WEB_ROOT, "app/landing/hero-radar.module.css");

    expect(heroScene).toContain('data-hero-layout="product-workspace"');
    expect(heroScene).toContain('data-theme="inverse"');
    expect(heroScene).toContain('data-hero-visual');
    expect(heroScene).toContain("HeroProductPreview");
    expect(heroScene).toContain("Посмотреть пример продукта");
    expect(heroScene).not.toContain("HeroRadar");
    expect(heroScene).not.toContain("HeroInstrument");
    expect(existsSync(retiredRadar)).toBe(false);
    expect(existsSync(retiredRadarStyles)).toBe(false);
    expect(sceneStyles).toContain("var(--color-text-primary)");
    expect(sceneStyles).toContain("var(--color-signal)");
    expect(sceneStyles).not.toContain("#c8f36a");
    expect(landingStyles).not.toMatch(/\.(detectionScene|detectionField|detectionCopy|detectionLock|detectionFooter|instrumentCaption)\b/);
    expect(visualStyles).not.toContain('#scene-detection [class*=');
    expect(existsSync(obsoleteResponsiveStyles)).toBe(false);
  });

  it("keeps the ambient radar readable on mobile without a separate runtime", () => {
    const heroScene = source("app/landing/detection-scene.tsx");
    const sceneStyles = source("app/landing/detection-scene.module.css");

    expect(heroScene).toContain("data-mobile-hero-signal");
    expect(heroScene).toContain('className={sceneStyles.fieldFigure}');
    expect(sceneStyles).toContain("@media (max-width: 600px)");
    expect(sceneStyles).toContain(".fieldFigure");
    expect(sceneStyles).not.toContain("HeroRadar");
  });

  it("restores the signal timeline scene after the hero", () => {
    const page = source("app/landing/landing-page.tsx");
    const detectionIndex = page.indexOf("<DetectionScene");
    const timelineIndex = page.indexOf("<SignalTimeline />");
    const workspaceIndex = page.indexOf("<WorkspaceScene");

    expect(page).not.toContain("SignalTimelineScene");
    expect(existsSync(resolve(WEB_ROOT, "app/landing/signal-timeline-scene.tsx"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "app/landing/signal-timeline-scene.module.css"))).toBe(false);
    expect(timelineIndex).toBeGreaterThan(detectionIndex);
    expect(workspaceIndex).toBeGreaterThan(timelineIndex);
  });

  it("separates the core workspace from connected delivery routes", () => {
    const delivery = source("app/landing/delivery-scene.tsx");

    expect(delivery).toContain('data-delivery-core="workspace"');
    expect(delivery).toContain('data-delivery-routes="connected"');
    expect(delivery).toContain("PRIMARY_ROUTES.map");
    expect(delivery).toContain("EXTRA_ROUTES.map");
  });

  it("preserves the manual outreach boundary without a standalone composer scene", () => {
    const page = source("app/landing/landing-page.tsx");
    const delivery = source("app/landing/delivery-scene.tsx");
    const conversion = source("app/landing/conversion-panel.tsx");

    expect(page).not.toContain("OutreachScene");
    expect(existsSync(resolve(WEB_ROOT, "app/landing/outreach-scene.tsx"))).toBe(false);
    expect(delivery).toContain("Сообщения компаниям не отправляются автоматически");
    expect(delivery).toContain('data-manual-outreach-boundary="true"');
    expect(conversion).not.toContain("TargetIcon");
    expect(conversion).not.toContain('data-final-signal-composition="agency-profile"');
    expect(source("app/landing/conversion-panel.module.css")).not.toContain("right: -3rem");
  });

  it("keeps the landing skip link first and exposes one main content landmark", () => {
    const home = source("app/home-page-content.tsx");
    const landingPage = source("app/landing/landing-page.tsx");
    const landingPageBody = landingPage.slice(landingPage.indexOf("export default function LandingPage"));
    const skipLinkIndex = home.indexOf("<LandingSkipLink />");
    const analyticsIndex = home.indexOf("<LandingAnalytics />");
    const landingIndex = home.indexOf("{landing}");
    const cookieSettingsIndex = home.indexOf("<YandexMetrika />");

    expect(home).toMatch(/<PageFrame[\s\S]*?\bas="div"/);
    expect(skipLinkIndex).toBeGreaterThan(-1);
    expect(analyticsIndex).toBeGreaterThan(skipLinkIndex);
    expect(landingIndex).toBeGreaterThan(analyticsIndex);
    expect(cookieSettingsIndex).toBeGreaterThan(landingIndex);
    expect(landingPage).toContain('export function LandingSkipLink()');
    expect(landingPage).toContain('<main id="main-content">');
    expect(landingPageBody).not.toContain('<a href="#main-content" className={styles.skipLink}>');
  });

  it("keeps cookie settings in the footer instead of a floating utility", () => {
    const consentStyles = source("app/yandex-metrika.module.css");
    const footerControl = source("app/ui/cookie-settings-button.tsx");

    expect(consentStyles).not.toContain(".settingsButton");
    expect(footerControl).toContain("ANALYTICS_SETTINGS_OPEN_EVENT");
    expect(footerControl).toContain("window.dispatchEvent");
  });

  it("uses one stable preview anchor without duplicating it in the skeleton export", () => {
    // Stable anchors: the compact anchor belt keeps one stable preview anchor
    // without duplicating it in the page-level skeleton export.
    const workspace = source("app/landing/workspace-scene.tsx");
    const skeletonStart = workspace.indexOf("export function WorkspaceResultsSkeleton");
    const skeletonSource = workspace.slice(skeletonStart);

    expect(workspace).toContain('id="preview-results"');
    expect(workspace).toContain('id="preview-configurator"');
    expect(workspace).toContain("data-preview-results-ready");
    expect(workspace).not.toContain("<Suspense");
    expect(workspace).toContain("LandingPreviewInteractions");
    expect(skeletonSource).not.toContain('id="preview-results"');
    expect(skeletonSource).toContain("data-preview-results-skeleton");
  });

  it("switches header tone at the actual pricing, faq, and closing surfaces", () => {
    const conversion = source("app/landing/conversion-panel.tsx");

    expect(conversion).not.toContain('aria-label="Тарифы и ответы" data-header-tone="dark"');
    expect(conversion).toMatch(/id="pricing"[\s\S]*?data-header-tone="light"/);
    expect(conversion).toMatch(/id="faq"[\s\S]*?data-header-tone="light"/);
    expect(conversion).toMatch(/id="conversion-final"[\s\S]*?data-header-tone="dark"/);
  });

  it("keeps footer styling local and removes the obsolete global override layer", () => {
    const layout = source("app/layout.tsx");
    const footerModule = source("app/ui/site-footer.module.css");
    const legacyFooterCss = resolve(WEB_ROOT, "app/footer-visual-system.css");

    expect(layout).not.toContain('import "./footer-visual-system.css"');
    expect(existsSync(legacyFooterCss)).toBe(false);
    expect(footerModule).toContain('.siteFooter[data-tone="dark"]');
    expect(footerModule).not.toContain('[class*="footer');
  });

  it("scopes the product visual layer through stable data contracts", () => {
    const productCss = source("app/product-visual-system.css");
    const landingCss = source("app/landing/landing-visual-system.module.css");

    expect(productCss).toContain('[data-ui-system="recruiter-radar"]');
    expect(productCss).not.toMatch(/recruiter-radar-v\d+/);
    expect(productCss).toContain('[data-product-workspace="true"]');
    expect(productCss).not.toContain('[class*=');
    expect(productCss).not.toContain("!important");
    expect(landingCss).not.toContain('[class*=');
  });

  it("locks the required responsive viewport and legal surface audit", () => {
    const responsiveAudit = source("../../scripts/verify-responsive-surfaces.mjs");
    const productionAudit = source("scripts/verify-landing-production.mjs");

    expect(responsiveAudit).toContain("{ name: 'mobile-360', width: 360, height: 800 }");
    expect(responsiveAudit).toContain("{ name: 'mobile-390', width: 390, height: 844 }");
    expect(responsiveAudit).toContain("{ name: 'tablet-768', width: 768, height: 1024 }");
    expect(responsiveAudit).toContain("{ name: 'tablet-1024', width: 1024, height: 768 }");
    expect(responsiveAudit).toContain("{ name: 'desktop-1440', width: 1440, height: 900 }");
    expect(responsiveAudit).toContain("'/offer'");
    expect(responsiveAudit).toContain("'/payment-and-refund'");
    expect(productionAudit).toContain('LANDING_REQUIRE_ANALYTICS_CONSENT === "true"');
    expect(productionAudit).toContain("analytics consent control is required for this audit");
    // Deterministic audit lifecycle: derive the ACTUAL executed child list from
    // the runner source instead of hardcoding helpers, so any new or renamed
    // child of `test:landing:e2e` is automatically covered. Every executed
    // Playwright helper must settle via load + explicit readiness, never
    // networkidle (keep-alive sessions hold the network busy indefinitely).
    const normalize = (text: string) => text.replace(/\r\n/g, "\n");
    const landingPageSource = source("app/landing/landing-page.tsx");
    const runnerSource = normalize(source("scripts/run-landing-production-audit.mjs"));
    const captureReviewSource = normalize(source("scripts/capture-landing-review.mjs"));
    const productionAuditNormalized = normalize(productionAudit);
    // Build-time analytics capability must be visible in the page DOM as a
    // safe boolean marker (no id/secrets), so audits can prove the audited
    // bundle matches the requested mode without trusting runtime env.
    expect(landingPageSource).toContain('data-landing-analytics={isYandexMetrikaConfigured() ? "enabled" : "disabled"}');
    expect(productionAuditNormalized).toContain('getAttribute("data-landing-analytics")');
    expect(productionAuditNormalized).toContain("LANDING_AUDIT_MODE=enabled requires an analytics-enabled production bundle");
    expect(productionAuditNormalized).toContain("LANDING_AUDIT_MODE=disabled requires an analytics-disabled production bundle");
    // The runner resolves the production audit through the shared path helper
    // (not an inline literal), and the mode guard lives in the runner itself.
    expect(runnerSource).toContain("resolveAuditScriptPath(import.meta.url)");
    expect(runnerSource).toContain('LANDING_AUDIT_MODE must be set to "enabled" or "disabled"');
    // Child scripts appear as fileURLToPath(new URL("./name.mjs", ...)) plus the
    // auditScript resolved via landing-audit-path (verify-landing-production.mjs).
    const runnerChildMatches = runnerSource.matchAll(/fileURLToPath\(new URL\("\.\/([\w.-]+\.mjs)"/g);
    const runnerChildFiles = Array.from(
      new Set([...Array.from(runnerChildMatches, (match) => match[1]), "verify-landing-production.mjs"]),
    ).sort();
    expect(runnerChildFiles.length).toBeGreaterThanOrEqual(4);
    for (const childFile of runnerChildFiles) {
      const childPath = resolve(WEB_ROOT, "scripts", childFile);
      expect(existsSync(childPath)).toBe(true);
      const childSource = normalize(readFileSync(childPath, "utf8"));
      if (!childSource.includes("chromium")) continue;
      expect(childSource).not.toContain('waitUntil: "networkidle"');
      expect(childSource).not.toContain('waitForLoadState("networkidle")');
      if (childSource.includes("page.goto") || childSource.includes("page.reload")) {
        expect(childSource).toContain('waitUntil: "load"');
        expect(childSource).toContain('document.readyState === "complete"');
      }
    }
    for (const auditSource of [productionAudit, source("scripts/verify-landing-axe.mjs"), source("scripts/capture-landing-review.mjs"), source("scripts/verify-landing-accessibility.mjs"), source("scripts/verify-landing-keyboard.mjs")]) {
      expect(auditSource).not.toContain('waitUntil: "networkidle"');
      expect(auditSource).not.toContain('waitForLoadState("networkidle")');
    }
    expect(productionAuditNormalized).toContain("analyticsEventsSkipped = analyticsAuditMode === \"disabled\"");
    expect(productionAuditNormalized).toContain("analytics disabled — event contracts skipped");
    expect(productionAuditNormalized).toContain('interactionAnalytics: !analyticsEventsSkipped');
    expect(productionAuditNormalized).toContain('privacyAnalytics: !analyticsEventsSkipped');
    // Explicit audit mode: enabled fails fast on a disabled bundle; the mode is
    // mandatory so neither run silently degrades. Late console errors from any
    // capture phase must still reach the gate (per-viewport finally).
    expect(captureReviewSource).toContain("} finally {\n      recordConsoleMessages(viewport.name, page);");
    expect(productionAudit).toContain('const heroEvent = waitForLandingEvent');
    expect(productionAudit).toContain('name: "mobile-320x568"');
    expect(productionAudit).toContain('async function revealAllMotionSections');
    expect(productionAudit).toContain('[data-motion-reveal="section"]');
    expect(productionAudit).toContain('data-motion-state');
    expect(productionAudit).not.toContain('#scene-signal-timeline');
    expect(productionAudit).toContain('pending motion sections');
    expect(productionAudit).not.toContain("surfaceSpecs");
  });

  it("keeps the public footer navigable without exposing phone or location", () => {
    const footer = source("app/ui/site-footer.tsx");
    const offerAlias = source("app/offer/page.tsx");

    expect(footer).not.toContain('href: "/#scene-timeline"');
    expect(footer).toContain('href: "/#scene-workspace"');
    expect(footer).toContain('href: "/#scene-evidence"');
    expect(footer).not.toContain('href: "/#scene-delivery"');
    expect(footer).not.toContain('href: "/#scene-outreach"');
    expect(footer).toContain("CookieSettingsButton");
    expect(footer).toContain('href: "/#pricing"');
    expect(footer).toContain('href: "/#faq"');
    expect(footer).toContain('href="/legal"');
    expect(footer).toContain('href="/terms"');
    expect(footer).toContain('href="/payment-and-refund"');
    expect(footer).toContain('href="/privacy"');
    expect(footer).toContain('href="/personal-data-consent"');
    expect(offerAlias.trim()).toBe('export { default, metadata } from "../terms/page";');
    expect(footer).toContain("OPERATOR_REQUISITES.inn");
    expect(footer).toContain("OPERATOR_REQUISITES.email");
    expect(footer).not.toContain("OPERATOR_REQUISITES.phone");
    expect(footer).not.toContain("OPERATOR_REQUISITES.city");
    expect(footer).not.toContain("tel:");
    expect(footer).not.toContain('href="/admin/payments"');
  });
});
