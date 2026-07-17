/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { BrandLogo } from '../../../../app/ui/brand-logo';

describe('BrandLogo', () => {
  it('renders the exact uploaded radar mark with a separate wordmark', () => {
    const { container } = render(<BrandLogo />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    const artwork = logo.querySelector('img');

    expect(artwork?.getAttribute('src')).toBe('/icon.svg?v=brand-9');
    expect(artwork?.getAttribute('width')).toBe('128');
    expect(artwork?.getAttribute('height')).toBe('128');
    expect(artwork?.getAttribute('alt')).toBe('');
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-wordmark="true"]')).toBeTruthy();
    expect(logo.textContent).toContain('Recruiter');
    expect(logo.textContent).toContain('Radar');
  });

  it('keeps the compact mark-only variant accessible', () => {
    const { container } = render(
      <BrandLogo tone="dark" size="small" showWordmark={false} />
    );

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    const artwork = logo.querySelector('img');

    expect(artwork?.getAttribute('src')).toBe('/icon.svg?v=brand-9');
    expect(container.querySelector('[data-tone="dark"]')).toBeTruthy();
    expect(container.querySelector('[data-size="small"]')).toBeTruthy();
    expect(container.querySelector('[data-wordmark="false"]')).toBeTruthy();
    expect(logo.textContent).toBe('');
  });
});
