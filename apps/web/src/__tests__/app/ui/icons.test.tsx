/**
 * @jest-environment jsdom
 *
 * Phase 0 (T0.1) — verifies the three new SVG glyphs (BackIcon, CircleIcon,
 * BellIcon) render with the system's icon contract: 24×24 viewBox, stroke
 * currentColor, aria-hidden by default, and the `size` prop passes through.
 *
 * These are the enabler glyphs for nav/back-link migration (BackIcon), the
 * profile-completion checklist (CircleIcon), and the delivery-form push
 * channel (BellIcon). They must speak the same visual vocabulary as the
 * existing 27 glyphs in app/ui/icons.tsx.
 */
import { render } from '@testing-library/react';
import { BackIcon, CircleIcon, BellIcon } from '@/app/ui/icons';

function svg(el: HTMLElement): SVGSVGElement {
  const node = el.querySelector('svg');
  if (!node) throw new Error('expected an <svg> element');
  return node as unknown as SVGSVGElement;
}

describe('BackIcon / CircleIcon / BellIcon (T0.1)', () => {
  it('BackIcon renders a 24×24 stroke svg, aria-hidden by default', () => {
    const { container } = render(<BackIcon />);
    const s = svg(container);
    expect(s.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(s.getAttribute('aria-hidden')).toBe('true');
    expect(s.getAttribute('fill')).toBe('none');
    expect(s.getAttribute('stroke')).toBe('currentColor');
  });

  it('BackIcon passes the size prop through to width/height', () => {
    const { container } = render(<BackIcon size={20} />);
    const s = svg(container);
    expect(s.getAttribute('width')).toBe('20');
    expect(s.getAttribute('height')).toBe('20');
  });

  it('CircleIcon renders an empty-circle glyph (no fill mark) with the system contract', () => {
    const { container } = render(<CircleIcon />);
    const s = svg(container);
    expect(s.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(s.getAttribute('aria-hidden')).toBe('true');
    expect(s.getAttribute('stroke')).toBe('currentColor');
    // The unfilled-circle glyph must carry at least one drawn child path/circle.
    expect(s.querySelector('circle, path')).not.toBeNull();
  });

  it('BellIcon renders with the system contract', () => {
    const { container } = render(<BellIcon />);
    const s = svg(container);
    expect(s.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(s.getAttribute('aria-hidden')).toBe('true');
    expect(s.getAttribute('stroke')).toBe('currentColor');
    expect(s.querySelector('path')).not.toBeNull();
  });
});
