/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { BrandLogo } from '../../../../app/ui/brand-logo';

describe('BrandLogo', () => {
  it('renders the Recruiter Radar wordmark with an inline graphic mark', () => {
    const { container } = render(<BrandLogo />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    const mark = container.querySelector('svg[data-logo-mark="inline"]');

    expect(logo.querySelector('img')).toBeNull();
    expect(mark).not.toBeNull();
    expect(mark?.querySelector('path')).not.toBeNull();
    expect(container.querySelector('[data-mark="true"]')).toBeTruthy();
    expect(logo.textContent).toContain('Recruiter');
    expect(logo.textContent).toContain('Radar');
  });

  it('keeps the compact dark variant accessible with the inline mark', () => {
    const { container } = render(<BrandLogo tone="dark" size="small" />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });

    expect(container.querySelector('svg[data-logo-mark="inline"]')).not.toBeNull();
    expect(container.querySelector('[data-tone="dark"]')).toBeTruthy();
    expect(container.querySelector('[data-size="small"]')).toBeTruthy();
    expect(container.querySelector('[data-mark="true"]')).toBeTruthy();
    expect(logo.textContent).toContain('Recruiter');
    expect(logo.textContent).toContain('Radar');
  });
});
