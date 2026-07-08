/**
 * @jest-environment jsdom
 *
 * Phase 4 (T4.1) — InternalBackLink carries a semantic BackIcon SVG, not the
 * literal "←" character. The component accepts an optional `icon` prop
 * (defaults to BackIcon) so every back affordance speaks the SVG vocabulary.
 */
import { render, screen } from '@testing-library/react';
import { InternalBackLink } from '@/app/ui/internal-page';
import { BackIcon } from '@/app/ui/icons';

describe('InternalBackLink (T4.1 — BackIcon SVG)', () => {
  it('renders a BackIcon SVG by default', () => {
    const { container } = render(
      <InternalBackLink href="/leads">Лиды</InternalBackLink>,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Лиды')).toBeTruthy();
  });

  it('does NOT render the literal ← character', () => {
    const { container } = render(
      <InternalBackLink href="/leads">Лиды</InternalBackLink>,
    );
    expect(container.textContent).not.toContain('←');
  });

  it('links to the provided href', () => {
    render(<InternalBackLink href="/leads">Лиды</InternalBackLink>);
    const link = screen.getByText('Лиды').closest('a');
    expect(link?.getAttribute('href')).toBe('/leads');
  });
});
