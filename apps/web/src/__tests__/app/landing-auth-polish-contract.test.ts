import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("landing visual and login reliability polish", () => {
  test("keeps light pricing and FAQ readable without a global composition override", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const conversionCss = source("app/landing/conversion-panel.module.css");
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(conversion).toContain('data-pricing-primary="true"');
    expect(conversion).toContain('data-pricing-secondary="true"');
    expect(conversion).toContain('data-faq-surface="true"');
    expect(conversion).toContain('data-pricing-layout="pilot-decision"');
    expect(conversion).toContain('data-faq-layout="centered"');
    expect(conversionCss).toContain(".pricing");
    expect(conversionCss).toContain(".faq");
    expect(conversionCss).toContain("color: var(--color-text-primary)");
    expect(visual).not.toContain(":global(#pricing [data-pricing-primary])");
    expect(visual).not.toContain(":global(#faq summary)");
  });

  test("restores the ambient radar hero on canonical inverse-theme tokens", () => {
    const hero = source("app/landing/detection-scene.tsx");
    const heroScene = source("app/landing/detection-scene.module.css");
    const signalField = source("app/landing/hero-signal-field.tsx");
    const signalFieldCss = source("app/landing/hero-signal-field.module.css");
    const visual = source("app/landing/landing-visual-system.module.css");
    const retiredRadar = resolve(WEB_ROOT, "app/landing/hero-radar.tsx");
    const retiredRadarStyles = resolve(WEB_ROOT, "app/landing/hero-radar.module.css");

    expect(hero).toContain('data-hero-layout="morning-list"');
    expect(hero).toContain("HeroSignalField");
    expect(hero).toContain("Открыть живой пример");
    expect(hero).not.toContain("HeroRadar");
    expect(existsSync(retiredRadar)).toBe(false);
    expect(existsSync(retiredRadarStyles)).toBe(false);
    expect(signalFieldCss).toContain("var(--color-signal-on-dark)");
    expect(signalFieldCss).toContain("var(--color-copper)");
    expect(signalFieldCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(signalFieldCss).not.toMatch(/\brgba?\(/);
    expect(heroScene).toContain("var(--color-text-primary)");
    expect(heroScene).toContain("var(--color-signal)");
    expect(heroScene).not.toContain("#c8f36a");
    expect(visual).not.toContain("data-hero-instrument");
  });

  test("binds the transparent fixed header to the dark Hero surface from first paint", () => {
    const hero = source("app/landing/detection-scene.tsx");
    const header = source("app/landing/landing-header.tsx");
    const accessibilityAudit = source("scripts/verify-landing-accessibility.mjs");
    const reviewCapture = source("scripts/capture-landing-review.mjs");

    expect(hero).toContain('data-theme="inverse"');
    expect(hero).toContain('data-header-tone="dark"');
    expect(hero).not.toContain('data-header-tone="light"');
    expect(header).toContain('useState<HeaderTone>("dark")');
    expect(header).toContain('const logoTone = scrolled || menuOpen ? "light" : tone;');
    expect(accessibilityAudit).toContain("Header BrandLogo");
    expect(accessibilityAudit).toContain("Header nav");
    expect(accessibilityAudit).toContain("Header login");
    expect(accessibilityAudit).toContain("Header preview CTA");
    expect(accessibilityAudit).toContain("Header menu glyph");
    expect(accessibilityAudit).toContain("Header menu focus");
    expect(accessibilityAudit).toContain('hash: "scene-evidence", tone: "dark"');
    expect(accessibilityAudit).toContain('hash: "pricing", tone: "light"');
    expect(accessibilityAudit).toContain('hash: "faq", tone: "light"');
    expect(reviewCapture).toContain("hero-header-top.png");
    expect(reviewCapture).toContain("header-preview.png");
    expect(reviewCapture).toContain("header-proof-dark.png");
    expect(reviewCapture).toContain("menu-open.png");
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
    expect(onboardingStyles).toContain("var(--color-canvas)");
    expect(onboardingStyles).toContain("var(--color-signal)");
    expect(onboardingStyles).not.toMatch(/Georgia|Times New Roman|serif/);
    expect(onboardingStyles).not.toMatch(/#(?:a85924|b8662e|ca7c38|bd7138)/i);
  });
});
