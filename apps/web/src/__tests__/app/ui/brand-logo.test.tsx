/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { BrandLogo } from '../../../../app/ui/brand-logo';

describe('BrandLogo', () => {
  it('renders a clean text-only Recruiter Radar wordmark', () => {
    const { container } = render(<BrandLogo />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });

    expect(logo.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-mark="false"]')).toBeTruthy();
    expect(logo.textContent).toContain('Recruiter');
    expect(logo.textContent).toContain('Radar');
  });

  it('keeps the compact dark variant accessible without a graphic mark', () => {
    const { container } = render(<BrandLogo tone="dark" size="small" />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });

    expect(logo.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-tone="dark"]')).toBeTruthy();
    expect(container.querySelector('[data-size="small"]')).toBeTruthy();
    expect(container.querySelector('[data-mark="false"]')).toBeTruthy();
    expect(logo.textContent).toContain('Recruiter');
    expect(logo.textContent).toContain('Radar');
  });
});
