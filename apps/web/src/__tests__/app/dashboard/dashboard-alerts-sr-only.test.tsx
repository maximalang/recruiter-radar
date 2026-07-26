/**
 * @jest-environment jsdom
 *
 * F2 (review follow-up) — dashboard-alerts resolve-button a11y text must be
 * hidden by a real CSS-module srOnly class, not the unscoped global `sr-only`
 * string. The project has NO global `.sr-only` rule — only module-scoped
 * `styles.srOnly` (internal-page.module.css, dashboard.module.css). The bare
 * `className="sr-only"` therefore did NOT hide the «Отметить алерт как
 * решённый» text, which leaked into the visible UI next to the «Решить» button.
 *
 * This test pins the fix: the span carries the module-hashed srOnly class
 * (a hashed name, not the literal `sr-only` token) so the visual-noise bug
 * cannot return.
 */
import { render } from '@testing-library/react';
import DashboardAlerts from '@/app/dashboard/dashboard-alerts';

describe('dashboard-alerts resolve button (F2 — scoped srOnly)', () => {
  it('hides the «Отметить алерт как решённый» a11y text behind the module srOnly class', () => {
    const { container } = render(<DashboardAlerts />);
    // The resolve button's describedby target is the sr-only span.
    const srSpan = container.querySelector('span#alert-action-1');
    expect(srSpan).not.toBeNull();
    const cls = srSpan?.className ?? '';
    // Must be the CSS-module-hashed srOnly class, NOT the bare `sr-only` token
    // (which has no matching rule and leaks the text into the visible UI).
    expect(cls).not.toBe('sr-only');
    expect(cls).not.toBe('');
    // The hashed class name always carries the srOnly token fragment.
    expect(cls).toMatch(/sr.?only/i);
  });

  it('does not render the bare unscoped `sr-only` class anywhere', () => {
    const { container } = render(<DashboardAlerts />);
    const bare = container.querySelectorAll('.sr-only');
    // A bare global `sr-only` (unscoped) has no matching rule in the project
    // and is the bug. After the fix, every sr-only node carries the hashed
    // module class instead, so a `.sr-only` selector finds nothing.
    expect(bare.length).toBe(0);
  });
});
