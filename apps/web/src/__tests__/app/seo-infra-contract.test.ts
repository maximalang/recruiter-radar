import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("SEO/AEO infrastructure contracts", () => {
  it("robots.ts opens the site to crawlers, guards private zones, references sitemap and host", () => {
    const robots = source("app/robots.ts");
    expect(robots).toContain('userAgent: "*"');
    expect(robots).toContain('allow: "/"');
    expect(robots).toContain('"/dashboard"');
    expect(robots).toContain('"/admin"');
    expect(robots).toContain('"/api/"');
    expect(robots).toContain("sitemap:");
    expect(robots).toContain("host:");
  });

  it("sitemap.ts lists only public content routes from the production domain", () => {
    const sitemap = source("app/sitemap.ts");
    for (const route of [
      'entry("/", 1.0',
      'entry("/legal"',
      'entry("/terms"',
      'entry("/privacy"',
      'entry("/offer"',
    ]) {
      expect(sitemap).toContain(route);
    }
    expect(sitemap).not.toContain("/dashboard");
    expect(sitemap).not.toContain("/login");
    expect(sitemap).toContain("OPERATOR_REQUISITES.website");
  });

  it("llms.txt route exposes product facts without invented claims or banned copywriting", () => {
    const llms = source("app/llms.txt.ts");
    expect(llms).toContain("OPERATOR_REQUISITES");
    expect(llms).toContain("PUBLIC_PLANS");
    // Banned marketing claims never appear.
    expect(llms).not.toContain("гарантированные клиенты");
    expect(llms).not.toContain("100% результат");
    // Product identity anchors stay explicit.
    expect(llms).toContain("НЕ является ATS");
    expect(llms).toContain("FIUR");
  });

  it("landing JSON-LD is wired into the home page with schema.org graph of Organization, WebSite and FAQPage", () => {
    const jsonld = source("app/seo-jsonld.ts");
    expect(jsonld).toContain('"@type": "Organization"');
    expect(jsonld).toContain('"@type": "WebSite"');
    expect(jsonld).toContain('"@type": "FAQPage"');
    expect(jsonld).toContain("buildLandingFaqItems");

    const home = source("app/home-page-content.tsx");
    expect(home).toContain('type="application/ld+json"');
    expect(home).toContain("buildLandingJsonLd");
  });

  it("root layout pins metadataBase to the production domain and canonicalizes the home page", () => {
    const layout = source("app/layout.tsx");
    expect(layout).toContain("metadataBase: new URL(OPERATOR_REQUISITES.website)");
    expect(layout).toContain('alternates: { canonical: "/" }');
  });
});
