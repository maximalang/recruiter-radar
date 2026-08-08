import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("polished unified landing visual contract", () => {
  it("keeps one hero layout owner with the signal card inside the radar composition", () => {
    const hero = source("app/landing/hero-instrument.tsx");
    const heroScene = source("app/landing/detection-scene.tsx");
    const sceneStyles = source("app/landing/detection-scene.module.css");
    const instrumentStyles = source("app/landing/hero-instrument.module.css");
    const landingStyles = source("app/landing/landing.module.css");
    const visualStyles = source("app/landing/landing-visual-system.module.css");
    const obsoleteResponsiveStyles = resolve(WEB_ROOT, "app/landing/detection-responsive.module.css");
    const compatibilityRadar = source("app/landing/brand-glyphs.tsx");

    expect(heroScene).toMatch(/data-hero-visual[\s\S]*data-hero-signal-card/);
    expect(heroScene).not.toContain("detectionFooter");
    expect(hero).not.toContain("<figcaption");
    expect(hero).not.toContain("instrumentConnection");
    expect(hero).not.toContain("instrumentCore");
    expect(hero).not.toContain("instrument-link");
    expect(hero).not.toContain("temporary signal field");
    expect(sceneStyles).toContain("grid-template-columns: minmax(0, 47%) minmax(0, 53%);");
    expect(sceneStyles).toContain("grid-template-columns: minmax(0, 56%) minmax(0, 44%);");
    expect(sceneStyles).toContain("@media (max-width: 959px)");
    expect(sceneStyles).toContain("@media (max-width: 480px)");
    expect(instrumentStyles).not.toContain("position: absolute");
    expect(landingStyles).not.toMatch(/\.(detectionScene|detectionField|detectionCopy|detectionLock|detectionFooter|instrumentCaption)\b/);
    expect(visualStyles).not.toContain('#scene-detection [class*=');
    expect(existsSync(obsoleteResponsiveStyles)).toBe(false);
    expect(compatibilityRadar).not.toContain("styles.instrumentCore");
    expect(landingStyles).not.toContain(".instrumentGuides");
    expect(landingStyles).not.toContain(".instrumentConnection");
    expect(landingStyles).not.toContain(".instrumentCore");
  });

  it("keeps the radar present in the first mobile viewport without inserting the desktop field into document flow", () => {
    const sceneStyles = source("app/landing/detection-scene.module.css");

    expect(sceneStyles).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.fieldFigure\s*\{[\s\S]*?position:\s*absolute;/,
    );
    expect(sceneStyles).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.fieldFigure\s*\{[\s\S]*?right:\s*1rem;[\s\S]*?width:\s*calc\(100% - 1rem\);/,
    );
    expect(sceneStyles).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.analysisFrame\s*\{[\s\S]*?bottom:\s*10rem;/,
    );
    expect(sceneStyles).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.analysisFrame\s*\{[\s\S]*?width:\s*min\(18rem, calc\(100% - 2rem\)\);/,
    );
    expect(sceneStyles).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.section\s*\{[\s\S]*?min-height:\s*100svh;/,
    );
  });

  it("renders the desktop signal history as one temporal axis with a mobile vertical fallback", () => {
    const timeline = source("app/landing/signal-timeline-scene.tsx");
    const timelineStyles = source("app/landing/signal-timeline-scene.module.css");
    const landingStyles = source("app/landing/landing.module.css");

    expect(timeline).toContain('data-temporal-axis="signal-story"');
    expect(timelineStyles).toContain('grid-template-areas: "intro" "company" "story" "lock";');
    expect(timelineStyles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(timelineStyles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.story\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(landingStyles).not.toContain("grid-template-areas: \"intro company\" \"intro timeline\"");
    expect(landingStyles).not.toContain(".timelineEvents::before");
    expect(landingStyles).not.toContain(".timelineEvent {");
  });

  it("separates the core workspace from connected delivery routes", () => {
    const delivery = source("app/landing/delivery-scene.tsx");

    expect(delivery).toContain('data-delivery-core="workspace"');
    expect(delivery).toContain('data-delivery-routes="connected"');
    expect(delivery).toContain("DELIVERY_CHANNELS.slice(1).map");
  });

  it("shows a human-controlled outreach composer and a branded closing signal", () => {
    const outreach = source("app/landing/outreach-scene.tsx");
    const conversion = source("app/landing/conversion-panel.tsx");

    expect(outreach).toContain("COMPOSER_STEPS.map");
    expect(outreach).toContain('data-composer-steps="human-controlled"');
    expect(outreach).toContain('data-composer-step={step.key}');
    expect(conversion).toContain('data-final-signal-composition="agency-profile"');
  });

  it("keeps the landing skip link first and exposes one main content landmark", () => {
    const home = source("app/home-page-content.tsx");
    const landingPage = source("app/landing/landing-page.tsx");
    const landingPageBody = landingPage.slice(landingPage.indexOf("export default function LandingPage"));
    const skipLinkIndex = home.indexOf("<LandingSkipLink />");
    const analyticsIndex = home.indexOf("<LandingAnalytics />");
    const landingIndex = home.indexOf("{landing}");
    const cookieSettingsIndex = home.indexOf("<YandexMetrika />");

    expect(home).toContain('<PageFrame as="div"');
    expect(skipLinkIndex).toBeGreaterThan(-1);
    expect(analyticsIndex).toBeGreaterThan(skipLinkIndex);
    expect(landingIndex).toBeGreaterThan(analyticsIndex);
    expect(cookieSettingsIndex).toBeGreaterThan(landingIndex);
    expect(landingPage).toContain('export function LandingSkipLink()');
    expect(landingPage).toContain('<main id="main-content">');
    expect(landingPageBody).not.toContain('<a href="#main-content" className={styles.skipLink}>');
  });

  it("uses one stable preview anchor without duplicating it in the suspense fallback", () => {
    const workspace = source("app/landing/workspace-scene.tsx");
    const skeletonStart = workspace.indexOf("export function WorkspaceResultsSkeleton");
    const skeletonSource = workspace.slice(skeletonStart);

    expect(workspace).toContain('id="preview-results"');
    expect(workspace).toContain("<Suspense fallback={<WorkspaceResultsSkeleton />}>");
    expect(workspace).toContain("embedded");
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

    expect(productCss).toContain('[data-ui-system="recruiter-radar-v6"]');
    expect(productCss).toContain('[data-ui-system="recruiter-radar-v7"]');
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
    expect(productionAudit).toContain('name: "hero-320x700"');
  });

  it("keeps the public footer navigable without exposing phone or location", () => {
    const footer = source("app/ui/site-footer.tsx");
    const offerAlias = source("app/offer/page.tsx");

    expect(footer).toContain('href: "/#scene-timeline"');
    expect(footer).toContain('href: "/#scene-workspace"');
    expect(footer).toContain('href: "/#scene-evidence"');
    expect(footer).toContain('href: "/#scene-delivery"');
    expect(footer).toContain('href: "/#scene-outreach"');
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
