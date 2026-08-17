import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = resolve(process.cwd(), 'app');
const layout = readFileSync(resolve(appRoot, 'layout.tsx'), 'utf8');
const interactions = readFileSync(resolve(appRoot, 'site-interactions.css'), 'utf8');
const responsiveAudit = readFileSync(
  resolve(process.cwd(), '..', '..', 'scripts', 'verify-responsive-surfaces.mjs'),
  'utf8',
);

describe('cross-route interaction hardening', () => {
  it('loads interaction safety after the scoped product visual layer', () => {
    expect(layout).toContain('import "./product-visual-system.css";');
    expect(layout).toContain('import "./site-interactions.css";');
    expect(layout.indexOf('site-interactions.css')).toBeGreaterThan(
      layout.indexOf('product-visual-system.css'),
    );
  });

  it('keeps touch targets, mobile fields and reduced motion safe', () => {
    expect(interactions).toContain('min-height: 44px');
    expect(interactions).toContain('font-size: 16px');
    expect(interactions).toContain('@media (prefers-reduced-motion: reduce)');
    expect(interactions).toContain('[aria-disabled="true"]');
    expect(interactions).toContain('scroll-margin-top: 104px');
  });

  it('keeps touch feedback on the final semantic token system without dead sidebar selectors', () => {
    expect(interactions).toContain('-webkit-tap-highlight-color: var(--rr-color-selection)');
    expect(interactions).not.toContain('rgba(35, 128, 111');
    expect(interactions).not.toContain('sidebarBrand');
  });

  it('audits the complete public and product route families', () => {
    for (const route of [
      "'/opportunities'",
      "'/opportunities/radar'",
      "'/settings/diagnostics/sources'",
      "'/admin/payments'",
      "'/settings/access'",
      "'/settings/delivery'",
      "'/settings/radar'",
      "'/settings/security'",
      "'/settings/team'",
      "'/onboarding'",
      "'/legal'",
      "'/privacy'",
      "'/terms'",
      "'/auth/change-email'",
    ]) {
      expect(responsiveAudit).toContain(route);
    }
    expect(responsiveAudit).toContain("'a[href], button");
    expect(responsiveAudit).toContain('formButtonsWithoutType');
    expect(responsiveAudit).toContain('duplicateIds');
    expect(responsiveAudit).toContain('keyboardFocus');
    expect(responsiveAudit).toContain('focusIndicator');
    expect(responsiveAudit).toContain('semanticNotFound');
    expect(responsiveAudit).toContain('reducedMotionViolations');
    expect(responsiveAudit).toContain('continuousAnimations');
    expect(responsiveAudit).toContain('unlabeledDialogs');
    expect(responsiveAudit).toContain('disclosureAudit');
    expect(responsiveAudit).toContain('const disclosureWasOpen = await firstDisclosure.evaluate');
    expect(responsiveAudit).toContain('if (!disclosureWasOpen) await firstDisclosure.click()');
    expect(responsiveAudit).toContain('navigationDurationMs');
    expect(responsiveAudit).toContain("waitForLoadState('networkidle'");
  });
});
