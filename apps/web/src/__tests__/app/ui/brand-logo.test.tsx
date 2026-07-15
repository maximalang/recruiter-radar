/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { BrandLogo } from '../../../../app/ui/brand-logo';

describe('BrandLogo', () => {
  it('renders the exact supplied transparent wordmark asset', () => {
    const { container } = render(<BrandLogo />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    expect(logo.getAttribute('src')).toBe('/brand/recruiter-radar-logo.svg?v=exact-2');
    expect(logo.getAttribute('width')).toBe('546');
    expect(logo.getAttribute('height')).toBe('189');
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-wordmark="true"]')).toBeTruthy();
  });

  it('uses the cropped supplied mark for compact placements', () => {
    const { container } = render(
      <BrandLogo tone="dark" size="small" showWordmark={false} />
    );

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    expect(logo.getAttribute('src')).toBe('/brand/recruiter-radar-mark.svg?v=exact-2');
    expect(logo.getAttribute('width')).toBe('195');
    expect(container.querySelector('[data-tone="dark"]')).toBeTruthy();
    expect(container.querySelector('[data-size="small"]')).toBeTruthy();
    expect(container.querySelector('[data-wordmark="false"]')).toBeTruthy();
  });
});
