/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { BrandLogo } from '../../../../app/ui/brand-logo';

describe('BrandLogo', () => {
  it('renders the Recruiter Radar wordmark without a graphic mark', () => {
    const { container } = render(<BrandLogo />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });

    expect(logo.querySelector('img')).toBeNull();
    expect(logo.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-mark="false"]')).toBeTruthy();
    expect(logo.textContent).toContain('Recruiter');
    expect(logo.textContent).toContain('Radar');
  });

  it('keeps the compact dark wordmark accessible and text-only', () => {
    const { container } = render(<BrandLogo tone="dark" size="small" />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });

    expect(logo.querySelector('img')).toBeNull();
    expect(logo.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-tone="dark"]')).toBeTruthy();
    expect(container.querySelector('[data-size="small"]')).toBeTruthy();
    expect(container.querySelector('[data-mark="false"]')).toBeTruthy();
    expect(logo.textContent).toContain('Recruiter');
    expect(logo.textContent).toContain('Radar');
  });

  it('renders the established radar mark when the header opts in', () => {
    const { container } = render(<BrandLogo showMark priority />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    const mark = logo.querySelector('img');

    expect(mark).toHaveAttribute('src', '/recruiter-radar-app-source.svg');
    expect(mark).toHaveAttribute('alt', '');
    expect(container.querySelector('[data-mark="true"]')).toBeTruthy();
  });
});
