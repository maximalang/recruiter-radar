/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { BrandLogo } from '../../../../app/ui/brand-logo';

describe('BrandLogo', () => {
  it('renders the self-contained transparent vector wordmark asset', () => {
    const { container } = render(<BrandLogo />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    expect(logo.getAttribute('src')).toBe('/brand/recruiter-radar-logo.svg?v=vector-3');
    expect(logo.getAttribute('width')).toBe('728');
    expect(logo.getAttribute('height')).toBe('252');
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-wordmark="true"]')).toBeTruthy();
  });

  it('crops the same working vector asset for compact placements', () => {
    const { container } = render(
      <BrandLogo tone="dark" size="small" showWordmark={false} />
    );

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    expect(logo.getAttribute('src')).toBe('/brand/recruiter-radar-logo.svg?v=vector-3');
    expect(container.querySelector('[data-tone="dark"]')).toBeTruthy();
    expect(container.querySelector('[data-size="small"]')).toBeTruthy();
    expect(container.querySelector('[data-wordmark="false"]')).toBeTruthy();
  });
});
