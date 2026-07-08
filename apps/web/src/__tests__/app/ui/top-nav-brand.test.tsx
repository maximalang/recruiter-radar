/**
 * @jest-environment jsdom
 *
 * F1 (review follow-up) — TopNav brand must carry a semantic SVG icon, not a
 * literal `←` interface glyph. Spec §7.1 / AC1 of the UX-hardening premium
 * pass forbid literal arrow glyphs in navigation; every other back affordance
 * migrated to `BackIcon` in Phase 0, but the TopNav brand kept `← Recruiter
 * Radar`. This test pins the SVG contract so the drift cannot return.
 */
import { render } from '@testing-library/react';
import { TopNav } from '@/app/ui/internal-page';

describe('TopNav brand (F1 — SVG icon, no literal arrow glyph)', () => {
  it('renders a semantic SVG icon next to the brand label', () => {
    const { container } = render(<TopNav items={[]} />);
    // The brand link carries an inline <svg> glyph from the single icon system.
    expect(container.querySelector('a.topNavBrand svg')).not.toBeNull();
  });

  it('does not render the literal `←` interface glyph', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');
    expect(brand).not.toBeNull();
    // No literal arrow character in the rendered brand text.
    expect(brand?.textContent ?? '').not.toContain('←');
  });

  it('keeps the "Recruiter Radar" brand label as the accessible name', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');
    expect(brand?.textContent ?? '').toContain('Recruiter Radar');
  });
});
