import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("polished unified landing visual contract", () => {
  it("keeps the hero radar centerless and free of a connecting beam", () => {
    const hero = source("app/landing/hero-instrument.tsx");
    const heroStyles = source("app/landing/landing.module.css");
    const compatibilityRadar = source("app/landing/brand-glyphs.tsx");

    expect(hero).not.toContain("instrumentConnection");
    expect(hero).not.toContain("instrumentCore");
    expect(hero).not.toContain("instrument-link");
    expect(hero).not.toContain("temporary signal field");
    expect(hero).toContain("Подтверждённый сигнал / текущий приоритет");
    expect(compatibilityRadar).not.toContain("styles.instrumentCore");
    expect(heroStyles).not.toContain(".instrumentGuides");
    expect(heroStyles).not.toContain(".instrumentConnection");
    expect(heroStyles).not.toContain(".instrumentCore");
  });

  it("keeps the landing skip link first and exposes one main content landmark", () => {
    const home = source("app/home-page-content.tsx");
    const landingPage = source("app/landing/landing-page.tsx");
    const skipLinkIndex = home.indexOf("<LandingSkipLink />");
    const analyticsIndex = home.indexOf("<LandingAnalytics />");
    const landingIndex = home.indexOf("{landing}");
    const cookieSettingsIndex = home.indexOf("<YandexMetrika />");

    expect(home).toContain('<PageFrame as="div"');
    expect(skipLinkIndex).toBeGreaterThan(-1);
    expect(analyticsIndex).toBeGreaterThan(skipLinkIndex);
    expect(landingIndex).toBeGreaterThan(analyticsIndex);
    expect(cookieSettingsIndex).toBeGreaterThan(landingIndex);
    expect(landingPage).toContain('<main id="main-content">');
    expect(landingPage).not.toContain('<a href="#main-content" className={styles.skipLink}>');
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

    expect(productCss).toContain('[data-ui-system="recruiter-radar-v6"]');
    expect(productCss).toContain('[data-ui-system="recruiter-radar-v7"]');
    expect(productCss).toContain('[data-product-workspace="true"]');
    expect(productCss).not.toContain('[class*=');
    expect(productCss).not.toContain("!important");
  });

  it("locks the required responsive viewport and legal surface audit", () => {
    const responsiveAudit = source("../../scripts/verify-responsive-surfaces.mjs");

    expect(responsiveAudit).toContain("{ name: 'mobile-360', width: 360, height: 800 }");
    expect(responsiveAudit).toContain("{ name: 'mobile-390', width: 390, height: 844 }");
    expect(responsiveAudit).toContain("{ name: 'tablet-768', width: 768, height: 1024 }");
    expect(responsiveAudit).toContain("{ name: 'tablet-1024', width: 1024, height: 768 }");
    expect(responsiveAudit).toContain("{ name: 'desktop-1440', width: 1440, height: 900 }");
    expect(responsiveAudit).toContain("'/offer'");
    expect(responsiveAudit).toContain("'/payment-and-refund'");
  });

  it("preserves the Robokassa-ready public footer and the offer alias", () => {
    const footer = source("app/ui/site-footer.tsx");
    const offerAlias = source("app/offer/page.tsx");

    expect(footer).toContain('href="/legal"');
    expect(footer).toContain('href="/terms"');
    expect(footer).toContain('href="/payment-and-refund"');
    expect(footer).toContain('href="/privacy"');
    expect(offerAlias.trim()).toBe('export { default, metadata } from "../terms/page";');
    expect(footer).toContain("OPERATOR_REQUISITES.phone");
    expect(footer).toContain("OPERATOR_REQUISITES.city");
    expect(footer).toContain('href="/admin/payments"');
  });
});
