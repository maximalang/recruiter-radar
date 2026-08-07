import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("landing visual and login reliability polish", () => {
  test("keeps light pricing and FAQ surfaces readable inside the dark conversion wrapper", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(conversion).toContain('data-pricing-primary="true"');
    expect(conversion).toContain('data-pricing-secondary="true"');
    expect(conversion).toContain('data-faq-surface="true"');
    expect(visual).toContain(':global(#pricing),');
    expect(visual).toContain(':global(#faq)');
    expect(visual).toContain('color: var(--ink);');
    expect(visual).toContain(':global(#pricing [data-pricing-primary])');
    expect(visual).toContain(':global(#pricing [data-pricing-secondary] p)');
    expect(visual).toContain(':global(#faq summary)');
  });

  test("uses restrained signal constellations and disables their motion for reduced-motion users", () => {
    const hero = source("app/landing/hero-instrument.tsx");
    const heroScene = source("app/landing/detection-scene.module.css");
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(hero).toContain('data-hero-instrument="true"');
    expect(hero).toContain('data-signal-cluster="primary"');
    expect(hero).toContain('data-signal-cluster="secondary"');
    expect(hero).toContain('data-active-signal="true"');
    expect(hero).not.toContain("instrumentConnection");
    expect(hero).not.toContain("instrumentCore");
    expect(heroScene).toContain("#b5ead8");
    expect(heroScene).toContain("#7fd8bd");
    expect(heroScene).not.toContain("#dcff8a");
    expect(heroScene).not.toContain("#c8f36a");
    expect(visual).toContain("@keyframes clusterDrift");
    expect(visual).toContain("@keyframes signalBreath");
    expect(visual).toContain("@media (prefers-reduced-motion: reduce)");
    expect(visual).toMatch(/data-signal-cluster[\s\S]*animation: none;/);
  });

  test("sends the landing login CTA directly to the login flow", () => {
    const header = source("app/landing/landing-header.tsx");

    expect(header).toContain('const LOGIN_HREF = "/login?returnTo=%2Fdashboard";');
    expect(header).toContain("href={LOGIN_HREF}");
    expect(header).not.toContain('<Link href="/dashboard" className={headerStyles.login}>');
    expect(header).toContain('data-brand-header="recruiter-radar-v3"');
  });

  test("retries verification with the in-memory one-time token instead of reloading a tokenless URL", () => {
    const verifyClient = source("app/auth/verify/verify-client.tsx");

    expect(verifyClient).toContain('const tokenRef = useRef("");');
    expect(verifyClient).toContain("tokenRef.current = token;");
    expect(verifyClient).toContain("void verifyToken(token);");
    expect(verifyClient).toContain("const token = tokenRef.current;");
    expect(verifyClient).not.toContain("window.location.reload()");
    expect(verifyClient).toContain('window.history.replaceState(null, "", "/auth/verify")');
  });
});
