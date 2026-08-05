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
  it('loads the interaction layer after the visual finish layer', () => {
    expect(layout).toContain('import "./site-finish.css";');
    expect(layout).toContain('import "./site-interactions.css";');
    expect(layout.indexOf('site-interactions.css')).toBeGreaterThan(
      layout.indexOf('site-finish.css'),
    );
  });

  it('keeps touch targets, mobile fields and reduced motion safe', () => {
    expect(interactions).toContain('min-height: 44px');
    expect(interactions).toContain('font-size: 16px');
    expect(interactions).toContain('@media (prefers-reduced-motion: reduce)');
    expect(interactions).toContain('[aria-disabled="true"]');
    expect(interactions).toContain('scroll-margin-top: 104px');
  });

  it('audits the complete public and product route families', () => {
    for (const route of [
      "'/opportunities'",
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
  });
});
