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
    expect(visual).toMatch(/color\s*:\s*var\(--ink\)\s*;/);
    expect(visual).toContain(':global(#pricing [data-pricing-primary])');
    expect(visual).toContain(':global(#pricing [data-pricing-secondary] p)');
    expect(visual).toContain(':global(#faq summary)');
  });

  test("uses a restrained ambient radar without the retired instrument runtime", () => {
    const hero = source("app/landing/detection-scene.tsx");
    const heroScene = source("app/landing/detection-scene.module.css");
    const heroRadar = source("app/landing/hero-radar.tsx");
    const heroRadarStyles = source("app/landing/hero-radar.module.css");
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(hero).toContain('data-hero-layout="ambient-radar"');
    expect(hero).toContain("<HeroRadar />");
    expect(hero).not.toContain("HeroInstrument");
    expect(heroScene).toContain("var(--signal-strong)");
    expect(heroRadar).toContain('data-hero-radar="premium"');
    expect(heroRadarStyles).toContain(".ringLayer");
    expect(heroRadarStyles).not.toContain("sweep");
    expect(heroScene).not.toContain("#7fd8bd");
    expect(heroScene).not.toContain("#dcff8a");
    expect(heroScene).not.toContain("#c8f36a");
    expect(visual).not.toContain("data-hero-instrument");
    expect(visual).not.toContain("@keyframes signalBreath");
    expect(heroScene).toContain("@media (prefers-reduced-motion: reduce)");
    expect(heroRadarStyles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("sends the landing login CTA directly to the login flow and restores mobile-menu focus synchronously", () => {
    const header = source("app/landing/landing-header.tsx");

    expect(header).toContain('const LOGIN_HREF = "/login?returnTo=%2Fdashboard";');
    expect(header).toContain("href={LOGIN_HREF}");
    expect(header).not.toContain('<Link href="/dashboard" className={headerStyles.login}>');
    expect(header).toContain('data-brand-header="recruiter-radar"');
    expect(header).toMatch(/if \(restoreFocus\) menuButtonRef\.current\?\.focus\(\{ preventScroll: true \}\);\s+setMenuOpen\(false\);/);
    expect(header).not.toContain("if (restoreFocus) window.requestAnimationFrame");
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

  test("uses the Evidence Compass identity and a calm functional auth message", () => {
    const authShell = source("app/login/auth-shell.tsx");
    const authStyles = source("app/login/login.module.css");

    expect(authShell).toContain('data-auth-compass="true"');
    expect(authShell).toContain('data-signal-cluster="primary"');
    expect(authShell).toContain("Сигнал → доказательство → действие");
    expect(authShell).toContain("Рабочий контекст агентства остаётся рядом с подтверждённым следующим ходом.");
    expect(authShell).not.toContain("<ul");
    expect(authShell).not.toContain("radarCore");
    expect(authShell).not.toContain("radarSweep");
    expect(authStyles).not.toContain(".radarCore");
    expect(authStyles).not.toContain(".radarSweep");
    expect(authStyles).not.toContain("@keyframes");
    expect(authStyles).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.story\s*\{[\s\S]*?min-height:\s*168px;[\s\S]*?max-height:\s*180px;/);
    expect(authStyles).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.compass\s*\{/);
  });

  test("keeps onboarding in the current product system without serif or copper branding", () => {
    const onboarding = source("app/onboarding/onboarding-page-content.tsx");
    const onboardingStyles = source("app/onboarding/onboarding.module.css");

    expect(onboarding).toContain('data-ui-system="recruiter-radar"');
    expect(onboardingStyles).toContain("var(--rr-color-canvas)");
    expect(onboardingStyles).toContain("var(--rr-color-signal)");
    expect(onboardingStyles).not.toMatch(/Georgia|Times New Roman|serif/);
    expect(onboardingStyles).not.toMatch(/#(?:a85924|b8662e|ca7c38|bd7138)/i);
  });
});
